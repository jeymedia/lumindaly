# V1 verification
Static TypeScript checking and the dependency-free preflight suite pass.

The local Cloudflare preview was used to verify the actual anonymous browser flow:
- Homepage → Scan → Result.
- Fictional notice saved in local D1, classified conservatively, unknown rule displayed as Manual review required.
- Refresh preserves the result and access cookie.
- PNG-only notice uploaded through the browser into the local R2 implementation and saved with a private download route. Browser download interception failed in the test infrastructure; download ownership/response behavior is covered by the server suite.
- Desktop homepage and scan layout inspected.
- Responsive rendering checked through a same-origin 390 px / 360 px viewport harness.

Authenticated browser flows require platform sign-in on the hosted Site; the managed local preview does not simulate it. Authorization, paid-case actions, private-file ownership, admin actions and affiliation are covered by isolated server integration tests. Real Stripe API callbacks remain unverified until credentials and public webhook access are configured.

The temporary responsive harness is not part of the deployed artifact.
