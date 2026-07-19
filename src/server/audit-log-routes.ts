import type { Express } from 'express';
import { Query, type Models } from 'node-appwrite';
import { requireAdmin } from './access';
import { AUDIT_LOG_COLLECTION_ID } from './audit-log';
import { DATABASE_ID } from './billing';
import { errorStatus } from './session';

const PAGE_SIZE = 50;

interface AuditLogDocument extends Models.Document {
  actorName: string;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  metadata: string | null;
}

function toDto(doc: AuditLogDocument) {
  return {
    id: doc.$id,
    actorName: doc.actorName,
    action: doc.action,
    targetType: doc.targetType ?? null,
    targetLabel: doc.targetLabel ?? null,
    metadata: doc.metadata ? (JSON.parse(doc.metadata) as Record<string, unknown>) : null,
    createdAt: doc.$createdAt,
  };
}

/**
 * Cursor-paginated — unlike every other list endpoint in this app (which caps at a flat
 * Query.limit(100), fine for team-sized datasets), an audit log grows unboundedly and needs real
 * pagination from the start.
 */
export function registerAuditLogRoutes(app: Express): void {
  app.get('/api/audit-log', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
    const queries = [Query.equal('workspaceId', workspace.teamId), Query.orderDesc('$createdAt'), Query.limit(PAGE_SIZE)];
    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    try {
      const result = await workspace.databases.listDocuments<AuditLogDocument>(DATABASE_ID, AUDIT_LOG_COLLECTION_ID, queries);
      const events = result.documents.map(toDto);
      const nextCursor = result.documents.length === PAGE_SIZE ? result.documents[result.documents.length - 1].$id : null;
      res.json({ events, nextCursor });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not load the audit log.',
      });
    }
  });
}
