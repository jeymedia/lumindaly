declare namespace Cloudflare {
 interface Env {
  DB?:D1Database; BUCKET?:R2Bucket;
  APP_ORIGIN?:string;APP_ENV?:string;
  STRIPE_SECRET_KEY?:string;STRIPE_WEBHOOK_SECRET?:string;STRIPE_MODE?:string;
  ADMIN_USER_IDS?:string;PAYMENTS_ENABLED?:string;MANUAL_REVIEW_ENABLED?:string;
  WORKERS_AI_ENABLED?:string;CLOUDFLARE_ACCOUNT_ID?:string;CLOUDFLARE_AI_TOKEN?:string;WORKERS_AI_MODEL?:string;
 }
}
