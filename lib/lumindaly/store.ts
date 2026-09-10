import type {Services,Rule,CaseFacts,AuthIdentity} from "./contracts.ts";
import {RuleSchema} from "./contracts.ts";
import {HttpError,sha256,cookieValue,randomToken,privateCookie} from "./security.ts";
export type Row=Record<string,any>;
export const uid=()=>crypto.randomUUID();
export const timestamp=(s:Services)=>s.now?.()??Date.now();
export const statement=(s:Services,sql:string,...values:unknown[])=>s.db.prepare(sql).bind(...values as any[]);
export async function first(s:Services,sql:string,...values:unknown[]):Promise<Row|null>{return statement(s,sql,...values).first<Row>();}
export async function rows(s:Services,sql:string,...values:unknown[]):Promise<Row[]>{return (await statement(s,sql,...values).all<Row>()).results;}
export function jsonParse<T=any>(value:string|null|undefined,fallback:unknown):T{try{return value?JSON.parse(value):fallback as T;}catch{return fallback as T;}}
export function isAdmin(s:Services,user:Row|null){return !!user&&(user.role==="admin"||(s.config.ADMIN_USER_IDS??"").split(",").map(x=>x.trim()).includes(user.id));}
export async function anonymous(s:Services,request:Request,create=false):Promise<{visitor:Row;cookie:string|null}|null>{
 const token=cookieValue(request,"lm_visitor");
 if(token&&/^[a-f0-9]{64}$/.test(token)){const id=await sha256(token);const visitor=await first(s,"SELECT * FROM anonymous_visitors WHERE id = ?",id);if(visitor)return {visitor,cookie:null};}
 if(!create)return null;
 const fresh=randomToken(),id=await sha256(fresh);
 await statement(s,"INSERT INTO anonymous_visitors (id, created_at) VALUES (?, ?)",id,timestamp(s)).run();
 return {visitor:{id,affiliate_id:null},cookie:privateCookie(request,"lm_visitor",fresh,90*86400)};
}
export async function currentUser(s:Services,request:Request,required=false):Promise<(Row & {is_admin:boolean})|null>{
 if(!s.auth){if(required)throw new HttpError(401,"Sign in to keep your case and continue.");return null;}
 const now=timestamp(s);
 await statement(s,"INSERT INTO users (id,email,role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at",s.auth.id,s.auth.email,"customer",now,now).run();
 const anon=await anonymous(s,request);
 if(anon){
  const v=anon.visitor;
  // First eligible referral becomes customer-owned. A future visit never overwrites it.
  await s.db.batch([
   statement(s,"INSERT INTO attributions (id,affiliate_id,customer_id,source,created_at,status) SELECT ?,a.id,?,'referral_link',?,'active' FROM affiliates a WHERE a.id=? AND a.user_id<>? AND a.status='active' AND ? >= ? ON CONFLICT(customer_id) DO NOTHING",uid(),s.auth.id,now,v.affiliate_id??null,s.auth.id,v.expires_at??0,now),
   statement(s,"UPDATE scans SET user_id = ? WHERE anonymous_id = ? AND user_id IS NULL",s.auth.id,v.id)
  ]);
 }
 const user=await first(s,"SELECT * FROM users WHERE id = ?",s.auth.id);
 return {...user!,is_admin:isAdmin(s,user)};
}
export async function ownedScan(s:Services,request:Request,id:string,user:Row|null){
 const scan=await first(s,"SELECT * FROM scans WHERE id = ?",id);
 if(!scan)throw new HttpError(404,"Scan not found.");
 if(user&&scan.user_id===user.id)return scan;
 const anon=await anonymous(s,request);
 if(scan.user_id===null&&anon&&scan.anonymous_id===anon.visitor.id)return scan;
 throw new HttpError(404,"Scan not found.");
}
export async function ownedCase(s:Services,id:string,user:Row,admin=false){
 const c=await first(s,"SELECT c.*,t.username,t.account_type FROM cases c JOIN tiktok_accounts t ON t.id=c.tiktok_account_id WHERE c.id = ? "+(admin&&user.is_admin?"":"AND c.user_id = ?"),...[id,...(admin&&user.is_admin?[]:[user.id])]);
 if(!c)throw new HttpError(404,"Case not found.");return c;
}
export function requirePaid(c:Row){if(c.payment_status!=="paid")throw new HttpError(402,"This case needs a confirmed payment before you can continue.");}
export function rowRule(row:Row):Rule|null{
 const parsed=RuleSchema.safeParse({id:row.id,market:row.market,account_type:row.account_type,violation_category:row.violation_category,enforcement_type:row.enforcement_type,appeal_allowed:row.appeal_allowed===null?null:!!row.appeal_allowed,appeal_count:row.appeal_count,appeal_window:row.appeal_window,requirements:jsonParse(row.requirements_json,{required:[],recommended:[]}),questions:jsonParse(row.questions_json,[]),common_errors:jsonParse(row.common_errors_json,[]),submission_notes:jsonParse(row.submission_notes_json,[]),official_source:row.official_source,last_verified_at:row.last_verified_at,active:!!row.active,manual_review_required:!!row.manual_review_required});
 return parsed.success?parsed.data:null;
}
export async function activeRules(s:Services){return (await rows(s,"SELECT * FROM rules WHERE active=1")).map(rowRule).filter((x):x is Rule=>!!x);}
export async function caseData(s:Services,c:Row){
 const scan=(await first(s,"SELECT * FROM scans WHERE id=?",c.scan_id))!;
 const ev=await rows(s,"SELECT * FROM evidence WHERE case_id=? ORDER BY created_at",c.id);
 const intake=jsonParse(c.intake_json??scan.intake_json,{});
 const facts:CaseFacts={username:c.username,market:c.market,accountType:c.account_type,noticeText:c.notice_text??scan.notice_text,sanctionDate:intake.sanctionDate??"",answers:jsonParse(c.answers_json,{}),previousAppeals:intake.previousAppeals??0,evidence:ev.map(e=>({id:e.id,type:e.type,status:e.status,name:e.filename,analysis:jsonParse(e.analysis_json,{inconsistencies:[],keyFacts:[],relevant:false})})),consistencyChecked:!!c.consistency_checked,procedureConfirmed:!!c.procedure_confirmed};
 return {scan,evidence:ev,facts};
}
export async function rateLimit(s:Services,key:string,limit:number,period=3600000){
 const now=timestamp(s);const result=await first(s,"INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count",key,now+period,now,now);
 if(Number(result?.count)>limit)throw new HttpError(429,"Too many requests. Please try again later.");
}
