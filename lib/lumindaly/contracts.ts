import {z} from "zod";
export const NoticeAnalysisSchema=z.object({
 accountType:z.string().nullable(),market:z.string().nullable(),violationCategory:z.string().nullable(),enforcementType:z.string().nullable(),
 severity:z.enum(["low","medium","high","critical"]).nullable(),appealPossible:z.boolean().nullable(),appealsRemaining:z.number().int().min(0).nullable(),
 deadline:z.string().nullable(),confidence:z.number().min(0).max(1),requiredEvidenceCategories:z.array(z.string()),missingInformation:z.array(z.string()),manualReviewRequired:z.boolean()
}).strict();
export type NoticeAnalysis=z.infer<typeof NoticeAnalysisSchema>;
export const EvidenceAnalysisSchema=z.object({
 documentType:z.string().nullable(),relevant:z.boolean(),dates:z.array(z.string()),names:z.array(z.string()),amounts:z.array(z.string()),keyFacts:z.array(z.string()),inconsistencies:z.array(z.string()),confidence:z.number().min(0).max(1)
}).strict();
export type EvidenceAnalysis=z.infer<typeof EvidenceAnalysisSchema>;
export const AppealPackageSchema=z.object({
 caseSummary:z.string(),appealStatement:z.string(),evidenceChecklist:z.array(z.string()),evidenceOrder:z.array(z.string()),submissionNotes:z.array(z.string()),ready:z.boolean(),blockingIssues:z.array(z.string())
}).strict();
export type AppealPackage=z.infer<typeof AppealPackageSchema>;
export const QuestionSchema=z.object({id:z.string().min(1).max(80),label:z.string().min(1).max(500),required:z.boolean().default(true)});
export const RuleSchema=z.object({
 id:z.string().min(1).max(100),market:z.string().min(2).max(10),account_type:z.string().min(1).max(50),violation_category:z.string().min(1).max(100),enforcement_type:z.string().min(1).max(100),
 appeal_allowed:z.boolean().nullable(),appeal_count:z.number().int().nonnegative().nullable(),appeal_window:z.string().max(500).nullable(),
 requirements:z.object({required:z.array(z.string().max(150)).max(30),recommended:z.array(z.string().max(150)).max(30)}),
 questions:z.array(QuestionSchema).max(30),common_errors:z.array(z.string().max(1000)).max(30),submission_notes:z.array(z.string().max(2000)).max(20),
 official_source:z.string().url(),last_verified_at:z.number().int().positive(),active:z.boolean(),manual_review_required:z.boolean().default(false)
}).strict();
export type Rule=z.infer<typeof RuleSchema>;
export type Intake={noticeText:string;accountType:string|null;market:string|null;username:string;sanctionDate:string;previousAppeals:number;financialExposure:string;hasFile:boolean};
export type CaseFacts={username:string;market:string;accountType:string;noticeText:string;sanctionDate:string;answers:Record<string,string>;evidence:Array<{id:string;type:string;status:string;name:string;analysis:EvidenceAnalysis}>;consistencyChecked:boolean;procedureConfirmed:boolean;previousAppeals:number};
export type Readiness={score:number;components:{identification:number;evidence:number;consistency:number;explanation:number;procedure:number};blockers:string[]};
export type AuthIdentity={id:string;email:string;displayName:string};
export type RuntimeConfig={APP_ORIGIN?:string;STRIPE_SECRET_KEY?:string;STRIPE_WEBHOOK_SECRET?:string;STRIPE_MODE?:string;ADMIN_USER_IDS?:string;PAYMENTS_ENABLED?:string;MANUAL_REVIEW_ENABLED?:string;WORKERS_AI_ENABLED?:string;CLOUDFLARE_ACCOUNT_ID?:string;CLOUDFLARE_AI_TOKEN?:string;WORKERS_AI_MODEL?:string;APP_ENV?:string};
export type Services={db:D1Database;bucket:R2Bucket;auth:AuthIdentity|null;config:RuntimeConfig;paymentFetch?:typeof fetch;now?:()=>number};
