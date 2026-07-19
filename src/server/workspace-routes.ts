import type { Express } from 'express';
import type { Models } from 'node-appwrite';
import { requireAdmin, requireWorkspace } from './access';
import { DATABASE_ID, WORKSPACE_COLLECTION_ID } from './billing';
import { KeyedTtlCache } from './cache';
import { errorStatus } from './session';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;
const WORKSPACE_CACHE_TTL_MS = 30_000;

export const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

interface WorkspaceDocument extends Models.Document {
  name: string;
  description: string;
  timezone: string;
  plan: string;
}

type WorkspaceDto = ReturnType<typeof toDto>;

function toDto(doc: WorkspaceDocument) {
  return { name: doc.name, description: doc.description, timezone: doc.timezone, plan: doc.plan, updatedAt: doc.$updatedAt };
}

// Keyed by teamId — one workspace document per team, never a single global slot.
const workspaceCache = new KeyedTtlCache<WorkspaceDto>(WORKSPACE_CACHE_TTL_MS);

export function registerWorkspaceRoutes(app: Express): void {
  app.get('/api/workspace', async (req, res) => {
    const workspace = await requireWorkspace(req, res);
    if (!workspace) return;

    const cached = workspaceCache.get(workspace.teamId);
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const doc = await workspace.databases.getDocument<WorkspaceDocument>(DATABASE_ID, WORKSPACE_COLLECTION_ID, workspace.teamId);
      const dto = toDto(doc);
      workspaceCache.set(workspace.teamId, dto);
      res.json(dto);
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not load workspace settings.',
      });
    }
  });

  app.patch('/api/workspace', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    const { name, description, timezone } = req.body ?? {};
    const fields: Record<string, string> = {};

    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) {
        res.status(400).json({ message: 'Workspace name is required.' });
        return;
      }
      if (trimmed.length > NAME_MAX_LENGTH) {
        res.status(400).json({ message: `Keep the name under ${NAME_MAX_LENGTH} characters.` });
        return;
      }
      fields['name'] = trimmed;
    }

    if (description !== undefined) {
      const trimmed = typeof description === 'string' ? description.trim() : '';
      if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
        res.status(400).json({ message: `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters.` });
        return;
      }
      fields['description'] = trimmed;
    }

    if (timezone !== undefined) {
      if (typeof timezone !== 'string' || !TIMEZONES.includes(timezone)) {
        res.status(400).json({ message: 'Choose a valid timezone.' });
        return;
      }
      fields['timezone'] = timezone;
    }

    try {
      const doc = await workspace.databases.updateDocument<WorkspaceDocument>(DATABASE_ID, WORKSPACE_COLLECTION_ID, workspace.teamId, fields);
      const dto = toDto(doc);
      workspaceCache.set(workspace.teamId, dto);
      res.json(dto);
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update workspace settings.',
      });
    }
  });
}
