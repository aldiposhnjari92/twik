import type { Request, Response } from 'express';
import type { Models } from 'node-appwrite';
import { createSessionClient } from './appwrite-admin';
import { readSessionSecret } from './session';

/** Appwrite label used to mark a user as a workspace admin; grants no built-in Appwrite permissions by itself. */
export const ADMIN_LABEL = 'admin';

export function isAdmin(user: Pick<Models.User<Models.Preferences>, 'labels'>): boolean {
  return user.labels.includes(ADMIN_LABEL);
}

/**
 * Resolves the caller's own account and confirms they're a workspace admin, writing a 401/403
 * response and returning `undefined` if not. Callers should `return` immediately when this
 * resolves to `undefined`.
 */
export async function requireAdmin(req: Request, res: Response): Promise<Models.User<Models.Preferences> | undefined> {
  const secret = readSessionSecret(req);
  if (!secret) {
    res.status(401).json({ message: 'Not authenticated.' });
    return undefined;
  }

  try {
    const { account } = createSessionClient(secret);
    const user = await account.get();
    if (!isAdmin(user)) {
      res.status(403).json({ message: 'Only workspace admins can do this.' });
      return undefined;
    }
    return user;
  } catch {
    res.status(401).json({ message: 'Not authenticated.' });
    return undefined;
  }
}
