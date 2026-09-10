import type {Services} from "./contracts.ts";
import {CURRENCY,COMMISSION_HOLD_DAYS,getAffiliateRate,calculateCommission,tierById} from "./config.ts";
import {HttpError,verifyStripeSignature,boundedBody} from "./security.ts";
import {type Row,first,statement,timestamp,uid} from "./store.ts";
export function paymentsReady(s:Services){return s.config.PAYMENTS_ENABLED==="true"&&new RegExp("^(sk|rk)_"+(s.config.STRIPE_MODE==="live"?"live":"test")+"_").test(s.config.STRIPE_SECRET_KEY??"")&&!!s.config.STRIPE_WEBHOOK_SECRET&&!!s.config.APP_ORIGIN;}
async function stripe(s:Services,path:string,params?:URLSearchParams,idempotency?:string){
 const headers:Record<string,string>={Authorization:"Bearer "+s.config.STRIPE_SECRET_KEY,"Stripe-Version":"2025-02-24.acacia"};
 if(params)headers["Content-Type"]="application/x-www-form-urlencoded";if(idempotency)headers["Idempotency-Key"]=idempotency;
 const r=await (s.paymentFetch??fetch)("https://api.stripe.com/v1/"+path,{method:params?"POST":"GET",headers,...(params?{body:params.toString()}:{})});
 const data=await r.json() as Row;
 if(!r.ok)throw new HttpError(502,"The payment provider could not complete this request. Please try again.");
 return data;
}
export async function createCheckout(s:Services,c:Row,user:Row){
 if(!paymentsReady(s))throw new HttpError(503,"Checkout is not open yet. Your scan and case are saved.");
 if(c.payment_status==="paid")throw new HttpError(409,"This case is already paid.");
 if(c.payment_status==="refunded")throw new HttpError(409,"This case was refunded. Start a new case for a new purchase.");
 const tier=tierById(c.product_tier);if(!tier)throw new HttpError(400,"Invalid case package.");
 const origin=s.config.APP_ORIGIN!;if(!origin.startsWith("https://")&&s.config.APP_ENV!=="test")throw new HttpError(503,"Secure checkout is not configured.");
 const now=timestamp(s);
 await statement(s,"INSERT INTO payments (id,user_id,case_id,amount,currency,status,created_at) VALUES (?,?,?,?,?,'pending',?) ON CONFLICT(case_id) DO NOTHING",uid(),user.id,c.id,tier.amount,CURRENCY,now).run();
 let payment=(await first(s,"SELECT * FROM payments WHERE case_id=?",c.id))!;
 if(payment.status==="paid")throw new HttpError(409,"This case is already paid.");
 if(payment.stripe_session_id){
  const existing=await stripe(s,"checkout/sessions/"+encodeURIComponent(payment.stripe_session_id));
  if(existing.status==="open"&&existing.url)return {url:existing.url};
  if(existing.status==="complete")return {url:origin+"/case/"+c.id+"?payment=processing"};
  throw new HttpError(409,"This checkout expired. Start a new case from your saved scan.");
 }
 const attribution=await first(s,"SELECT a.* FROM attributions t JOIN affiliates a ON a.id=t.affiliate_id WHERE t.customer_id=? AND t.status='active' AND a.status='active' AND a.user_id<>?",user.id,user.id);
 const params=new URLSearchParams({mode:"payment","payment_method_types[0]":"card","customer_email":user.email,"client_reference_id":c.id,success_url:origin+"/case/"+c.id+"?payment=processing",cancel_url:origin+"/case/"+c.id+"?payment=cancelled","line_items[0][price_data][currency]":CURRENCY,"line_items[0][price_data][unit_amount]":String(tier.amount),"line_items[0][price_data][product_data][name]":tier.name,"line_items[0][quantity]":"1","metadata[user_id]":user.id,"metadata[case_id]":c.id,"metadata[product_tier]":tier.id,"metadata[affiliate_id]":attribution?.id??"","metadata[payment_id]":payment.id,"payment_intent_data[metadata][case_id]":c.id,"payment_intent_data[metadata][payment_id]":payment.id});
 const session=await stripe(s,"checkout/sessions",params,"lumindaly-checkout-"+payment.id);
 if(typeof session.id!=="string"||typeof session.url!=="string"||!session.url.startsWith("https://checkout.stripe.com/"))throw new HttpError(502,"Invalid checkout response.");
 await statement(s,"UPDATE payments SET stripe_session_id=?,affiliate_id=? WHERE id=? AND status='pending'",session.id,attribution?.id??null,payment.id).run();
 return {url:session.url};
}
export async function handleStripeWebhook(s:Services,req:Request){
 const raw=new TextDecoder().decode(await boundedBody(req,1048576));
 if(!await verifyStripeSignature(raw,req.headers.get("stripe-signature"),s.config.STRIPE_WEBHOOK_SECRET??"",timestamp(s)))throw new HttpError(400,"Invalid payment signature.");
 let event:Row;try{event=JSON.parse(raw);}catch{throw new HttpError(400,"Invalid payment event.");}
 if(typeof event.id!=="string"||typeof event.type!=="string"||!event.data?.object)throw new HttpError(400,"Invalid payment event.");
 if(s.config.STRIPE_MODE==="live"&&event.livemode!==true)throw new HttpError(400,"Wrong payment mode.");
 if(s.config.STRIPE_MODE!=="live"&&event.livemode===true)throw new HttpError(400,"Wrong payment mode.");
 if(await first(s,"SELECT id FROM stripe_events WHERE id=?",event.id))return {received:true,duplicate:true};
 const object=event.data.object as Row;
 if(["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type)){
  if(object.payment_status!=="paid")return {received:true,awaiting_payment:true};
  // Retrieve the canonical session; never unlock from a success URL or client-supplied amount.
  const verified=await stripe(s,"checkout/sessions/"+encodeURIComponent(object.id));
  if(verified.payment_status!=="paid"||verified.status!=="complete")throw new HttpError(400,"Payment is not complete.");
  if(typeof verified.payment_intent!=="string")throw new HttpError(400,"Payment intent missing.");
  const meta=verified.metadata??{};
  const p=await first(s,"SELECT * FROM payments WHERE id=?",meta.payment_id);
  if(!p||p.case_id!==meta.case_id||p.user_id!==meta.user_id||p.stripe_session_id!==verified.id||p.amount!==verified.amount_total||p.currency!==verified.currency)throw new HttpError(400,"Payment does not match the case.");
  const c=await first(s,"SELECT * FROM cases WHERE id=?",p.case_id);
  if(!c||meta.product_tier!==c.product_tier||meta.affiliate_id!==(p.affiliate_id??""))throw new HttpError(400,"Payment metadata mismatch.");
  const intent=await stripe(s,"payment_intents/"+encodeURIComponent(verified.payment_intent)+"?expand%5B%5D=latest_charge");
  if(intent.status!=="succeeded"||intent.amount_received!==p.amount||intent.currency!==p.currency)throw new HttpError(400,"Payment amount verification failed.");
  const charge=typeof intent.latest_charge==="object"?intent.latest_charge:null;
  if(!charge||typeof charge.created!=="number")throw new HttpError(502,"Payment timestamp could not be verified.");
  const paidAt=charge.created*1000,refunded=Number(charge.amount_refunded??0),now=timestamp(s);
  const attribution=await first(s,"SELECT a.* FROM attributions t JOIN affiliates a ON a.id=t.affiliate_id WHERE t.customer_id=? AND t.affiliate_id=? AND t.status='active' AND a.status='active' AND a.user_id<>?",p.user_id,p.affiliate_id??null,p.user_id);
  const rate=attribution?getAffiliateRate(attribution as {boost_started_at:number;boost_ends_at:number},paidAt):null;
  const batch=[
   statement(s,"INSERT INTO stripe_events (id,type,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",event.id,event.type,now),
   statement(s,"UPDATE payments SET status=CASE WHEN refunded_amount>0 OR ?>0 THEN 'refunded' ELSE 'paid' END,stripe_payment_intent_id=?,paid_at=COALESCE(paid_at,?),refunded_amount=MAX(refunded_amount,?),commission_rate=COALESCE(commission_rate,?) WHERE id=? AND status IN ('pending','paid','refunded')",refunded,verified.payment_intent,paidAt,refunded,rate,p.id),
   statement(s,"UPDATE cases SET payment_status=(SELECT status FROM payments WHERE id=?),status=CASE WHEN (SELECT status FROM payments WHERE id=?)='refunded' THEN 'closed' WHEN status='payment_required' THEN 'building_case' ELSE status END,updated_at=? WHERE id=?",p.id,p.id,now,p.case_id)
  ];
  if(attribution&&rate!==null)batch.push(statement(s,"INSERT INTO commissions (id,affiliate_id,customer_id,case_id,payment_id,gross_amount,commission_rate,commission_amount,status,eligible_at,created_at) SELECT ?,?,?,?,?,?,commission_rate,?,CASE WHEN status='refunded' THEN 'cancelled' ELSE 'pending' END,?,? FROM payments WHERE id=? ON CONFLICT(payment_id) DO NOTHING",uid(),attribution.id,p.user_id,p.case_id,p.id,p.amount,calculateCommission(p.amount,rate),paidAt+COMMISSION_HOLD_DAYS*86400000,now,p.id));
  batch.push(statement(s,"UPDATE commissions SET status='cancelled' WHERE payment_id=? AND EXISTS (SELECT 1 FROM payments WHERE id=? AND status='refunded')",p.id,p.id));
  await s.db.batch(batch);
  return {received:true};
 }
 if(event.type==="charge.refunded"){
  const intentId=typeof object.payment_intent==="string"?object.payment_intent:object.payment_intent?.id;
  let p=await first(s,"SELECT * FROM payments WHERE stripe_payment_intent_id=?",intentId??null);
  if(!p&&intentId){const intent=await stripe(s,"payment_intents/"+encodeURIComponent(intentId));p=await first(s,"SELECT * FROM payments WHERE id=?",intent.metadata?.payment_id??null);}
  if(!p)throw new HttpError(409,"Original payment not recorded yet. Retry this event.");
  const charge=await stripe(s,"charges/"+encodeURIComponent(object.id));
  if(charge.payment_intent!==intentId||!Number.isSafeInteger(charge.amount_refunded)||charge.amount_refunded<=0||charge.currency!==p.currency)throw new HttpError(400,"Refund verification failed.");
  await s.db.batch([
   statement(s,"INSERT INTO stripe_events (id,type,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",event.id,event.type,timestamp(s)),
   statement(s,"UPDATE payments SET status='refunded',refunded_amount=MAX(refunded_amount,?),stripe_payment_intent_id=? WHERE id=?",charge.amount_refunded,intentId,p.id),
   statement(s,"UPDATE cases SET payment_status='refunded',status='closed',updated_at=? WHERE id=?",timestamp(s),p.case_id),
   statement(s,"UPDATE commissions SET status='cancelled' WHERE payment_id=?",p.id)
  ]);return {received:true};
 }
 await statement(s,"INSERT INTO stripe_events (id,type,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",event.id,event.type,timestamp(s)).run();
 return {received:true,ignored:true};
}
export async function issueRefund(s:Services,paymentId:string){
 const p=await first(s,"SELECT * FROM payments WHERE id=?",paymentId);
 if(!p||p.status!=="paid"||!p.stripe_payment_intent_id)throw new HttpError(400,"This payment cannot be refunded.");
 const result=await stripe(s,"refunds",new URLSearchParams({payment_intent:p.stripe_payment_intent_id}),"lumindaly-refund-"+p.id);
 return {requested:true,status:result.status}; // Webhook remains the authority for refunds.
}
