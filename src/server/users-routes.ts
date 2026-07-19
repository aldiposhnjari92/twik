import type { Express } from 'express';
import { ID, Query, Users } from 'node-appwrite';
import { ADMIN_LABEL, isAdmin, requireAdmin } from './access';
import { createAdminClient } from './appwrite-admin';
import { TtlCache } from './cache';
import { errorStatus, originOf, readSessionSecret } from './session';

const LIST_LIMIT = 100;
const USERS_CACHE_TTL_MS = 15_000;

const DEPARTMENTS = ['Engineering', 'Design', 'Product', 'Marketing', 'Sales', 'Operations', 'Finance', 'Support'];

interface UserDto {
  id: string;
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

const usersCache = new TtlCache<UserDto[]>(USERS_CACHE_TTL_MS);

export function registerUsersRoutes(app: Express): void {
  app.get('/api/users', async (req, res) => {
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    const cached = usersCache.get();
    if (cached) {
      res.json({ users: cached });
      return;
    }

    try {
      const { client } = createAdminClient();
      const users = new Users(client);
      const result = await users.list({ queries: [Query.limit(LIST_LIMIT), Query.orderAsc('name')] });
      const dtos: UserDto[] = result.users.map((user) => ({
        id: user.$id,
        name: user.name,
        email: user.email,
        department: departmentOf(user.prefs),
        isAdmin: isAdmin(user),
        createdAt: user.$createdAt,
      }));
      usersCache.set(dtos);
      res.json({ users: dtos });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not load users.',
      });
    }
  });

  app.post('/api/users', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;

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
      const { client, account } = createAdminClient();
      const users = new Users(client);
      const created = await users.create({ userId: ID.unique(), email, name });
      await users.updatePrefs({ userId: created.$id, prefs: { department } });
      await account.createRecovery({ email, url: `${originOf(req)}/reset-password` });
      usersCache.clear();
      res.status(201).json({
        id: created.$id,
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
    if (!(await requireAdmin(req, res))) return;

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
      const { client } = createAdminClient();
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

      usersCache.clear();
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update that teammate.',
      });
    }
  });

  app.delete('/api/users/:id', async (req, res) => {
    const caller = await requireAdmin(req, res);
    if (!caller) return;

    if (req.params.id === caller.$id) {
      res.status(400).json({ message: "You can't remove your own account from here. Use Settings → Danger zone instead." });
      return;
    }

    try {
      const { client } = createAdminClient();
      const users = new Users(client);

      const target = await users.get({ userId: req.params.id });
      if (isAdmin(target)) {
        const { total } = await users.list({ queries: [Query.contains('labels', [ADMIN_LABEL]), Query.limit(2)] });
        if (total <= 1) {
          res.status(400).json({ message: 'The workspace needs at least one admin.' });
          return;
        }
      }

      await users.delete({ userId: req.params.id });
      usersCache.clear();
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not remove that teammate.',
      });
    }
  });

  app.patch('/api/users/:id/role', async (req, res) => {
    const caller = await requireAdmin(req, res);
    if (!caller) return;

    const { isAdmin: makeAdmin } = req.body ?? {};
    if (typeof makeAdmin !== 'boolean') {
      res.status(400).json({ message: 'isAdmin must be true or false.' });
      return;
    }

    try {
      const { client } = createAdminClient();
      const users = new Users(client);

      if (!makeAdmin) {
        const targetIsCurrentlyAdmin = (await users.get({ userId: req.params.id })).labels.includes(ADMIN_LABEL);
        const { total } = targetIsCurrentlyAdmin
          ? await users.list({ queries: [Query.contains('labels', [ADMIN_LABEL]), Query.limit(2)] })
          : { total: 0 };
        if (targetIsCurrentlyAdmin && total <= 1) {
          res.status(400).json({ message: 'The workspace needs at least one admin.' });
          return;
        }
      }

      await users.updateLabels({ userId: req.params.id, labels: makeAdmin ? [ADMIN_LABEL] : [] });
      usersCache.clear();
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update that teammate\'s role.',
      });
    }
  });
}
