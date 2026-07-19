import { ID, Permission, Role } from 'node-appwrite';
import { ADMIN_ROLE } from './access';
import { createAdminClient } from './appwrite-admin';
import { DATABASE_ID } from './billing';

export const AUDIT_LOG_COLLECTION_ID = 'audit_logs';

export type AuditAction =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'member.invited'
  | 'member.updated'
  | 'member.removed'
  | 'member.role_changed'
  | 'workspace.updated'
  | 'billing.subscription_started'
  | 'billing.subscription_updated'
  | 'billing.subscription_canceled'
  | 'billing.payment_failed';

/** Synthetic actor for events triggered by a webhook rather than a signed-in user. */
export const SYSTEM_ACTOR = { actorId: 'system', actorName: 'Stripe' } as const;

interface LogEventInput {
  teamId: string;
  actorId: string;
  actorName: string;
  action: AuditAction;
  targetType?: string;
  targetLabel?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Records an audit event. Best-effort: a logging failure must never break the operation it's
 * recording, so failures are swallowed rather than propagated.
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    const { databases } = createAdminClient();
    await databases.createDocument(
      DATABASE_ID,
      AUDIT_LOG_COLLECTION_ID,
      ID.unique(),
      {
        workspaceId: input.teamId,
        actorId: input.actorId,
        actorName: input.actorName,
        action: input.action,
        targetType: input.targetType ?? null,
        targetLabel: input.targetLabel ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
      [Permission.read(Role.team(input.teamId, ADMIN_ROLE))],
    );
  } catch {
    // Swallowed intentionally — see doc comment above.
  }
}
