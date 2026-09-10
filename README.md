# Lumindaly
Cloudflare-first TikTok case preparation SaaS. React + TypeScript (Vinext), Workers, D1, private R2 and Stripe Checkout.

## Commands
```sh
pnpm dev
pnpm build
pnpm exec tsc --noEmit
pnpm test
pnpm db:generate
```
Use Node 24 for the dependency-free integration test runner. In Work, follow the Sites build / preview lifecycle. Dependencies are pinned in pnpm-lock.yaml.

Copy .env.example to .env for local configuration. Set production values through the Site environment settings. Never commit secrets. Generated D1 migrations live in drizzle/. Apply pending migrations in order; never replay or edit an applied migration.

## Current behavior
- Anonymous scan, signed-in case workspace, private files, manual evidence review, grounded appeal drafts and outcome tracking.
- Authentication uses the platform's Sign in with ChatGPT. The platform owns login, sessions and logout. No passwords are stored by Lumindaly.
- No production TikTok rules are seeded. Unknown, stale or ambiguous matches require manual review.
- Stripe is implemented but closed until credentials, a reachable signed webhook, and payment activation are configured.
- No AI API is called. Notice classification is conservative; screenshots and evidence require a person to review content.
- Partner attribution belongs to the customer. Activation starts 30 days at 70%, then 40%; manual payouts and refund cancellation are implemented.

See docs/HANDOFF.md for module contracts and docs/LAUNCH.md for the exact remaining activation steps.
