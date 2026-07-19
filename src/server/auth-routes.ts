import type { Express, Request, Response } from 'express';
import { ID, OAuthProvider, Users } from 'node-appwrite';
import { ADMIN_ROLE, resolveWorkspace, requireWorkspace, type WorkspaceContext } from './access';
import { createAdminClient, createSessionClient } from './appwrite-admin';
import { SESSION_COOKIE, errorStatus, originOf, readSessionSecret } from './session';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const DATABASE_ID = 'main';
const WORKSPACE_COLLECTION_ID = 'workspace';

/**
 * Creates a brand-new workspace (an Appwrite Team) for a user with no existing one — the outcome of
 * every fresh registration or first-time OAuth sign-in. The creator is always the workspace's first
 * (and, at creation time, only) admin. Runs entirely on the admin/API-key client, so it doesn't need
 * a session to already exist.
 */
async function bootstrapWorkspace(admin: ReturnType<typeof createAdminClient>, userId: string, workspaceName: string): Promise<string> {
  const teamId = ID.unique();
  await admin.teams.create({ teamId, name: workspaceName });
  await admin.teams.createMembership({ teamId, userId, roles: [ADMIN_ROLE] });
  await admin.databases.createDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, teamId, {
    name: workspaceName,
    description: '',
    timezone: 'UTC',
    plan: 'free',
  });
  return teamId;
}

function userDto(context: WorkspaceContext) {
  return { id: context.user.$id, name: context.user.name, email: context.user.email, isAdmin: context.isAdmin, workspaceId: context.teamId };
}

function setSessionCookie(req: Request, res: Response, secret: string): void {
  res.cookie(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: req.protocol === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: req.protocol === 'https',
    sameSite: 'lax',
    path: '/',
  });
}

