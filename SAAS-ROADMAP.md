# twik SaaS roadmap — progress & next steps

Tracks turning twik into a sellable, secure, enterprise-ready SaaS product. Update this file as
steps complete or plans change — it's the source of truth for resuming this work across sessions.

## Roadmap order (agreed, reordered once — see Step 6)

1. **Multi-tenancy** — DONE, committed (`7fe3e9d`)
2. **CI/CD** — DONE, committed (`efdb334`)
3. **Billing (Stripe)** — code DONE, committed (`3dd5507`), not yet live-tested (blocked on external Stripe setup — see below)
4. **Scale fixes** (Redis-backed cache/rate-limit, real pagination, indexes, observability) — not started
5. **Security hardening** (CSP fix, CSRF, MFA) — not started
6. **Enterprise features** (audit log, granular RBAC, SSO/SAML, org switcher) — **audit log DONE** (jumped ahead of Steps 4–5 per explicit user request after UI feedback), rest not started
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

**Bug found & fixed post-multi-tenancy** (worth remembering, cost real debugging time): `bootstrapWorkspace()`
in `src/server/auth-routes.ts` created the per-team `workspace` document via the admin client
**without an explicit `permissions` array**. Since the `workspace` collection has `documentSecurity:
true` and empty collection-level permissions, a document created with no permissions is invisible to
*everyone except the admin/API-key client* — including the workspace's own members. Symptom: "Document
with the requested ID '...' could not be found" on Settings → General, even though the document
genuinely existed (confirmed via admin-client lookup, which bypasses permissions and thus masked the
bug during earlier verification). Fixed by always passing
`[Permission.read(Role.team(teamId)), Permission.update(Role.team(teamId, ADMIN_ROLE))]` on creation —
same fix applied to `scripts/migrate-to-workspaces.mjs`. **Lesson**: verifying a document "exists" via
the admin client proves nothing about whether real session-scoped users can actually read it — always
check permissions explicitly when documentSecurity is on.

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

### What's built (committed in `3dd5507`)
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

---

## Step 6 (partial) — Audit log — done

Jumped ahead of Steps 4–5 after the user flagged that the product feels like it's missing
enterprise-specific features (not a visual-polish complaint) and picked audit log as the highest-leverage,
most self-contained one to build first (no external dependency, unlike SSO).

**Scope**: who did what, when, scoped per workspace, **admin-only visibility**. Covers project
create/update/delete, member invite/update/remove/role-change, workspace settings changes, and Stripe
webhook-triggered billing events (attributed to a synthetic `{ actorId: 'system', actorName: 'Stripe' }`
actor). Not in scope: filtering/search UI, per-field value diffs (only *which* fields changed, not old/new
values), CSV export, retention policy.

**Data model**: new `audit_logs` collection, same isolation pattern as `projects`/`workspace`
(`documentSecurity: true`, empty collection-level permissions), but **admin-only** per-document read
(`Permission.read(Role.team(teamId, ADMIN_ROLE))`) — stricter than projects/workspace since this is
inherently a compliance surface. First genuinely cursor-paginated list in this app (`GET /api/audit-log`,
`Query.cursorAfter`) — every other list endpoint caps at a flat `Query.limit(100)`, which doesn't fit a
dataset that grows unboundedly.

Key files: `src/server/audit-log.ts` (`logEvent()` — best-effort, swallows failures so logging never
breaks the operation it's recording), `src/server/audit-log-routes.ts` (`GET /api/audit-log`),
instrumentation calls added to `project-routes.ts`/`users-routes.ts`/`workspace-routes.ts`/
`billing-routes.ts`, `src/app/audit-log/audit-log.ts` (client service), `src/app/components/audit-log/`
(page — table + "Load more" pagination), `src/app/auth/admin-guard.ts` (**new**, first admin-only route
guard — `authGuard` only checks `isAuthenticated()`), sidebar nav item (**first admin-gated nav item** —
`src/app/components/sidebar/sidebar.ts` `navItems` is now a `computed()` filtering on `auth.isAdmin()`).

Schema provisioned live and verified (`node scripts/setup-appwrite.mjs`, then a throwaway
create+delete round-trip confirmed the admin-only team-role permission syntax actually works). Not yet
committed — do that before moving on, same pattern as every prior step.

**Still to verify manually** (needs a real login, which this environment can't do): create/edit/delete a
project, invite/remove a teammate, change a role, edit workspace settings as the admin account →
confirm each shows up in `/audit-log`; confirm a non-admin account gets redirected away from
`/audit-log` and never sees the nav item.

---

## Steps 4, 5, and the rest of Step 6 — not started

No design work done yet beyond the original audit that produced this roadmap. When picking these up,
start with a fresh `EnterPlanMode` pass per step (each is its own architectural decision), same as
Steps 1, 3, and the audit-log piece of Step 6 were handled — don't attempt to design multiple steps in
one pass.

Known specifics from the original audit worth remembering when the time comes:
- **Scale**: `TtlCache`/rate-limit stores are in-memory, won't survive horizontal scaling; `Projects.list()`/`Users`
  list endpoints cap at 100 rows with no cursor pagination (the new audit-log endpoint is the one exception —
  see Step 6 above, worth reusing that cursor pattern when tackling this properly); no structured
  logging/error tracking/APM exists yet.
- **Security**: CSP is explicitly disabled in `src/server.ts` (PrimeNG's inline styles need nonce wiring first);
  no CSRF protection on any state-changing route; no MFA/2FA.
- **Enterprise (remaining)**: granular custom roles (beyond admin/member), SSO/SAML (Okta, Azure AD —
  only Google OAuth exists today), an org switcher (v1 is one-user-one-workspace, no multi-workspace
  membership yet, per the multi-tenancy design).
