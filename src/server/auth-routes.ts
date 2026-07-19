import type { Express, Request, Response } from 'express';
import { ID, OAuthProvider, Query, Users, type Client } from 'node-appwrite';
import { ADMIN_LABEL, isAdmin } from './access';
import { createAdminClient, createSessionClient } from './appwrite-admin';
import { SESSION_COOKIE, errorStatus, originOf, readSessionSecret } from './session';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

/** The very first account in the workspace becomes an admin automatically so someone can manage the team. */
async function bootstrapFirstAdmin(client: Client, userId: string): Promise<boolean> {
  const users = new Users(client);
  const { total } = await users.list({ queries: [Query.limit(1)] });
  if (total <= 1) {
    await users.updateLabels({ userId, labels: [ADMIN_LABEL] });
    return true;
  }
  return false;
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
      const { client, account } = createAdminClient();
      const created = await account.create({ userId: ID.unique(), email, password, name });
      const madeAdmin = await bootstrapFirstAdmin(client, created.$id);
      const session = await account.createEmailPasswordSession({ email, password });
      setSessionCookie(req, res, session.secret);
      res.json({ id: created.$id, name, email, isAdmin: madeAdmin });
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
      const { account } = createSessionClient(session.secret);
      const user = await account.get();
      setSessionCookie(req, res, session.secret);
      res.json({ id: user.$id, name: user.name, email: user.email, isAdmin: isAdmin(user) });
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
      const user = await account.updateName({ name });
      res.json({ id: user.$id, name: user.name, email: user.email, isAdmin: isAdmin(user) });
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
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    try {
      const { account } = createSessionClient(secret);
      const user = await account.get();
      res.json({ id: user.$id, name: user.name, email: user.email, isAdmin: isAdmin(user) });
    } catch {
      clearSessionCookie(req, res);
      res.status(401).json({ message: 'Not authenticated.' });
    }
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
      const { client, account } = createAdminClient();
      const session = await account.createSession({ userId, secret });
      await bootstrapFirstAdmin(client, userId);
      setSessionCookie(req, res, session.secret);
      res.redirect('/dashboard');
    } catch {
      res.redirect('/login?error=oauth-failed');
    }
  });
}