export function registerAuthRoutes(app: Express): void {
  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body ?? {};
    if (!name || !email || !password) {
      res.status(400).json({ message: 'Name, email, and password are required.' });
      return;
    }

    try {
      const admin = createAdminClient();
      const created = await admin.account.create({ userId: ID.unique(), email, password, name });
      await bootstrapWorkspace(admin, created.$id, `${name}'s Workspace`);

      const session = await admin.account.createEmailPasswordSession({ email, password });
      const context = await resolveWorkspace(session.secret);
      if (!context) {
        res.status(500).json({ message: 'Your account was created, but the workspace could not be set up. Please try logging in.' });
        return;
      }

      setSessionCookie(req, res, session.secret);
      res.json(userDto(context));
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Registration failed.',
      });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required.' });
      return;
    }

    try {
      const { account: adminAccount } = createAdminClient();
      const session = await adminAccount.createEmailPasswordSession({ email, password });
      const context = await resolveWorkspace(session.secret);
      if (!context) {
        res.status(403).json({ message: "Your account isn't part of a workspace." });
        return;
      }

      setSessionCookie(req, res, session.secret);
      res.json(userDto(context));
    } catch {
      res.status(401).json({ message: 'Invalid email or password.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const secret = readSessionSecret(req);
    if (secret) {
      try {
        const { account } = createSessionClient(secret);
        await account.deleteSession({ sessionId: 'current' });
      } catch {
        // Session may already be invalid or expired; clearing the cookie below is enough.
      }
    }
    clearSessionCookie(req, res);
    res.json({ success: true });
  });

  app.patch('/api/auth/profile', async (req, res) => {
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ message: 'Name is required.' });
      return;
    }

    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    try {
      const { account } = createSessionClient(secret);
      await account.updateName({ name });
      const context = await resolveWorkspace(secret);
      if (!context) {
        res.status(401).json({ message: 'Not authenticated.' });
        return;
      }
      res.json(userDto(context));
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update your name.',
      });
    }
  });

  app.post('/api/auth/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      res.status(400).json({ message: 'Current and new password are required.' });
      return;
    }

    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    try {
      const { account } = createSessionClient(secret);
      await account.updatePassword({ password: newPassword, oldPassword: currentPassword });
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update your password.',
      });
    }
  });

  app.get('/api/auth/sessions', async (req, res) => {
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    try {
      const { account } = createSessionClient(secret);
      const result = await account.listSessions();
      res.json({
        sessions: result.sessions.map((session) => ({
          id: session.$id,
          current: session.current,
          clientName: session.clientName || null,
          osName: session.osName || null,
          deviceName: session.deviceName || null,
          ip: session.ip || null,
          countryName: session.countryName || null,
          createdAt: session.$createdAt,
        })),
      });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not load your sessions.',
      });
    }
  });

  // Registered before '/api/auth/sessions/:id' so 'other' isn't captured as a session id.
  app.delete('/api/auth/sessions/other', async (req, res) => {
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    try {
      const { account } = createSessionClient(secret);
      const result = await account.listSessions();
      await Promise.all(
        result.sessions.filter((session) => !session.current).map((session) => account.deleteSession({ sessionId: session.$id })),
      );
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not sign out your other sessions.',
      });
    }
  });

  app.delete('/api/auth/sessions/:id', async (req, res) => {
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    try {
      const { account } = createSessionClient(secret);
      await account.deleteSession({ sessionId: req.params['id'] });
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not sign out that session.',
      });
    }
  });

  app.delete('/api/auth/account', async (req, res) => {
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    const { password } = req.body ?? {};
    if (!password) {
      res.status(400).json({ message: 'Enter your password to confirm.' });
      return;
    }

    try {
      const { account } = createSessionClient(secret);
      const user = await account.get();

      // Re-verify the password before doing anything irreversible; Appwrite has no "check password"
      // endpoint, so confirming means actually creating (and then discarding) a session.
      const { client, account: adminAccount } = createAdminClient();
      try {
        await adminAccount.createEmailPasswordSession({ email: user.email, password });
      } catch {
        res.status(401).json({ message: 'Incorrect password.' });
        return;
      }

      const users = new Users(client);
      await users.delete({ userId: user.$id });

      clearSessionCookie(req, res);
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not delete your account.',
      });
    }
  });

  app.post('/api/auth/recovery', async (req, res) => {
    const { userId, secret, password } = req.body ?? {};
    if (!userId || !secret || !password) {
      res.status(400).json({ message: 'Missing required fields.' });
      return;
    }

    try {
      const { account } = createAdminClient();
      await account.updateRecovery({ userId, secret, password });
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not set your password. The link may have expired.',
      });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    const context = await requireWorkspace(req, res);
    if (!context) return;
    res.json(userDto(context));
  });

  app.get('/api/auth/google', async (req, res) => {
    try {
      const { account } = createAdminClient();
      const url = await account.createOAuth2Token({
        provider: OAuthProvider.Google,
        success: `${originOf(req)}/api/auth/google/callback`,
        failure: `${originOf(req)}/login`,
      });
      res.redirect(url);
    } catch {
      res.redirect('/login?error=oauth-failed');
    }
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const userId = typeof req.query['userId'] === 'string' ? req.query['userId'] : undefined;
    const secret = typeof req.query['secret'] === 'string' ? req.query['secret'] : undefined;
    if (!userId || !secret) {
      res.redirect('/login');
      return;
    }

    try {
      const admin = createAdminClient();
      const session = await admin.account.createSession({ userId, secret });

      let context = await resolveWorkspace(session.secret);
      if (!context) {
        // First-time identity for this Google account — Appwrite auto-created the user before
        // redirecting here. Give them their own new workspace, same as email/password registration.
        const googleUser = await new Users(admin.client).get({ userId });
        await bootstrapWorkspace(admin, userId, `${googleUser.name}'s Workspace`);
        context = await resolveWorkspace(session.secret);
      }
      if (!context) {
        res.redirect('/login?error=oauth-failed');
        return;
      }

      setSessionCookie(req, res, session.secret);
      res.redirect('/dashboard');
    } catch {
      res.redirect('/login?error=oauth-failed');
    }
  });
}
