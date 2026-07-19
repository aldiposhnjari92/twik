# twik SaaS roadmap — progress & next steps

Tracks turning twik into a sellable, secure, enterprise-ready SaaS product. Update this file as
steps complete or plans change — it's the source of truth for resuming this work across sessions.

## Roadmap order (agreed)

1. **Multi-tenancy** — DONE, committed (`7fe3e9d`)
2. **CI/CD** — DONE, committed (`efdb334`)
3. **Billing (Stripe)** — code DONE, **not yet committed**, not yet live-tested (blocked on external Stripe setup — see below)
4. **Scale fixes** (Redis-backed cache/rate-limit, real pagination, indexes, observability) — not started
5. **Security hardening** (CSP fix, CSRF, MFA, audit log) — not started
6. **Enterprise features** (SSO/SAML, granular RBAC, API keys/webhooks) — not started
7. **Compliance** (SOC2, GDPR) — not started

---

## Step 1 — Multi-tenancy (done)

Workspace = Appwrite Team. Admin status is a team membership role (`'admin'`/`'member'`), not a
global Appwrite label. Every project carries `workspaceId` + per-document team permissions.
Registration (email/password and Google OAuth) each bootstrap their own new workspace. One user =
one workspace in v1 — no multi-workspace membership or workspace switcher yet (future work).

Key files: `src/server/access.ts` (`resolveWorkspace`/`requireWorkspace`/`requireAdmin`),
`src/server/appwrite-admin.ts`, all four `src/server/*-routes.ts` files, `scripts/setup-appwrite.mjs`,
`scripts/migrate-to-workspaces.mjs` (one-time, already run against the live project — don't re-run).

## Step 2 — CI/CD (done)

`.github/workflows/ci.yml` — `npm ci` → `ng build` → `npm test -- --watch=false` on every push/PR to
`master`. No lint step configured (no ESLint in this repo yet — would be new scope if wanted later).

## Step 3 — Billing (Stripe) — in progress

### Design (locked in, don't re-litigate without a reason)
- **Free / Pro / Enterprise, per-seat pricing.** Free: 3 seats / 5 projects, enforced as a block on
  *new* creation only — never deletes or locks existing over-limit data. Pro/Enterprise: unlimited.
- **14-day Pro trial, no card required.** Lives entirely in Appwrite fields (`plan`, `subscriptionStatus`,
  `trialEndsAt` on the `workspace` document) — not Stripe's native trial mechanism. No Stripe
  Customer/Subscription exists until someone actually starts Checkout. `effectivePlan()` in
  `src/server/billing.ts` computes the enforced tier from these fields; no cron job needed.
- **Enterprise is a manual/support-set plan value** — no self-serve checkout. Set by hand in
  Appwrite Console when needed (SSO/audit-log features that'd justify it are future work).
- **Stripe Checkout + Billing Portal** (hosted pages, not Elements) for start/manage/cancel.
- **Per-seat quantity sync**: inviting/removing a teammate updates the live Stripe subscription's
  item quantity to match membership count (best-effort, swallows errors — see
  `syncSeatQuantity()` in `src/server/users-routes.ts`).

### What's built (all in the current uncommitted working tree)
- `src/server/stripe-client.ts` — lazy Stripe singleton from `STRIPE_SECRET_KEY`
- `src/server/billing.ts` — `effectivePlan()`, `FREE_SEAT_LIMIT`/`FREE_PROJECT_LIMIT`, `getWorkspaceBillingDoc()`
- `src/server/billing-routes.ts` — `registerBillingWebhook()` (raw-body, must stay registered
  before `express.json()` in `src/server.ts`) + `registerBillingRoutes()` (`GET /api/billing`,
  `POST /api/billing/checkout`, `POST /api/billing/portal`)
- `src/app/billing/billing.ts` — client service (`get()`, `startCheckout()`, `openPortal()`)
- Settings → new **Billing** tab (`src/app/components/settings/settings.ts`/`.html`) — plan badge,
  trial countdown, seat/project usage, Upgrade/Manage buttons (admin-gated)
- `auth-routes.ts`'s `bootstrapWorkspace()` now grants every new workspace the 14-day trial
- `project-routes.ts` / `users-routes.ts` enforce the Free-tier limits on create/invite
- Appwrite schema already provisioned live (`subscriptionStatus`, `trialEndsAt`, `stripeCustomerId`,
  `stripeSubscriptionId` attributes + `stripeCustomerId_idx` index on the `workspace` collection) —
  ran `node scripts/setup-appwrite.mjs` successfully, confirmed idempotent.

### Still needed — external Stripe setup (blocks any live testing)
- [x] `.env`: `STRIPE_SECRET_KEY` — filled in (test mode)
- [ ] `.env`: `STRIPE_PRICE_ID_PRO` — create a Product "Pro" in the Stripe Dashboard (test mode) with
      one **recurring, per-unit** Price; copy the *Price ID* (`price_...`, not the Product ID)
- [ ] `.env`: `STRIPE_WEBHOOK_SECRET` — for local testing, `stripe listen --forward-to
      localhost:4000/api/billing/webhook` (Stripe CLI) prints a `whsec_...` secret. For the deployed
      app, a separate real webhook endpoint + its own secret gets configured in the Dashboard later.

### Still needed — verification once the above is in place
- [ ] End-to-end: Checkout with test card `4242 4242 4242 4242` → confirm webhook flips workspace to
      `subscriptionStatus: 'active'`, `plan: 'pro'` → Settings Billing tab shows it correctly
- [ ] Invite/remove a teammate on an active Pro workspace → confirm Stripe subscription quantity updates
- [ ] Open Billing Portal, cancel → confirm `customer.subscription.deleted` webhook drops workspace to Free
- [ ] Hit the Free-tier caps (3 seats / 5 projects) on a workspace manually set to `plan: 'free'` →
      confirm creation is blocked with a clear message, no existing data touched
- [ ] Decide whether to manually grant the current live workspace (created before this feature existed,
      so it has no trial fields) a trial for easier testing — offered to the user, not yet done

### Not yet committed
Everything above is uncommitted in the working tree. Commit before starting Step 4, same pattern as
Steps 1–2 (separate commits, ask before pushing — this sandbox has no git push credentials).

---

## Steps 4–7 — not started

No design work done yet beyond the original audit that produced this roadmap. When picking these up,
start with a fresh `EnterPlanMode` pass per step (each is its own architectural decision), same as
Steps 1 and 3 were handled — don't attempt to design multiple steps in one pass.

Known specifics from the original audit worth remembering when the time comes:
- **Scale**: `TtlCache`/rate-limit stores are in-memory, won't survive horizontal scaling; `Projects.list()`/`Users`
  list endpoints cap at 100 rows with no cursor pagination; no structured logging/error tracking/APM exists yet.
- **Security**: CSP is explicitly disabled in `src/server.ts` (PrimeNG's inline styles need nonce wiring first);
  no CSRF protection on any state-changing route; no MFA/2FA.
- **Enterprise**: only Google OAuth exists today — enterprise buyers will expect SAML/OIDC (Okta, Azure AD) too.
