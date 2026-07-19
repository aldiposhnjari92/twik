import type { Request, Response } from 'express';
import { Query, type Account, type Databases, type Models, type Teams } from 'node-appwrite';
import { createSessionClient } from './appwrite-admin';
import { readSessionSecret } from './session';

/** Role string granting workspace-admin privileges within a team membership. */
export const ADMIN_ROLE = 'admin';
export const MEMBER_ROLE = 'member';

export interface WorkspaceContext {
  teamId: string;
  isAdmin: boolean;
  user: Models.User<Models.Preferences>;
  account: Account;
  databases: Databases;
  teams: Teams;
}

/**
 * Resolves the caller's account, their workspace (an Appwrite Team), and their role within it.
 * A workspace IS a team; "admin" is a team membership role, not a global account label. Assumes
 * exactly one team per user — v1 has no multi-workspace membership yet.
 */
export async function resolveWorkspace(secret: string): Promise<WorkspaceContext | undefined> {
  try {
    const { account, databases, teams } = createSessionClient(secret);
    const [user, teamList] = await Promise.all([account.get(), teams.list({ queries: [Query.limit(1)] })]);

    const team = teamList.teams[0];
    if (!team) return undefined;

    const { memberships } = await teams.listMemberships({ teamId: team.$id, queries: [Query.equal('userId', user.$id)] });
    const isAdmin = (memberships[0]?.roles ?? []).includes(ADMIN_ROLE);

    return { teamId: team.$id, isAdmin, user, account, databases, teams };
  } catch {
    return undefined;
  }
}

/**
 * Resolves the caller's workspace context, writing a 401 response if they're not authenticated or
 * don't belong to a workspace. Callers should `return` immediately when this resolves to `undefined`.
 */
export async function requireWorkspace(req: Request, res: Response): Promise<WorkspaceContext | undefined> {
  const secret = readSessionSecret(req);
  if (!secret) {
    res.status(401).json({ message: 'Not authenticated.' });
    return undefined;
  }

  const context = await resolveWorkspace(secret);
  if (!context) {
    res.status(401).json({ message: 'Not authenticated.' });
    return undefined;
  }
  return context;
}

/** Same as {@link requireWorkspace}, additionally requiring the caller to be a workspace admin. */
export async function requireAdmin(req: Request, res: Response): Promise<WorkspaceContext | undefined> {
  const context = await requireWorkspace(req, res);
  if (!context) return undefined;

  if (!context.isAdmin) {
    res.status(403).json({ message: 'Only workspace admins can do this.' });
    return undefined;
  }
  return context;
}
