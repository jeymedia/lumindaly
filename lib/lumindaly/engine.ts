import {NoticeAnalysisSchema, EvidenceAnalysisSchema, AppealPackageSchema, type NoticeAnalysis,type Rule,type Intake,type CaseFacts,type Readiness,type EvidenceAnalysis,type AppealPackage} from "./contracts.ts";
import {RULE_MAX_AGE_DAYS} from "./config.ts";
export function isOfficialSource(value:string){try{const u=new URL(value);return u.protocol==="https:"&&(u.hostname==="tiktok.com"||u.hostname.endsWith(".tiktok.com"));}catch{return false;}}
export function analyzeNotice(input:Intake):NoticeAnalysis{
 const text=input.noticeText.toLowerCase();
 // Conservative intake classification only. This never supplies platform policy or a deadline.
 let category:string|null=null,enforcement:string|null=null;
 if(/appeal.{0,35}(rejected|denied|unsuccessful)/.test(text)){category="appeal_rejected";enforcement="appeal_rejected";}
 else if(/commission|funds|balance|withdrawal|payout/.test(text)){category="funds_commission";enforcement=/withheld|frozen|hold|blocked/.test(text)?"funds_restricted":null;}
 else if(/shop/.test(text)&&/suspend|suspension|deactivat/.test(text)){category="shop_suspension";enforcement="suspension";}
 else if(/shop/.test(text)&&/violation|restrict/.test(text)){category="shop_violation";enforcement="restriction";}
 else if(/monetiz|creator rewards|rewards program/.test(text)){category="monetization_restriction";enforcement="restriction";}
 else if(/\b(banned|ban)\b/.test(text)){category=input.accountType==="Personal"?"personal_account_ban":"creator_restriction";enforcement="ban";}
 else if(/restricted|restriction|suspended/.test(text)){category="creator_restriction";enforcement=/suspend/.test(text)?"suspension":"restriction";}
 const missing:string[]=[];
 if(!input.noticeText.trim())missing.push("The exact text of the notice. Your screenshot is saved for review.");
 if(!category)missing.push("The action and reason stated in TikTok’s notice.");
 if(!input.username)missing.push("The TikTok username connected to this notice.");
 if(!input.sanctionDate)missing.push("The date you received the notice.");
 if(!input.market)missing.push("The account market.");
 return NoticeAnalysisSchema.parse({accountType:input.accountType,market:input.market,violationCategory:category,enforcementType:enforcement,severity:null,appealPossible:null,appealsRemaining:null,deadline:null,confidence:category?0.55:0,requiredEvidenceCategories:[],missingInformation:missing,manualReviewRequired:true});
}
export function getMatchingRule(analysis:NoticeAnalysis,rules:Rule[]=[],now=Date.now()):Rule|null{
 if(!analysis.violationCategory||!analysis.enforcementType||!analysis.market||!analysis.accountType)return null;
 const matches=rules.filter(r=>r.active&&isOfficialSource(r.official_source)&&r.last_verified_at<=now&&now-r.last_verified_at<=RULE_MAX_AGE_DAYS*86400000&&r.market===analysis.market&&r.account_type===analysis.accountType&&r.violation_category===analysis.violationCategory&&r.enforcement_type===analysis.enforcementType);
 return matches.length===1?matches[0]:null; // Ambiguous matches require a person.
}
export function applyRule(analysis:NoticeAnalysis,rule:Rule|null,previousAppeals=0):NoticeAnalysis{
 if(!rule)return NoticeAnalysisSchema.parse({...analysis,manualReviewRequired:true,appealPossible:null,appealsRemaining:null,deadline:null,requiredEvidenceCategories:[]});
 return NoticeAnalysisSchema.parse({...analysis,appealPossible:rule.appeal_allowed,appealsRemaining:rule.appeal_count===null?null:Math.max(0,rule.appeal_count-previousAppeals),deadline:null,requiredEvidenceCategories:rule.requirements.required,manualReviewRequired:rule.manual_review_required||rule.appeal_allowed===null});
}
export function calculateReadiness(f:CaseFacts,rule:Rule|null):Readiness{
 const identification=[!!f.username,!!f.market,!!f.accountType,!!f.noticeText.trim()].filter(Boolean).length*5;
 const required=rule?.requirements.required??[];
 const verified=f.evidence.filter(e=>e.status==="verified"&&e.analysis.relevant);
 const evidence=rule?(required.length?Math.floor(required.filter(t=>verified.some(e=>e.type===t)).length/required.length*40):40):0;
 const inconsistencies=f.evidence.flatMap(e=>e.analysis.inconsistencies);
 const consistency=f.consistencyChecked&&!inconsistencies.length?20:0;
 const explanation=(f.answers.explanation??"").trim().length>=20?10:0;
 const procedure=rule&&f.procedureConfirmed?10:0;
 const blockers:string[]=[];
 if(!rule)blockers.push("No unique, current, verified rule is available. Manual review required.");
 if(rule?.manual_review_required)blockers.push("This rule requires human review.");
 if(rule?.appeal_allowed===false)blockers.push("The matched rule does not permit an appeal.");
 if(rule?.appeal_allowed===null)blockers.push("Appeal eligibility must be verified.");
 if(rule?.appeal_count!==null&&rule?.appeal_count!==undefined&&f.previousAppeals>=rule.appeal_count)blockers.push("The available appeal count must be reviewed.");
 if(!f.noticeText.trim())blockers.push("Confirm the exact notice text.");
 if(!f.username||!f.market||!f.accountType)blockers.push("Complete the account identification.");
 for(const t of required)if(!verified.some(e=>e.type===t))blockers.push("Provide and review: "+t+".");
 for(const q of rule?.questions??[])if(q.required&&!(f.answers[q.id]??"").trim())blockers.push("Answer: "+q.label);
 if(!consistency)blockers.push("Complete the consistency review.");
 if(!explanation)blockers.push("Add a factual explanation of what happened.");
 if(!procedure)blockers.push("Confirm the current submission procedure and deadline, or that none is specified.");
 if(inconsistencies.length)blockers.push(...inconsistencies);
 return {score:identification+evidence+consistency+explanation+procedure,components:{identification,evidence,consistency,explanation,procedure},blockers};
}
export function analyzeEvidence(input:{type:string;name:string}):EvidenceAnalysis{
 // Upload validation is not a content review. A person reviews V1 documents.
 return EvidenceAnalysisSchema.parse({documentType:input.type||null,relevant:false,dates:[],names:[],amounts:[],keyFacts:[],inconsistencies:[],confidence:0});
}
export function generateAppeal(f:CaseFacts,rule:Rule|null):AppealPackage{
 const r=calculateReadiness(f,rule);
 const confirmed=f.evidence.filter(e=>e.status==="verified"&&e.analysis.relevant);
 const explanation=(f.answers.explanation??"").trim();
 const summary=[f.username?"Account: @"+f.username.replace(/^@/,""):"",f.accountType?"Account type: "+f.accountType:"",f.market?"Market: "+f.market:"",f.sanctionDate?"Notice received: "+f.sanctionDate:""].filter(Boolean).join("\n");
 const statement=explanation?["Hello TikTok review team,","","I am requesting a review of the action described in the notice for @"+f.username.replace(/^@/,"")+".","",explanation,"",...(confirmed.length?["Supporting documents included:",...confirmed.map((e,i)=>(i+1)+". "+e.name),""]:[]),"Please review the notice and the supporting information provided. Thank you."].join("\n"):"";
 return AppealPackageSchema.parse({caseSummary:summary,appealStatement:statement,evidenceChecklist:rule?.requirements.required??[],evidenceOrder:confirmed.map(e=>e.name),submissionNotes:rule?.submission_notes??[],ready:r.blockers.length===0,blockingIssues:r.blockers});
}
