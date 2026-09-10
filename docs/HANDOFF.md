# Technical handoff

## Source and runtime
- Frontend: app/page.tsx (landing), app/[...path]/page.tsx (application routes), components/lumindaly/.
- Backend: app/api/[...segments]/route.ts, lib/lumindaly/api.ts.
- Runtime adapter: lib/lumindaly/runtime.ts. Cloudflare env is accessed only on the server.
- Database: db/schema.ts, generated drizzle migrations. All application SQL uses prepared statements. Related financial mutations use D1 batches.
- Files: private R2 BUCKET; every read checks scan ownership, case ownership or admin privileges.
- Configuration and all package prices: lib/lumindaly/config.ts.

## Authentication
The current Sites platform supports dispatch-owned Sign in with ChatGPT. Public scan pages do not require product sign-in. Protected browser routes redirect through the platform helper. API routes enforce identity and ownership on the server.

No app-owned password authentication was added. A future standalone deployment must provide an equivalent trusted identity adapter before exposing the Worker; raw oai-authenticated-* headers are trustworthy only behind the Sites dispatcher that supplies them. Do not expose a direct Worker origin that accepts visitor-supplied identity headers.

Admin access is an explicit ADMIN_USER_IDS allowlist, plus an existing administrator role. There is no first-user-becomes-admin behavior. The restricted /admin screen displays a signed-in user's stable identifier for owner configuration.

Private publishing keeps the entire Site owner-only. An anonymous commercial launch and Stripe callbacks require an appropriate public audience and a verified reachable webhook route.

## AI ENGINE contract
lib/lumindaly/contracts.ts defines strict Zod schemas and TypeScript types for NoticeAnalysis, EvidenceAnalysis and AppealPackage.
- analyzeNotice(Intake): conservative, deterministic intake classification; never creates policy.
- getMatchingRule(analysis, rules, now): exact market/account/category/enforcement matching. Rejects unverified official sources, future timestamps, stale rules, ambiguity, and inactive rules.
- calculateReadiness(facts, rule): identification 20, verified evidence 40, consistency review 20, explanation 10, verified procedure 10.
- analyzeEvidence(): marks content as unreviewed with empty facts and confidence 0.
- generateAppeal(): fact-based template. Missing critical facts, rules or checks keep ready=false.

Integrate the real models behind these functions, validate model output against the strict schemas, and retain all current server-side blocking checks. Never use model output as the source of platform policy. Never infer document authenticity from a successful upload.

## RULES contract
An administrator can import a Rule via /admin/rules or POST /api/admin/rules. The canonical schema is RuleSchema in lib/lumindaly/contracts.ts.

Fields: id, market, account_type, violation_category, enforcement_type, appeal_allowed, appeal_count, appeal_window, requirements { required: string[], recommended: string[] }, questions [{ id, label, required }], common_errors, submission_notes, official_source, last_verified_at (UTC epoch milliseconds), active, manual_review_required.

Unknown appeal_allowed / appeal_count / appeal_window values are null. Required evidence must come from verified source data, never guessed defaults. The default internal freshness threshold is 30 days; this is a Lumindaly operating choice, not a TikTok policy. Official sources must use HTTPS and the tiktok.com domain or its subdomains.

Scans store confidence as integer thousandths in D1; result_json retains the 0–1 contract. Rules and source text are snapshotted into a Case. A changed, revoked or stale live rule invalidates current readiness and requires a fresh review. Development fixtures live only in isolated tests and are never seeded into production.

## Payments
Central prices are stored as integer USD cents. The server selects the amount. Checkout metadata: user_id, case_id, product_tier, affiliate_id, payment_id. Single-item, one-time card checkout.

Webhook path: POST /api/stripe/webhook.
- checkout.session.completed and checkout.session.async_payment_succeeded require payment_status=paid.
- Signature is verified over the original bytes with a five-minute replay tolerance.
- The handler retrieves the canonical session, successful payment intent and charge. Amount, currency, identity, case, package and attribution must match.
- Successful-charge creation time determines the affiliate boost rate. Store that rate permanently.
- Event IDs and unique payment/commission constraints make repeated deliveries idempotent.
- charge.refunded retrieves the canonical charge. Any refund cancels the commission and closes paid access, including a refund received before the completed event.
- Refunds after a recorded manual payout retain paid_at and payout_reference for reconciliation; there is no automatic clawback or Stripe Connect.
- The browser's success URL never grants access.
- Expired checkout requires opening a fresh case from the saved scan; the original record is retained.

The payment mode must match the secret-key prefix. PAYMENTS_ENABLED is false by default.

## Affiliation
GET /r/[slug] stores a first eligible referral in a server-side anonymous-visitor record; the browser receives only a random HttpOnly cookie. No affiliate ID is trusted from checkout form input.
- Initial referral window: 30 days, an explicit provisional business setting.
- On sign-in the customer mapping is persisted with a unique customer_id. Later purchases do not depend on a browser cookie.
- Activation is idempotent and never resets the boost clock.
- 70% through boost_ends_at, 40% strictly afterward. Rate belongs to each transaction and is not recalculated retroactively.
- No self-referrals or second-level commissions.
- 14-day commission hold, pending → approved → paid. A manual transfer reference is required to mark paid.
- Refund → cancelled.
The initial attribution window and hold are centralized and can be replaced when AFFILIATE / GROWTH supplies final operational terms.

## Security and boundaries
Ownership on every sensitive endpoint, explicit admin authorization, same-origin write checks, request-size caps, prepared SQL, validated JSON contracts, simple scan/upload/referral rate limits, randomized storage keys and MIME/signature validation. PDFs are downloaded as attachments with no-store and sandbox headers. No user documents or provider payloads are logged.

Changing case facts or evidence invalidates earlier review approval. The score measures dossier completeness, never an outcome probability.

## Verification references
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature)

The current build adds no paid third-party subscription and makes no paid AI calls. Free usage allowances are quotas, not unlimited capacity. Standalone Cloudflare billing and R2 activation depend on the account configuration.
