export const TIERS = [
 {id:"personal",name:"Personal Account Rescue",amount:2900,description:"Personal account bans and restrictions"},
 {id:"creator",name:"Creator Rescue",amount:7900,description:"Creator account restrictions"},
 {id:"monetization",name:"Creator Monetization Rescue",amount:12900,description:"Creator monetization restrictions"},
 {id:"shop_violation",name:"TikTok Shop Violation",amount:19900,description:"TikTok Shop creator and seller violations"},
 {id:"shop_suspension",name:"Shop Suspension",amount:34900,description:"Shop restrictions and suspensions"},
 {id:"funds",name:"Funds / Commission Rescue",amount:49900,description:"Withheld funds and commission issues"},
 {id:"complex",name:"Complex Review",amount:79900,description:"Multiple issues or rejected appeals"}
] as const;
export const ACCOUNT_TYPES = ["Personal","Creator","TikTok Shop Creator","TikTok Shop Seller"] as const;
export const CASE_STATUSES = ["scan_completed","payment_required","building_case","evidence_required","human_review","ready","submitted","pending_tiktok","approved","rejected","closed"] as const;
export const CURRENCY = "usd";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 20;
export const ATTRIBUTION_WINDOW_DAYS = 30;
export const COMMISSION_HOLD_DAYS = 14;
export const RULE_MAX_AGE_DAYS = 30; // Internal freshness threshold, not a TikTok policy.
export function tierById(id:string){return TIERS.find(t=>t.id===id);}
export function suggestTier(category:string|null,account:string|null){
 if(category==="funds_commission")return "funds";
 if(category==="appeal_rejected")return "complex";
 if(category==="shop_suspension")return "shop_suspension";
 if(category==="shop_violation")return "shop_violation";
 if(category==="monetization_restriction")return "monetization";
 return account==="Personal"?"personal":"creator";
}
export function money(cents:number,currency="USD"){return new Intl.NumberFormat("en-US",{style:"currency",currency}).format(cents/100);}
export function getAffiliateRate(affiliate:{boost_started_at:number;boost_ends_at:number},at:number){
 return at>=affiliate.boost_started_at&&at<=affiliate.boost_ends_at?70:40;
}
export function calculateCommission(amount:number,rate:number){
 if(!Number.isSafeInteger(amount)||amount<0||!Number.isInteger(rate)||rate<0||rate>100)throw new Error("Invalid commission input");
 return Math.round(amount*rate/100);
}
