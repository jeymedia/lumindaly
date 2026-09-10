import {z} from "zod";
import {ACCOUNT_TYPES,TIERS,MAX_EVIDENCE_FILES,ATTRIBUTION_WINDOW_DAYS,getAffiliateRate,suggestTier,tierById} from "./config.ts";
import {RuleSchema,EvidenceAnalysisSchema,type Services,type Rule,type Intake} from "./contracts.ts";
import {analyzeNotice,applyRule,getMatchingRule,calculateReadiness,analyzeEvidence,generateAppeal,isOfficialSource} from "./engine.ts";
import {HttpError,readJson,readForm,validateFile,sha256,assertSameOrigin} from "./security.ts";
import {type Row,uid,timestamp,statement,first,rows,jsonParse,anonymous,currentUser,ownedScan,ownedCase,requirePaid,activeRules,rowRule,caseData,rateLimit} from "./store.ts";
import {createCheckout,handleStripeWebhook,issueRefund,paymentsReady} from "./payments.ts";
const accountSchema=z.enum(ACCOUNT_TYPES);
const intakeSchema=z.object({noticeText:z.string().max(12000),accountType:accountSchema,market:z.string().regex(/^[A-Z]{2}$/),username:z.string().max(60).regex(/^@?[a-zA-Z0-9._]*$/),sanctionDate:z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),previousAppeals:z.coerce.number().int().min(0).max(100),financialExposure:z.string().max(100),hasFile:z.boolean()});
function parse<S extends z.ZodTypeAny>(schema:S,value:unknown):z.output<S>{const p=schema.safeParse(value);if(!p.success)throw new HttpError(400,p.error.issues[0]?.message??"Please check the form.");return p.data;}
function response(data:unknown,status=200,extra:Record<string,string>={}){return Response.json(data,{status,headers:{"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin",...extra}});}
async function ruleForCase(s:Services,c:Row){
 const snapshot=jsonParse<Rule|null>(c.rule_snapshot_json,null);
 if(!snapshot)return null;
 const live=await first(s,"SELECT * FROM rules WHERE id=? AND active=1",snapshot.id);
 if(!live)return null;
 const parsed=rowRule(live);
 // Updated rules require a fresh match and explicit case revision, not a silent rewrite.
 if(!parsed||JSON.stringify(parsed)!==JSON.stringify(snapshot))return null;
 return getMatchingRule({accountType:c.account_type,market:c.market,violationCategory:c.violation_category,enforcementType:c.enforcement_type} as any,[snapshot],timestamp(s));
}
async function caseView(s:Services,c:Row,admin=false){
 const data=await caseData(s,c);const rule=await ruleForCase(s,c);
 const effective=rule&&c.human_review_status==="approved"?{...rule,manual_review_required:false}:rule;
 const readiness=calculateReadiness(data.facts,effective);
 await statement(s,"UPDATE cases SET readiness_score=? WHERE id=?",readiness.score,c.id).run();
 const payments=await rows(s,"SELECT id,amount,currency,status,paid_at,refunded_amount FROM payments WHERE case_id=?",c.id);
 const appeal=jsonParse(c.appeal_json,null);
 if(appeal?.ready&&readiness.blockers.length){appeal.ready=false;appeal.blockingIssues=readiness.blockers;}
 return {case:{...c,readiness_score:readiness.score,answers:jsonParse(c.answers_json,{}),appeal,rule},scan:{id:data.scan.id,notice_text:data.facts.noticeText,has_file:!!data.scan.notice_file_key,intake:jsonParse(c.intake_json??data.scan.intake_json,{}),analysis:jsonParse(data.scan.result_json,{})},evidence:data.evidence.map(({file_key,sha256,...e})=>({...e,analysis:jsonParse(e.analysis_json,{})})),readiness,payments,outcomes:await rows(s,"SELECT * FROM outcomes WHERE case_id=? ORDER BY created_at DESC",c.id),...(admin?{notes:await rows(s,"SELECT * FROM admin_notes WHERE case_id=? ORDER BY created_at DESC",c.id),analyses:await rows(s,"SELECT type,model,result_json,created_at FROM ai_analyses WHERE case_id=? ORDER BY created_at DESC",c.id),client:await first(s,"SELECT id,email,country FROM users WHERE id=?",c.user_id)}:{})};
}
function invalidateStatement(s:Services,id:string,status="building_case"){return statement(s,"UPDATE cases SET status=?,human_review_status='not_requested',consistency_checked=0,procedure_confirmed=0,appeal_json=NULL,updated_at=? WHERE id=?",status,timestamp(s),id);}
async function invalidateCase(s:Services,id:string,status="building_case"){await invalidateStatement(s,id,status).run();}
export async function handleApi(request:Request,s:Services):Promise<Response>{
 try{
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\//,"").replace(/^\//,""),method=request.method;
  if(path==="stripe/webhook"&&method==="POST")return response(await handleStripeWebhook(s,request));
  if(!["GET","HEAD"].includes(method))assertSameOrigin(request,s.config.APP_ORIGIN);
  if(path==="health")return response({ok:true,service:"lumindaly"});
  if(path==="config")return response({tiers:TIERS,paymentsReady:paymentsReady(s),paymentMode:s.config.STRIPE_MODE==="live"?"live":"test",manualReviewAvailable:s.config.MANUAL_REVIEW_ENABLED==="true",analysisMode:"structured_intake_manual_review"});
  const user=await currentUser(s,request);
  if(path==="me")return response({user,auth:"chatgpt",signInUrl:"/signin-with-chatgpt?return_to=%2Fdashboard"});
  if(path.startsWith("r/")&&method==="GET"){
   const slug=decodeURIComponent(path.slice(2));if(!/^[a-z0-9-]{3,80}$/.test(slug))throw new HttpError(404,"Partner not found.");
   const affiliate=await first(s,"SELECT * FROM affiliates WHERE slug=? AND status='active'",slug);
   if(!affiliate)throw new HttpError(404,"Partner link not found.");
   const a=(await anonymous(s,request,true))!;const now=timestamp(s);
   await rateLimit(s,"ref:"+await sha256((request.headers.get("cf-connecting-ip")??a.visitor.id)+":"+affiliate.id),40);
   await s.db.batch([
    statement(s,"UPDATE anonymous_visitors SET affiliate_id=?,referral_at=?,expires_at=? WHERE id=? AND (affiliate_id IS NULL OR expires_at<?)",affiliate.id,now,now+ATTRIBUTION_WINDOW_DAYS*86400000,a.visitor.id,now),
    statement(s,"INSERT INTO referral_events (id,affiliate_id,event_type,anonymous_id,user_id,created_at) VALUES (?,?,?,?,?,?)",uid(),affiliate.id,"click",a.visitor.id,user?.id??null,now)
   ]);
   if(user)await currentUser(s,request);
   return new Response(null,{status:302,headers:{Location:"/scan","Cache-Control":"no-store",...(a.cookie?{"Set-Cookie":a.cookie}:{})}});
  }
  if(path==="scans"&&method==="POST"){
   const a=(await anonymous(s,request,true))!;
   await rateLimit(s,"scan:"+await sha256(request.headers.get("cf-connecting-ip")??a.visitor.id),20);
   const form=await readForm(request);const upload=form.get("notice");const file=upload instanceof File&&upload.size>0?upload:null;
   const raw:Record<string,unknown>={};for(const key of ["noticeText","accountType","market","username","sanctionDate","previousAppeals","financialExposure"])raw[key]=String(form.get(key)??"");
   raw.hasFile=!!file;const intake=parse(intakeSchema,raw) as Intake;
   intake.username=intake.username.replace(/^@/,"");
   if(!intake.noticeText.trim()&&!file)throw new HttpError(400,"Upload your notice or paste its exact text.");
   if(intake.sanctionDate&&(Date.parse(intake.sanctionDate)>timestamp(s)+86400000||!Number.isFinite(Date.parse(intake.sanctionDate))))throw new HttpError(400,"Choose a valid date in the past.");
   const id=uid();let stored:null|{key:string;filename:string;mime:string}=null;
   if(file){const f=await validateFile(file);const key="notices/"+id+"/"+uid()+"."+f.extension;await s.bucket.put(key,f.bytes,{httpMetadata:{contentType:f.mime}});stored={key,filename:f.filename,mime:f.mime};}
   const detected=analyzeNotice(intake);const rule=getMatchingRule(detected,await activeRules(s),timestamp(s));const analysis=applyRule(detected,rule,intake.previousAppeals);
   const now=timestamp(s),readiness=calculateReadiness({...intake,market:intake.market??"",accountType:intake.accountType??"",answers:{},evidence:[],consistencyChecked:false,procedureConfirmed:false},rule);
   try{await s.db.batch([
    statement(s,"INSERT INTO scans (id,user_id,anonymous_id,notice_text,notice_file_key,notice_filename,notice_mime,market,account_type,violation_category,enforcement_type,severity,confidence,readiness_score,manual_review_required,result_json,intake_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,user?.id??null,a.visitor.id,intake.noticeText,stored?.key??null,stored?.filename??null,stored?.mime??null,intake.market,intake.accountType,analysis.violationCategory,analysis.enforcementType,analysis.severity,Math.round(analysis.confidence*1000),readiness.score,Number(analysis.manualReviewRequired),JSON.stringify(analysis),JSON.stringify(intake),now),
    statement(s,"INSERT INTO ai_analyses (id,scan_id,type,model,input_hash,result_json,created_at) VALUES (?,?,?,?,?,?,?)",uid(),id,"notice","structured-intake-v1",await sha256(intake.noticeText),JSON.stringify(analysis),now)
   ]);}catch(e){if(stored)await s.bucket.delete(stored.key);throw e;}
   const ref=a.visitor.affiliate_id;if(ref&&a.visitor.expires_at>=now)await statement(s,"INSERT INTO referral_events (id,affiliate_id,event_type,anonymous_id,user_id,created_at) VALUES (?,?,?,?,?,?)",uid(),ref,"scan",a.visitor.id,user?.id??null,now).run();
   return response({id,analysis,readiness},201,a.cookie?{"Set-Cookie":a.cookie}:{});
  }
  const scanMatch=path.match(/^scans\/([^/]+)(\/file)?$/);
  if(scanMatch&&method==="GET"){
   const scan=await ownedScan(s,request,scanMatch[1],user);
   if(scanMatch[2])return await fileResponse(s,scan.notice_file_key,scan.notice_filename,scan.notice_mime);
   return response({id:scan.id,analysis:jsonParse(scan.result_json,{}),intake:jsonParse(scan.intake_json,{}),readinessScore:scan.readiness_score,hasFile:!!scan.notice_file_key,suggestedTier:suggestTier(scan.violation_category,scan.account_type),createdAt:scan.created_at});
  }
  if(!user)throw new HttpError(401,"Sign in to keep your case and continue.");
  if(path==="cases"&&method==="GET")return response({cases:await rows(s,"SELECT c.id,c.product_tier,c.status,c.readiness_score,c.payment_status,c.created_at,t.username FROM cases c JOIN tiktok_accounts t ON t.id=c.tiktok_account_id WHERE c.user_id=? ORDER BY c.created_at DESC",user.id),scans:await rows(s,"SELECT id,account_type,violation_category,readiness_score,created_at FROM scans WHERE user_id=? ORDER BY created_at DESC LIMIT 20",user.id)});
  if(path==="cases"&&method==="POST"){
   const body=parse(z.object({scanId:z.string().uuid(),tier:z.string().max(30)}).strict(),await readJson(request));
   const tier=tierById(body.tier);if(!tier)throw new HttpError(400,"Choose a valid case package.");
   const scan=await ownedScan(s,request,body.scanId,user),intake=jsonParse<Intake>(scan.intake_json,{} as Intake);
   const existing=await first(s,"SELECT id FROM cases WHERE user_id=? AND scan_id=? AND product_tier=? AND payment_status='unpaid' ORDER BY created_at DESC LIMIT 1",user.id,scan.id,tier.id);
   if(existing)return response({id:existing.id});
   const rule=getMatchingRule(jsonParse(scan.result_json,{}),await activeRules(s),timestamp(s));
   const accountId=uid(),caseId=uid(),now=timestamp(s);
   await s.db.batch([
    statement(s,"INSERT INTO tiktok_accounts (id,user_id,username,account_type,market,created_at) VALUES (?,?,?,?,?,?)",accountId,user.id,intake.username,intake.accountType,intake.market,now),
    statement(s,"INSERT INTO cases (id,user_id,tiktok_account_id,scan_id,violation_category,enforcement_type,market,product_tier,notice_text,intake_json,payment_status,status,readiness_score,rule_id,rule_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'unpaid','payment_required',?,?,?,?,?)",caseId,user.id,accountId,scan.id,scan.violation_category,scan.enforcement_type,scan.market,tier.id,intake.noticeText,scan.intake_json,scan.readiness_score,rule?.id??null,rule?JSON.stringify(rule):null,now,now),
    statement(s,"UPDATE scans SET user_id=?,tiktok_account_id=? WHERE id=? AND (user_id IS NULL OR user_id=?)",user.id,accountId,scan.id,user.id)
   ]);return response({id:caseId},201);
  }
  const cm=path.match(/^cases\/([^/]+)(?:\/(checkout|evidence|appeal|outcome|review))?$/);
  if(cm){
   const c=await ownedCase(s,cm[1],user),action=cm[2]??"";
   if(method==="GET"&&!action)return response(await caseView(s,c));
   if(action==="checkout"&&method==="POST"){
    if(!c.rule_snapshot_json&&s.config.MANUAL_REVIEW_ENABLED!=="true")throw new HttpError(503,"Manual case review is not open yet. Your scan remains saved.");
    return response(await createCheckout(s,c,user));
   }
   requirePaid(c);
   if(method==="PATCH"&&!action){
    const body=parse(z.object({username:z.string().min(1).max(60).regex(/^@?[a-zA-Z0-9._]+$/),noticeText:z.string().max(12000).optional(),answers:z.record(z.string().max(80),z.string().max(10000)).refine(v=>Object.keys(v).length<=40)}).strict(),await readJson(request));
    const updatedIntake={...jsonParse<Intake>(c.intake_json,{}),noticeText:body.noticeText??c.notice_text,username:body.username.replace(/^@/,"")};
    const detected=analyzeNotice(updatedIntake),matched=getMatchingRule(detected,await activeRules(s),timestamp(s));
    await s.db.batch([statement(s,"UPDATE cases SET notice_text=?,intake_json=?,violation_category=?,enforcement_type=?,rule_id=?,rule_snapshot_json=?,answers_json=? WHERE id=?",updatedIntake.noticeText,JSON.stringify(updatedIntake),detected.violationCategory,detected.enforcementType,matched?.id??null,matched?JSON.stringify(matched):null,JSON.stringify(body.answers),c.id),statement(s,"UPDATE tiktok_accounts SET username=? WHERE id=? AND user_id=?",body.username.replace(/^@/,""),c.tiktok_account_id,user.id),invalidateStatement(s,c.id)]);return response({saved:true});
   }
   if(action==="evidence"&&method==="POST"){
    await rateLimit(s,"upload:"+user.id,80);
    const count=await first(s,"SELECT COUNT(*) AS total FROM evidence WHERE case_id=?",c.id);if(count?.total>=MAX_EVIDENCE_FILES)throw new HttpError(400,"This case already has 20 documents.");
    const form=await readForm(request);const file=form.get("file");if(!(file instanceof File))throw new HttpError(400,"Choose a document.");
    const type=parse(z.string().min(1).max(150),form.get("type"));const f=await validateFile(file);
    const id=uid(),key="evidence/"+user.id+"/"+c.id+"/"+id+"."+f.extension,analysis=analyzeEvidence({type,name:f.filename});
    await s.bucket.put(key,f.bytes,{httpMetadata:{contentType:f.mime}});
    try{await s.db.batch([statement(s,"INSERT INTO evidence (id,case_id,user_id,type,file_key,filename,mime,size,sha256,status,analysis_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,'needs_review',?,?)",id,c.id,user.id,type,key,f.filename,f.mime,file.size,f.hash,JSON.stringify(analysis),timestamp(s)),invalidateStatement(s,c.id,"evidence_required")]);}catch(e){await s.bucket.delete(key);throw e;}return response({id,status:"needs_review",analysis},201);
   }
   if(action==="review"&&method==="POST"){await statement(s,"UPDATE cases SET human_review_status='requested',status='human_review',updated_at=? WHERE id=?",timestamp(s),c.id).run();return response({requested:true});}
   if(action==="appeal"&&method==="POST"){
    const data=await caseData(s,c),rule=await ruleForCase(s,c);
    const pack=generateAppeal(data.facts,rule&&c.human_review_status==="approved"?{...rule,manual_review_required:false}:rule);
    await s.db.batch([statement(s,"UPDATE cases SET appeal_json=?,status=?,updated_at=? WHERE id=?",JSON.stringify(pack),pack.ready?"ready":"human_review",timestamp(s),c.id),statement(s,"INSERT INTO ai_analyses (id,case_id,type,model,input_hash,result_json,created_at) VALUES (?,?,?,?,?,?,?)",uid(),c.id,"appeal","grounded-template-v1",await sha256(JSON.stringify(data.facts)),JSON.stringify(pack),timestamp(s))]);
    return response(pack);
   }
   if(action==="outcome"&&method==="POST"){
    const body=parse(z.object({status:z.enum(["pending_tiktok","approved","rejected"]),restoredItems:z.array(z.enum(["Account","Shop","Monetization","Commissions","Listings","Other"])).max(6),notes:z.string().max(5000)}).strict(),await readJson(request));
    if(body.status!=="approved"&&body.restoredItems.length)throw new HttpError(400,"Restored items apply only to an approved outcome.");
    await s.db.batch([statement(s,"INSERT INTO outcomes (id,case_id,user_id,status,restored_items_json,notes,created_at) VALUES (?,?,?,?,?,?,?)",uid(),c.id,user.id,body.status,JSON.stringify(body.restoredItems),body.notes,timestamp(s)),statement(s,"UPDATE cases SET status=?,updated_at=? WHERE id=?",body.status,timestamp(s),c.id)]);
    return response({saved:true});
   }
  }
  const em=path.match(/^evidence\/([^/]+)$/);
  if(em){
   const e=await first(s,"SELECT e.* FROM evidence e JOIN cases c ON c.id=e.case_id WHERE e.id=? AND c.user_id=? AND e.user_id=?",em[1],user.id,user.id);
   if(!e)throw new HttpError(404,"Document not found.");
   if(method==="GET")return await fileResponse(s,e.file_key,e.filename,e.mime);
   if(method==="DELETE"){await s.db.batch([statement(s,"DELETE FROM evidence WHERE id=? AND user_id=?",e.id,user.id),invalidateStatement(s,e.case_id,"evidence_required")]);await s.bucket.delete(e.file_key);return response({deleted:true});}
  }
  if(path==="partner/activate"&&method==="POST"){
   const existing=await first(s,"SELECT * FROM affiliates WHERE user_id=?",user.id);if(existing)return response({affiliate:existing});
   const body=parse(z.object({accepted:z.literal(true)}).strict(),await readJson(request));void body;
   const id=uid(),code=id.replace(/-/g,"").slice(0,12).toUpperCase(),slug="p-"+code.toLowerCase(),now=timestamp(s);
   await statement(s,"INSERT INTO affiliates (id,user_id,code,slug,boost_started_at,boost_ends_at,status,created_at) VALUES (?,?,?,?,?,?,'active',?) ON CONFLICT(user_id) DO NOTHING",id,user.id,code,slug,now,now+30*86400000,now).run();
   return response({affiliate:await first(s,"SELECT * FROM affiliates WHERE user_id=?",user.id)},201);
  }
  if(path==="partner"&&method==="GET"){
   const affiliate=await first(s,"SELECT * FROM affiliates WHERE user_id=?",user.id);if(!affiliate)return response({affiliate:null});
   const events=await rows(s,"SELECT event_type,COUNT(*) AS total FROM referral_events WHERE affiliate_id=? GROUP BY event_type",affiliate.id);
   const customers=await first(s,"SELECT COUNT(*) AS total FROM attributions WHERE affiliate_id=?",affiliate.id);
   const totals=await rows(s,"SELECT status,COUNT(*) AS sales,SUM(gross_amount) AS revenue,SUM(commission_amount) AS commission FROM commissions WHERE affiliate_id=? GROUP BY status",affiliate.id);
   const recent=await rows(s,"SELECT id,gross_amount,commission_rate,commission_amount,status,created_at FROM commissions WHERE affiliate_id=? ORDER BY created_at DESC LIMIT 50",affiliate.id);
   return response({affiliate,rate:getAffiliateRate(affiliate as any,timestamp(s)),daysRemaining:Math.max(0,Math.ceil((affiliate.boost_ends_at-timestamp(s))/86400000)),events,customers:customers?.total??0,totals,recent});
  }
  if(path.startsWith("admin")){
   if(!user.is_admin)throw new HttpError(403,"Administrator access is required.");
   return await handleAdmin(s,request,user,path);
  }
  throw new HttpError(404,"This page or action was not found.");
 }catch(e){
  if(e instanceof HttpError)return response({error:e.message},e.status);
  // Do not log notice text, evidence, credentials, raw provider payloads, or request bodies.
  console.error("Lumindaly request failed",{errorType:e instanceof Error?e.name:"UnknownError"});
  return response({error:"We couldn’t save or load this right now. Your current form has been kept. Please try again."},503);
 }
}
async function fileResponse(s:Services,key:string|null,name:string|null,mime:string|null){
 if(!key)throw new HttpError(404,"Document not found.");
 const object=await s.bucket.get(key);if(!object)throw new HttpError(404,"Document unavailable.");
 const safe=(name??"document").replace(/[^a-zA-Z0-9._ -]/g,"_");
 return new Response(object.body,{headers:{"Content-Type":mime??"application/octet-stream","Content-Disposition":'attachment; filename="'+safe+'"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'"}});
}
async function handleAdmin(s:Services,request:Request,user:Row,path:string):Promise<Response>{
 const method=request.method;
 if(path==="admin"&&method==="GET"){
  const caseCount=await first(s,"SELECT COUNT(*) AS total,SUM(CASE WHEN human_review_status='requested' THEN 1 ELSE 0 END) AS awaiting_review FROM cases");
  return response({cases:caseCount,affiliates:await first(s,"SELECT COUNT(*) AS total FROM affiliates"),paymentsReady:paymentsReady(s),rules:await first(s,"SELECT COUNT(*) AS total FROM rules WHERE active=1")});
 }
 if(path==="admin/cases"&&method==="GET")return response({cases:await rows(s,"SELECT c.*,u.email,t.username FROM cases c JOIN users u ON u.id=c.user_id JOIN tiktok_accounts t ON t.id=c.tiktok_account_id ORDER BY c.created_at DESC LIMIT 200")});
 const cm=path.match(/^admin\/cases\/([^/]+)(?:\/(notice|action))?$/);
 if(cm){
  const c=await ownedCase(s,cm[1],user,true);
  if(method==="GET"&&!cm[2])return response(await caseView(s,c,true));
  if(method==="GET"&&cm[2]==="notice"){const scan=await first(s,"SELECT * FROM scans WHERE id=?",c.scan_id);return await fileResponse(s,scan?.notice_file_key,scan?.notice_filename,scan?.notice_mime);}
  if(method==="POST"&&cm[2]==="action"){
   const b=parse(z.object({action:z.enum(["note","request_changes","match_rule","approve"]),note:z.string().max(10000).default(""),ruleId:z.string().max(100).optional(),consistencyConfirmed:z.boolean().optional(),procedureConfirmed:z.boolean().optional()}).strict(),await readJson(request));
   if(b.action==="note"||b.action==="request_changes"){
    if(!b.note.trim())throw new HttpError(400,"Add a note.");
    await statement(s,"INSERT INTO admin_notes (id,case_id,admin_user_id,note,created_at) VALUES (?,?,?,?,?)",uid(),c.id,user.id,b.note,timestamp(s)).run();
    if(b.action==="request_changes")await statement(s,"UPDATE cases SET review_note=?,human_review_status='changes_requested',status='building_case',appeal_json=NULL,consistency_checked=0,procedure_confirmed=0,updated_at=? WHERE id=?",b.note,timestamp(s),c.id).run();
    return response({saved:true});
   }
   requirePaid(c);
   if(b.action==="match_rule"){
    const source=await first(s,"SELECT * FROM rules WHERE id=? AND active=1",b.ruleId??"");const rule=source?rowRule(source):null;
    const found=rule?getMatchingRule({accountType:c.account_type,market:c.market,violationCategory:c.violation_category,enforcementType:c.enforcement_type} as any,[rule],timestamp(s)):null;
    if(!found)throw new HttpError(400,"The rule is not a current compatible rule for this case.");
    await statement(s,"UPDATE cases SET rule_id=?,rule_snapshot_json=?,updated_at=? WHERE id=?",rule!.id,JSON.stringify(rule),timestamp(s),c.id).run();await invalidateCase(s,c.id);return response({saved:true});
   }
   if(b.action==="approve"){
    if(!b.consistencyConfirmed||!b.procedureConfirmed)throw new HttpError(400,"Confirm the consistency and submission procedure reviews.");
    const rule=await ruleForCase(s,c);const d=await caseData(s,c);
    const facts={...d.facts,consistencyChecked:true,procedureConfirmed:true};
    const pack=generateAppeal(facts,rule?{...rule,manual_review_required:false}:null);
    if(!pack.ready)throw new HttpError(409,pack.blockingIssues.join(" "));
    const readiness=calculateReadiness(facts,rule?{...rule,manual_review_required:false}:null);
    await s.db.batch([statement(s,"UPDATE cases SET consistency_checked=1,procedure_confirmed=1,human_review_status='approved',status='ready',appeal_json=?,readiness_score=?,updated_at=? WHERE id=?",JSON.stringify(pack),readiness.score,timestamp(s),c.id),statement(s,"INSERT INTO admin_notes (id,case_id,admin_user_id,note,created_at) VALUES (?,?,?,?,?)",uid(),c.id,user.id,"Appeal approved after evidence, consistency and procedure review. "+b.note,timestamp(s))]);
    return response({approved:true,appeal:pack});
   }
  }
 }
 const em=path.match(/^admin\/evidence\/([^/]+)$/);
 if(em){
  const e=await first(s,"SELECT * FROM evidence WHERE id=?",em[1]);if(!e)throw new HttpError(404,"Document not found.");
  if(method==="GET")return await fileResponse(s,e.file_key,e.filename,e.mime);
  if(method==="PATCH"){
   const b=parse(z.object({status:z.enum(["verified","needs_review","rejected"]),analysis:EvidenceAnalysisSchema}).strict(),await readJson(request));
   if(b.status==="verified"&&(!b.analysis.relevant||b.analysis.inconsistencies.length))throw new HttpError(400,"A verified document must be relevant with no unresolved inconsistencies.");
   await statement(s,"UPDATE evidence SET status=?,analysis_json=? WHERE id=?",b.status,JSON.stringify(b.analysis),e.id).run();
   await invalidateCase(s,e.case_id);
   await statement(s,"INSERT INTO admin_notes (id,case_id,admin_user_id,note,created_at) VALUES (?,?,?,?,?)",uid(),e.case_id,user.id,"Document "+e.filename+" marked "+b.status+".",timestamp(s)).run();
   return response({saved:true});
  }
 }
 if(path==="admin/rules"){
  if(method==="GET")return response({rules:await rows(s,"SELECT * FROM rules ORDER BY last_verified_at DESC")});
  if(method==="POST"){
   const r=parse(RuleSchema,await readJson(request));
   if(!isOfficialSource(r.official_source)||r.last_verified_at>timestamp(s))throw new HttpError(400,"Use an official TikTok HTTPS source and a valid verification date.");
   await statement(s,"INSERT INTO rules (id,market,account_type,violation_category,enforcement_type,appeal_allowed,appeal_count,appeal_window,requirements_json,questions_json,common_errors_json,submission_notes_json,official_source,last_verified_at,active,manual_review_required) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET market=excluded.market,account_type=excluded.account_type,violation_category=excluded.violation_category,enforcement_type=excluded.enforcement_type,appeal_allowed=excluded.appeal_allowed,appeal_count=excluded.appeal_count,appeal_window=excluded.appeal_window,requirements_json=excluded.requirements_json,questions_json=excluded.questions_json,common_errors_json=excluded.common_errors_json,submission_notes_json=excluded.submission_notes_json,official_source=excluded.official_source,last_verified_at=excluded.last_verified_at,active=excluded.active,manual_review_required=excluded.manual_review_required",r.id,r.market,r.account_type,r.violation_category,r.enforcement_type,r.appeal_allowed===null?null:Number(r.appeal_allowed),r.appeal_count,r.appeal_window,JSON.stringify(r.requirements),JSON.stringify(r.questions),JSON.stringify(r.common_errors),JSON.stringify(r.submission_notes),r.official_source,r.last_verified_at,Number(r.active),Number(r.manual_review_required)).run();
   return response({saved:true});
  }
 }
 if(path==="admin/affiliates"&&method==="GET")return response({affiliates:await rows(s,"SELECT a.*,u.email,(SELECT COUNT(*) FROM attributions t WHERE t.affiliate_id=a.id) AS customers,(SELECT COUNT(*) FROM commissions c WHERE c.affiliate_id=a.id) AS sales FROM affiliates a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC")});
 if(path==="admin/commissions"&&method==="GET")return response({commissions:await rows(s,"SELECT c.*,a.code,u.email,p.refunded_amount FROM commissions c JOIN affiliates a ON a.id=c.affiliate_id JOIN users u ON u.id=a.user_id JOIN payments p ON p.id=c.payment_id ORDER BY c.created_at DESC LIMIT 300")});
 const commissionMatch=path.match(/^admin\/commissions\/([^/]+)$/);
 if(commissionMatch&&method==="PATCH"){
  const b=parse(z.object({status:z.enum(["approved","paid"]),payoutReference:z.string().max(200).default("")}).strict(),await readJson(request));
  const commission=await first(s,"SELECT c.*,p.status AS payment_status FROM commissions c JOIN payments p ON p.id=c.payment_id WHERE c.id=?",commissionMatch[1]);
  if(!commission||commission.payment_status!=="paid"||commission.eligible_at>timestamp(s))throw new HttpError(409,"Commission is not eligible.");
  if(b.status==="approved"&&commission.status!=="pending")throw new HttpError(409,"Only pending commissions can be approved.");
  if(b.status==="paid"&&(commission.status!=="approved"||!b.payoutReference.trim()))throw new HttpError(409,"Approve the commission and provide the manual transfer reference first.");
  const result=await statement(s,"UPDATE commissions SET status=?,paid_at=?,payout_reference=? WHERE id=? AND status=? AND EXISTS (SELECT 1 FROM payments WHERE id=payment_id AND status='paid')",b.status,b.status==="paid"?timestamp(s):null,b.payoutReference||null,commission.id,b.status==="paid"?"approved":"pending").run();
  if(!result.meta.changes)throw new HttpError(409,"Commission changed. Refresh and try again.");
  return response({saved:true});
 }
 const refundMatch=path.match(/^admin\/payments\/([^/]+)\/refund$/);
 if(refundMatch&&method==="POST")return response(await issueRefund(s,refundMatch[1]));
 throw new HttpError(404,"Admin action not found.");
}
