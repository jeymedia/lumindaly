# Launch state

This build is an implementation candidate, not yet cleared to take real customer money.

## Implemented
Landing, sign-in integration, free scan and result, D1 persistence, private R2 notice/evidence handling, rule matching interface, readiness, Stripe Checkout / signed webhooks, Case Builder, manual evidence review, appeal package, customer dashboard, outcomes, administrator review/rules/affiliates/commission screens, referral activation, persistent customer attribution, boost timing, repeat purchases, refunds and manual payout recording.

## Required activation steps
1. Open the private Site and sign in. Visit /admin and obtain the stable account ID shown on the restricted screen. Configure ADMIN_USER_IDS for the owner.
2. Import current, official Rules from TIKTOK RULES. AI ENGINE may replace the conservative functions independently. Screenshot transcription and evidence content review are manual in this build.
3. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET as server-side secrets. Use test keys first. APP_ORIGIN must equal the eventual public application origin.
4. Ensure the chosen hosting audience permits anonymous access to landing/scan and Stripe access to POST /api/stripe/webhook. The delivered owner-private Site cannot receive unauthenticated Stripe callbacks.
5. Run an actual Stripe test Checkout, confirm the signed callback, verify the unlocked Case and commission, then perform a test refund. Current automated provider tests are simulated, not a real Stripe integration run.
6. Verify sign-in/logout, cross-user access and protected dashboard behavior on the hosted Site, including mobile.
7. Only when the operator can review cases: enable MANUAL_REVIEW_ENABLED. Enable PAYMENTS_ENABLED after payment verification, and STRIPE_MODE=live only with matching live secrets.
8. Before public sale, the owner must supply the business/contact details and sale/privacy terms for the actual service. No invented company identity or legal policy has been published.

## Test record
- Strict text/screenshot-only NoticeAnalysis JSON.
- No-rule → Manual Review; stale and ambiguous rules rejected.
- Grounded AppealPackage; missing evidence/facts prevent ready=true.
- Isolated SQLite schema and server integration tests.
- Signed webhook (simulated Stripe API) → confirmed payment → Case unlocked.
- Duplicate webhook delivery creates one commission.
- Referral → customer account → purchase → 70% commission.
- Repeat purchase without referral cookie preserves attribution.
- Exact boost boundary and 40% after boost; old rates remain unchanged.
- Verified refund cancels commission and closes the case.
- Other customer cannot read case, scan or evidence.
- Non-admin cannot call admin endpoints.
- Same-origin writes, invalid webhook signature and invalid files rejected.
- Paid case → uploaded evidence → manual review → appeal → outcome.
- Manual payout needs an eligible commission and transfer reference.

Run pnpm test. All fixtures are isolated from production and include no genuine TikTok policy.

## Manual operating flow
Admin reviews notice and evidence, imports or matches a verified rule, requests changes if required, and confirms consistency/procedure before approval. Customer reviews the package, submits it through TikTok, then records the outcome.

No restoration guarantee, success prediction, invented supporting document, autonomous TikTok submission, automatic affiliate payout, or Stripe Connect.
