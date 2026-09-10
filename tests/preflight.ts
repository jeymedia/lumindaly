import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {handleApi} from "../lib/lumindaly/api.ts";
import {analyzeNotice,getMatchingRule,applyRule,calculateReadiness,generateAppeal} from "../lib/lumindaly/engine.ts";
import {NoticeAnalysisSchema,AppealPackageSchema,type Services,type Rule} from "../lib/lumindaly/contracts.ts";
import {getAffiliateRate} from "../lib/lumindaly/config.ts";
import {validateFile,verifyStripeSignature} from "../lib/lumindaly/security.ts";
const sqlite=new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for(const f of readdirSync("drizzle").filter(x=>x.endsWith(".sql")).sort())sqlite.exec(readFileSync("drizzle/"+f,"utf8"));
class Statement{
 sql:string;values:any[];
 constructor(sql:string,values:any[]=[]){this.sql=sql;this.values=values;}
 bind(...v:any[]){return new Statement(this.sql,v);}
 async first(column?:string){const row=sqlite.prepare(this.sql).get(...this.values)??null;return column&&row?row[column]:row;}
 async all(){return {success:true,results:sqlite.prepare(this.sql).all(...this.values),meta:{}};}
 async run(){const r=sqlite.prepare(this.sql).run(...this.values);return {success:true,results:[],meta:{changes:Number(r.changes)}};}
}
const db={prepare:(q:string)=>new Statement(q),batch:async(items:Statement[])=>{sqlite.exec("BEGIN");try{const result=[];for(const item of items)result.push(await item.run());sqlite.exec("COMMIT");return result;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};
const blobs=new Map<string,ArrayBuffer>();
const bucket={put:async(k:string,v:ArrayBuffer)=>{blobs.set(k,v);return {};},get:async(k:string)=>blobs.has(k)?{body:new Response(blobs.get(k)!).body}:null,delete:async(k:string)=>{blobs.delete(k);}};
let clock=Date.UTC(2026,8,10,8,0,0);
const origin="https://lumindaly.test";
const sessions=new Map<string,any>(),intents=new Map<string,any>(),charges=new Map<string,any>();
let stripeCalls=0;
const fakeStripe:typeof fetch=async(input:any,init:any)=>{
 const u=new URL(String(input));const path=u.pathname.replace("/v1/","");
 if(path==="checkout/sessions"&&init.method==="POST"){
  stripeCalls++;const form=new URLSearchParams(init.body),id="cs_test_"+stripeCalls,pi="pi_test_"+stripeCalls,ch="ch_test_"+stripeCalls;
  const metadata:any={};for(const [k,v] of form)if(k.startsWith("metadata["))metadata[k.slice(9,-1)]=v;
  const amount=Number(form.get("line_items[0][price_data][unit_amount]"));
  const charge={id:ch,payment_intent:pi,created:Math.floor(clock/1000),amount_refunded:0,currency:"usd"};
  const intent={id:pi,status:"succeeded",amount_received:amount,currency:"usd",latest_charge:charge,metadata};
  const session={id,url:"https://checkout.stripe.com/c/pay/"+id,status:"open",payment_status:"unpaid",amount_total:amount,currency:"usd",metadata,payment_intent:pi};
  sessions.set(id,session);intents.set(pi,intent);charges.set(ch,charge);return Response.json(session);
 }
 if(path.startsWith("checkout/sessions/"))return Response.json(sessions.get(path.split("/")[2]));
 if(path.startsWith("payment_intents/"))return Response.json(intents.get(path.split("/")[1]));
 if(path.startsWith("charges/"))return Response.json(charges.get(path.split("/")[1]));
 throw new Error("Unexpected fake provider request: "+path);
};
const base:Services={db:db as any,bucket:bucket as any,auth:null,config:{APP_ORIGIN:origin,APP_ENV:"test",STRIPE_SECRET_KEY:"sk_test_fixture",STRIPE_WEBHOOK_SECRET:"whsec_fixture",STRIPE_MODE:"test",PAYMENTS_ENABLED:"true",MANUAL_REVIEW_ENABLED:"true",ADMIN_USER_IDS:"admin-fixture"},paymentFetch:fakeStripe,now:()=>clock};
const identity=(id:string)=>({id,email:id+"@example.test",displayName:id});
const as=(id:string|null)=>({...base,auth:id?identity(id):null});
async function call(path:string,method="GET",body?:unknown,id:string|null=null,cookie?:string){
 const headers:Record<string,string>={};if(method!=="GET")headers.Origin=origin;if(cookie)headers.Cookie=cookie;
 let content:BodyInit|undefined;if(body instanceof FormData)content=body;else if(body!==undefined){headers["Content-Type"]="application/json";content=JSON.stringify(body);}
 const r=await handleApi(new Request(origin+path,{method,headers,...(content?{body:content}:{})}),as(id));return {response:r,data:await r.clone().json().catch(()=>null)};
}
function ok(result:any,status=200){assert.equal(result.response.status,status,JSON.stringify(result.data));return result.data;}
function form(text="My personal account has been banned."){
 const f=new FormData();for(const [k,v] of Object.entries({noticeText:text,accountType:"Personal",market:"US",username:"fixture_creator",sanctionDate:"2026-09-09",previousAppeals:"0",financialExposure:""}))f.set(k,v);return f;
}
async function signed(event:any){const raw=JSON.stringify(event),t=Math.floor(clock/1000),key=await crypto.subtle.importKey("raw",new TextEncoder().encode("whsec_fixture"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(t+"."+raw))).toString("hex");return new Request(origin+"/api/stripe/webhook",{method:"POST",body:raw,headers:{"stripe-signature":"t="+t+",v1="+sig}});}
async function pay(caseId:string,eventId:string){
 const p=sqlite.prepare("SELECT * FROM payments WHERE case_id=?").get(caseId) as any;
 const session=sessions.get(p.stripe_session_id);session.status="complete";session.payment_status="paid";
 const event={id:eventId,type:"checkout.session.completed",livemode:false,data:{object:session}};
 const r=await handleApi(await signed(event),base);assert.equal(r.status,200,await r.clone().text());return event;
}
const intake={noticeText:"My personal account has been banned.",accountType:"Personal",market:"US",username:"fixture_creator",sanctionDate:"2026-09-09",previousAppeals:0,financialExposure:"",hasFile:false};
const analysis=analyzeNotice(intake);NoticeAnalysisSchema.parse(analysis);assert.equal(analysis.appealPossible,null);assert.equal(analysis.deadline,null);assert.equal(analysis.manualReviewRequired,true);
const imageOnly=analyzeNotice({...intake,noticeText:"",hasFile:true});NoticeAnalysisSchema.parse(imageOnly);assert.equal(imageOnly.confidence,0);assert.ok(imageOnly.missingInformation.length);
console.log("PASS A: text and screenshot-only intake produce valid, honest JSON.");
const fixture:Rule={id:"TEST_ONLY_rule_never_deployed",market:"US",account_type:"Personal",violation_category:"personal_account_ban",enforcement_type:"ban",appeal_allowed:true,appeal_count:1,appeal_window:null,requirements:{required:["Notice"],recommended:[]},questions:[],common_errors:[],submission_notes:["TEST FIXTURE ONLY"],official_source:"https://support.tiktok.com/en/TEST_ONLY_NOT_A_REAL_POLICY",last_verified_at:clock,active:true,manual_review_required:false};
assert.equal(getMatchingRule(analysis,[],clock),null);
assert.equal(getMatchingRule(analysis,[fixture,{...fixture,id:"ambiguous"}],clock),null);
assert.equal(getMatchingRule(analysis,[{...fixture,official_source:"https://tiktok.com.attacker.test/policy"}],clock),null);
assert.equal(getMatchingRule(analysis,[{...fixture,last_verified_at:clock-31*86400000}],clock),null);
assert.equal(getMatchingRule(analysis,[fixture],clock)?.id,fixture.id);
assert.equal(applyRule(analysis,fixture,1).appealsRemaining,0);
console.log("PASS B: verified matching, stale/ambiguous rejection, unknown => Manual Review.");
const verifiedAnalysis={documentType:"Notice",relevant:true,dates:[],names:[],amounts:[],keyFacts:["Fixture notice provided"],inconsistencies:[],confidence:1};
const facts={...intake,answers:{explanation:"I am asking for a review of the account action described in my attached notice."},evidence:[{id:"e",type:"Notice",status:"verified",name:"notice.png",analysis:verifiedAnalysis}],consistencyChecked:true,procedureConfirmed:true};
assert.equal(calculateReadiness(facts,fixture).score,100);
const pack=generateAppeal(facts,fixture);AppealPackageSchema.parse(pack);assert.equal(pack.ready,true);
assert.equal(generateAppeal(facts,null).ready,false);assert.equal(generateAppeal({...facts,noticeText:""},fixture).ready,false);
assert.equal(pack.appealStatement.includes("guarantee"),false);
console.log("PASS C: grounded AppealPackage; missing rule/facts block readiness.");
ok(await call("/api/me","GET",undefined,"partner-fixture"));
const partner=ok(await call("/api/partner/activate","POST",{accepted:true},"partner-fixture"),201).affiliate;
sqlite.prepare("UPDATE affiliates SET slug='testpartner' WHERE id=?").run(partner.id);
const ref=await call("/r/testpartner");assert.equal(ref.response.status,302);
const cookie=ref.response.headers.get("set-cookie")!.split(";")[0];
const scanResult=ok(await call("/api/scans","POST",form(),null,cookie),201);
assert.equal(scanResult.analysis.manualReviewRequired,true);
ok(await call("/api/me","GET",undefined,"buyer-fixture",cookie));
assert.equal((sqlite.prepare("SELECT affiliate_id FROM attributions WHERE customer_id=?").get("buyer-fixture") as any).affiliate_id,partner.id);
const c1=ok(await call("/api/cases","POST",{scanId:scanResult.id,tier:"personal"},"buyer-fixture",cookie),201).id;
const priceAttack=await call("/api/cases","POST",{scanId:scanResult.id,tier:"personal",amount:1},"buyer-fixture",cookie);assert.equal(priceAttack.response.status,400);
ok(await call("/api/cases/"+c1+"/checkout","POST",{},"buyer-fixture"));
const event=await pay(c1,"evt_fixture_1");const case1=sqlite.prepare("SELECT * FROM cases WHERE id=?").get(c1) as any;assert.equal(case1.payment_status,"paid");
const commission1=sqlite.prepare("SELECT * FROM commissions WHERE case_id=?").get(c1) as any;
assert.equal(commission1.commission_rate,70);assert.equal(commission1.commission_amount,2030);
const duplicate=await handleApi(await signed(event),base);assert.equal(duplicate.status,200);
assert.equal((sqlite.prepare("SELECT COUNT(*) AS total FROM commissions WHERE case_id=?").get(c1) as any).total,1);
console.log("PASS D/E (provider simulated): signed webhook unlocks the Case, creates one 70% commission; duplicate delivery is idempotent.");
const c2=ok(await call("/api/cases","POST",{scanId:scanResult.id,tier:"personal"},"buyer-fixture"),201).id;
ok(await call("/api/cases/"+c2+"/checkout","POST",{},"buyer-fixture"));
await pay(c2,"evt_fixture_2");
assert.equal((sqlite.prepare("SELECT affiliate_id FROM commissions WHERE case_id=?").get(c2) as any).affiliate_id,partner.id);
assert.equal(getAffiliateRate(partner,partner.boost_ends_at),70);assert.equal(getAffiliateRate(partner,partner.boost_ends_at+1),40);
clock+=31*86400000;
const c3=ok(await call("/api/cases","POST",{scanId:scanResult.id,tier:"creator"},"buyer-fixture"),201).id;
ok(await call("/api/cases/"+c3+"/checkout","POST",{},"buyer-fixture"));await pay(c3,"evt_fixture_3");
assert.equal((sqlite.prepare("SELECT commission_rate FROM commissions WHERE case_id=?").get(c3) as any).commission_rate,40);
assert.equal((sqlite.prepare("SELECT commission_rate FROM commissions WHERE case_id=?").get(c1) as any).commission_rate,70);
console.log("PASS: repeat purchases retain the customer attribution; boost boundary 70% → 40%; historical rates remain unchanged.");
const third=sqlite.prepare("SELECT * FROM payments WHERE case_id=?").get(c3) as any;
const charge=intents.get(third.stripe_payment_intent_id).latest_charge;charge.amount_refunded=third.amount;
const refundEvent={id:"evt_refund_fixture",type:"charge.refunded",livemode:false,data:{object:charge}};
let rr=await handleApi(await signed(refundEvent),base);assert.equal(rr.status,200,await rr.clone().text());
assert.equal((sqlite.prepare("SELECT status FROM commissions WHERE case_id=?").get(c3) as any).status,"cancelled");
assert.equal((sqlite.prepare("SELECT payment_status FROM cases WHERE id=?").get(c3) as any).payment_status,"refunded");
console.log("PASS: verified refund closes access and cancels the corresponding commission.");
ok(await call("/api/me","GET",undefined,"other-fixture"));
assert.equal((await call("/api/cases/"+c1,"GET",undefined,"other-fixture")).response.status,404);
assert.equal((await call("/api/scans/"+scanResult.id,"GET",undefined,"other-fixture")).response.status,404);
assert.equal((await call("/api/admin/cases","GET",undefined,"buyer-fixture")).response.status,403);
assert.equal((await call("/api/cases","GET")).response.status,401);
const csrf=await handleApi(new Request(origin+"/api/cases",{method:"POST",headers:{Origin:"https://attacker.test"},body:"{}"}),as("buyer-fixture"));assert.equal(csrf.status,403);
const badSig=await handleApi(new Request(origin+"/api/stripe/webhook",{method:"POST",headers:{"stripe-signature":"t=1,v1=bad"},body:"{}"}),base);assert.equal(badSig.status,400);
assert.equal(await verifyStripeSignature("{}","t=1,v1=bad","whsec_fixture",clock),false);
console.log("PASS: customer isolation, protected admin, anonymous access rejection, CSRF, webhook signature.");
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5RkAAAAASUVORK5CYII=","base64");
const evForm=new FormData();evForm.set("file",new File([png],"notice.png",{type:"image/png"}));evForm.set("type","Notice");
const ev=ok(await call("/api/cases/"+c1+"/evidence","POST",evForm,"buyer-fixture"),201);
assert.equal(ev.status,"needs_review");
assert.equal((await call("/api/evidence/"+ev.id,"GET",undefined,"other-fixture")).response.status,404);
assert.equal((await call("/api/evidence/"+ev.id,"GET",undefined,"buyer-fixture")).response.status,200);
await assert.rejects(()=>validateFile(new File(["not an image"],"x.png",{type:"image/png"})));
await assert.rejects(()=>validateFile(new File([new Uint8Array(8*1024*1024+1)],"x.pdf",{type:"application/pdf"})));
console.log("PASS: private upload/download, ownership, file signature and size limits.");
ok(await call("/api/me","GET",undefined,"admin-fixture"));
fixture.last_verified_at=clock;
ok(await call("/api/admin/rules","POST",fixture,"admin-fixture"));
ok(await call("/api/admin/cases/"+c1+"/action","POST",{action:"match_rule",ruleId:fixture.id},"admin-fixture"));
ok(await call("/api/cases/"+c1,"PATCH",{username:"fixture_creator",answers:facts.answers},"buyer-fixture"));
ok(await call("/api/admin/evidence/"+ev.id,"PATCH",{status:"verified",analysis:verifiedAnalysis},"admin-fixture"));
const approved=ok(await call("/api/admin/cases/"+c1+"/action","POST",{action:"approve",consistencyConfirmed:true,procedureConfirmed:true,note:"Test review."},"admin-fixture"));
assert.equal(approved.appeal.ready,true);
ok(await call("/api/cases/"+c1+"/outcome","POST",{status:"approved",restoredItems:["Account"],notes:"Test fixture outcome, not a real result."},"buyer-fixture"));
assert.equal((sqlite.prepare("SELECT status FROM cases WHERE id=?").get(c1) as any).status,"approved");
console.log("PASS: paid Case → uploaded evidence → human review → ready Appeal → recorded outcome.");
// A customer cannot obtain commissions on their own account.
const selfCookie=(await call("/r/testpartner")).response.headers.get("set-cookie")!.split(";")[0];
ok(await call("/api/me","GET",undefined,"partner-fixture",selfCookie));
assert.equal(sqlite.prepare("SELECT id FROM attributions WHERE customer_id=?").get("partner-fixture"),undefined);
console.log("PASS: self-referral excluded.");
// Refunded commissions cannot be marked paid; manual payout reference is required.
assert.equal((await call("/api/admin/commissions/"+(sqlite.prepare("SELECT id FROM commissions WHERE case_id=?").get(c3) as any).id,"PATCH",{status:"approved"},"admin-fixture")).response.status,409);
ok(await call("/api/admin/commissions/"+commission1.id,"PATCH",{status:"approved"},"admin-fixture"));
assert.equal((await call("/api/admin/commissions/"+commission1.id,"PATCH",{status:"paid"},"admin-fixture")).response.status,409);
ok(await call("/api/admin/commissions/"+commission1.id,"PATCH",{status:"paid",payoutReference:"TEST-MANUAL-TRANSFER"},"admin-fixture"));
console.log("PASS: manual payouts require eligible paid purchases and a transfer reference.");

// A refund that arrives before checkout completion must never unlock the case.
const c4=ok(await call("/api/cases","POST",{scanId:scanResult.id,tier:"shop_violation"},"buyer-fixture"),201).id;
ok(await call("/api/cases/"+c4+"/checkout","POST",{},"buyer-fixture"));
const p4=sqlite.prepare("SELECT * FROM payments WHERE case_id=?").get(c4) as any;
const session4=sessions.get(p4.stripe_session_id),charge4=intents.get(session4.payment_intent).latest_charge;
charge4.amount_refunded=p4.amount;
const earlyRefund={id:"evt_early_refund",type:"charge.refunded",livemode:false,data:{object:charge4}};
const earlyResponse=await handleApi(await signed(earlyRefund),base);assert.equal(earlyResponse.status,200,await earlyResponse.clone().text());
await pay(c4,"evt_completed_after_refund");
assert.equal((sqlite.prepare("SELECT payment_status FROM cases WHERE id=?").get(c4) as any).payment_status,"refunded");
assert.equal((sqlite.prepare("SELECT status FROM commissions WHERE case_id=?").get(c4) as any).status,"cancelled");
console.log("PASS: out-of-order refund followed by completion cannot restore paid access.");
// Current rule revocation overrides a previously ready package.
sqlite.prepare("UPDATE rules SET active=0 WHERE id=?").run(fixture.id);
const staleView=ok(await call("/api/cases/"+c1,"GET",undefined,"buyer-fixture"));
assert.equal(staleView.case.appeal.ready,false);
assert.ok(staleView.case.appeal.blockingIssues.some((v:string)=>v.includes("verified rule")));
console.log("PASS: revoked rules invalidate previously ready packages.");
// Modifying one purchased dossier never rewrites the notice in another.
const originalC2=ok(await call("/api/cases/"+c2,"GET",undefined,"buyer-fixture")).scan.notice_text;
ok(await call("/api/cases/"+c1,"PATCH",{username:"fixture_creator",noticeText:"Updated fixture: this account is restricted.",answers:facts.answers},"buyer-fixture"));
assert.equal(ok(await call("/api/cases/"+c2,"GET",undefined,"buyer-fixture")).scan.notice_text,originalC2);
assert.equal(ok(await call("/api/cases/"+c1,"GET",undefined,"buyer-fixture")).case.appeal,null);
console.log("PASS: per-case notice snapshots isolate edits and invalidate previous approval.");

sqlite.close();
console.log("\nPreflight complete. Uses isolated SQLite, private in-memory object storage, and a simulated Stripe API. No real funds, policies, users, or referrals were created.");
