import type { Express } from 'express';
import { ID, Query, Users, type Databases } from 'node-appwrite';
import { ADMIN_ROLE, MEMBER_ROLE, requireAdmin, requireWorkspace } from './access';
import { createAdminClient } from './appwrite-admin';
import { logEvent } from './audit-log';
import { FREE_SEAT_LIMIT, effectivePlan, getWorkspaceBillingDoc } from './billing';
import { KeyedTtlCache } from './cache';
import { errorStatus, originOf } from './session';
import { getStripeClient } from './stripe-client';

const LIST_LIMIT = 100;
const USERS_CACHE_TTL_MS = 15_000;

const DEPARTMENTS = ['Engineering', 'Design', 'Product', 'Marketing', 'Sales', 'Operations', 'Finance', 'Support'];

interface UserDto {
  id: string;
  membershipId: string;
  name: string;
  email: string;
  department: string | null;
  isAdmin: boolean;
  createdAt: string;
}

function departmentOf(prefs: Record<string, unknown>): string | null {
  const value = prefs['department'];
  return typeof value === 'string' && DEPARTMENTS.includes(value) ? value : null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Keyed by teamId — one member list per workspace, never a single global slot.
const usersCache = new KeyedTtlCache<UserDto[]>(USERS_CACHE_TTL_MS);

/** Resolves the target's membership within the caller's workspace, or `undefined` if they're not a member of it. */
async function findMembership(teams: ReturnType<typeof createAdminClient>['teams'], teamId: string, userId: string) {
  const { memberships } = await teams.listMemberships({ teamId, queries: [Query.equal('userId', userId)] });
  return memberships[0];
}

async function countAdmins(teams: ReturnType<typeof createAdminClient>['teams'], teamId: string): Promise<number> {
  const { total } = await teams.listMemberships({ teamId, queries: [Query.contains('roles', [ADMIN_ROLE]), Query.limit(2)] });
  return total;
}

/** Keeps a live Stripe subscription's billed seat count matching actual membership count. Best-effort — a sync failure shouldn't block inviting or removing a teammate. */
async function syncSeatQuantity(databases: Databases, teams: ReturnType<typeof createAdminClient>['teams'], teamId: string): Promise<void> {
  try {
    const doc = await getWorkspaceBillingDoc(databases, teamId);
    if (!doc.stripeSubscriptionId || effectivePlan(doc) !== 'pro') return;

    const stripe = getStripeClient();
    const [{ total: seatCount }, subscription] = await Promise.all([
      teams.listMemberships({ teamId, queries: [Query.limit(1)] }),
      stripe.subscriptions.retrieve(doc.stripeSubscriptionId),
    ]);

    const item = subscription.items.data[0];
    if (!item) return;

    await stripe.subscriptionItems.update(item.id, { quantity: Math.max(seatCount, 1) });
  } catch {
    // Swallowed intentionally — see doc comment above.
  }
}

/** Non-admins don't see admins in the member list — only admins can see everyone. */
function visibleTo(dtos: UserDto[], workspace: { isAdmin: boolean }): UserDto[] {
  return workspace.isAdmin ? dtos : dtos.filter((u) => !u.isAdmin);
}

export function registerUsersRoutes(app: Express): void {
  app.get('/api/users', async (req, res) => {
    const workspace = await requireWorkspace(req, res);
    if (!workspace) return;

    const cached = usersCache.get(workspace.teamId);
    if (cached) {
      res.json({ users: visibleTo(cached, workspace) });
      return;
    }

    try {
      const { client, teams } = createAdminClient();
      const users = new Users(client);

      const { memberships } = await teams.listMemberships({ teamId: workspace.teamId, queries: [Query.limit(LIST_LIMIT)] });
      const accounts = await Promise.all(memberships.map((membership) => users.get({ userId: membership.userId })));

      const dtos: UserDto[] = memberships.map((membership, index) => ({
        id: membership.userId,
        membershipId: membership.$id,
        name: membership.userName,
        email: membership.userEmail,
        department: departmentOf(accounts[index].prefs),
        isAdmin: membership.roles.includes(ADMIN_ROLE),
        createdAt: membership.$createdAt,
      }));

      usersCache.set(workspace.teamId, dtos);
      res.json({ users: visibleTo(dtos, workspace) });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not load users.',
      });
    }
  });

  app.post('/api/users', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    const { name, email, department } = req.body ?? {};
    if (!name || !email) {
      res.status(400).json({ message: 'Name and email are required.' });
      return;
    }
    if (!department || !DEPARTMENTS.includes(department)) {
      res.status(400).json({ message: 'Choose a valid department.' });
      return;
    }

    try {
      const { client, account, databases, teams } = createAdminClient();

      const billingDoc = await getWorkspaceBillingDoc(databases, workspace.teamId);
      if (effectivePlan(billingDoc) === 'free') {
        const { total: seatCount } = await teams.listMemberships({ teamId: workspace.teamId, queries: [Query.limit(1)] });
        if (seatCount >= FREE_SEAT_LIMIT) {
          res.status(402).json({ message: `The free plan is limited to ${FREE_SEAT_LIMIT} seats. Upgrade to Pro to invite more teammates.` });
          return;
        }
      }

      const users = new Users(client);
      const created = await users.create({ userId: ID.unique(), email, name });
      await users.updatePrefs({ userId: created.$id, prefs: { department } });
      await account.createRecovery({ email, url: `${originOf(req)}/reset-password` });
      // Server-initiated with an existing userId completes immediately — no separate invitation email.
      const membership = await teams.createMembership({ teamId: workspace.teamId, userId: created.$id, roles: [MEMBER_ROLE] });
      await syncSeatQuantity(databases, teams, workspace.teamId);
      await logEvent({
        teamId: workspace.teamId,
        actorId: workspace.user.$id,
        actorName: workspace.user.name,
        action: 'member.invited',
        targetType: 'member',
        targetLabel: created.name,
      });

      usersCache.clear(workspace.teamId);
      res.status(201).json({
        id: created.$id,
        membershipId: membership.$id,
        name: created.name,
        email: created.email,
        department,
        isAdmin: false,
        createdAt: created.$createdAt,
      });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not invite teammate.',
      });
    }
  });

  app.patch('/api/users/:id', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    const { name, email, department } = req.body ?? {};

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ message: 'Enter a name.' });
      return;
    }
    if (email !== undefined && (typeof email !== 'string' || !EMAIL_PATTERN.test(email))) {
      res.status(400).json({ message: 'Enter a valid email address.' });
      return;
    }
    if (department !== undefined && !DEPARTMENTS.includes(department)) {
      res.status(400).json({ message: 'Choose a valid department.' });
      return;
    }
    if (name === undefined && email === undefined && department === undefined) {
      res.status(400).json({ message: 'Nothing to update.' });
      return;
    }

    try {
      const { client, teams } = createAdminClient();

      const membership = await findMembership(teams, workspace.teamId, req.params.id);
      if (!membership) {
        res.status(404).json({ message: 'That teammate is not in your workspace.' });
        return;
      }

      const users = new Users(client);
      if (name !== undefined) {
        await users.updateName({ userId: req.params.id, name: name.trim() });
      }
      if (email !== undefined) {
        await users.updateEmail({ userId: req.params.id, email });
      }
      if (department !== undefined) {
        await users.updatePrefs({ userId: req.params.id, prefs: { department } });
      }

      await logEvent({
        teamId: workspace.teamId,
        actorId: workspace.user.$id,
        actorName: workspace.user.name,
        action: 'member.updated',
        targetType: 'member',
        targetLabel: name?.trim() ?? membership.userName,
        metadata: { changed: [name !== undefined && 'name', email !== undefined && 'email', department !== undefined && 'department'].filter(Boolean) },
      });

      usersCache.clear(workspace.teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update that teammate.',
      });
    }
  });

  app.delete('/api/users/:id', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    if (req.params.id === workspace.user.$id) {
      res.status(400).json({ message: "You can't remove your own account from here. Use Settings → Danger zone instead." });
      return;
    }

    try {
      const { databases, teams } = createAdminClient();

      const membership = await findMembership(teams, workspace.teamId, req.params.id);
      if (!membership) {
        res.status(404).json({ message: 'That teammate is not in your workspace.' });
        return;
      }

      if (membership.roles.includes(ADMIN_ROLE) && (await countAdmins(teams, workspace.teamId)) <= 1) {
        res.status(400).json({ message: 'The workspace needs at least one admin.' });
        return;
      }

      // Revokes access to this workspace only — the person's Appwrite account (and any other
      // workspace they might belong to) is untouched. Account deletion is a self-service action
      // under Settings → Danger zone, not something removing a teammate should do.
      await teams.deleteMembership({ teamId: workspace.teamId, membershipId: membership.$id });
      await syncSeatQuantity(databases, teams, workspace.teamId);
      await logEvent({
        teamId: workspace.teamId,
        actorId: workspace.user.$id,
        actorName: workspace.user.name,
        action: 'member.removed',
        targetType: 'member',
        targetLabel: membership.userName,
      });
      usersCache.clear(workspace.teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not remove that teammate.',
      });
    }
  });

  app.patch('/api/users/:id/role', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    const { isAdmin: makeAdmin } = req.body ?? {};
    if (typeof makeAdmin !== 'boolean') {
      res.status(400).json({ message: 'isAdmin must be true or false.' });
      return;
    }

    try {
      const { teams } = createAdminClient();

      const membership = await findMembership(teams, workspace.teamId, req.params.id);
      if (!membership) {
        res.status(404).json({ message: 'That teammate is not in your workspace.' });
        return;
      }

      const targetIsCurrentlyAdmin = membership.roles.includes(ADMIN_ROLE);
      if (!makeAdmin && targetIsCurrentlyAdmin && (await countAdmins(teams, workspace.teamId)) <= 1) {
        res.status(400).json({ message: 'The workspace needs at least one admin.' });
        return;
      }

      await teams.updateMembership({ teamId: workspace.teamId, membershipId: membership.$id, roles: [makeAdmin ? ADMIN_ROLE : MEMBER_ROLE] });
      await logEvent({
        teamId: workspace.teamId,
        actorId: workspace.user.$id,
        actorName: workspace.user.name,
        action: 'member.role_changed',
        targetType: 'member',
        targetLabel: membership.userName,
        metadata: { isAdmin: makeAdmin },
      });
      usersCache.clear(workspace.teamId);
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : "Could not update that teammate's role.",
      });
    }
  });
}
