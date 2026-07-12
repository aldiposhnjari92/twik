import type { Express } from 'express';
import type { Models } from 'node-appwrite';
import { createSessionClient } from './appwrite-admin';
import { TtlCache } from './cache';
import { errorStatus, readSessionSecret } from './session';

const DATABASE_ID = 'main';
const WORKSPACE_COLLECTION_ID = 'workspace';
const WORKSPACE_DOCUMENT_ID = 'settings';
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
}

type WorkspaceDto = ReturnType<typeof toDto>;

function toDto(doc: WorkspaceDocument) {
  return { name: doc.name, description: doc.description, timezone: doc.timezone, updatedAt: doc.$updatedAt };
}

const workspaceCache = new TtlCache<WorkspaceDto>(WORKSPACE_CACHE_TTL_MS);

export function registerWorkspaceRoutes(app: Express): void {
  app.get('/api/workspace', async (req, res) => {
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

    const cached = workspaceCache.get();
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const { databases } = createSessionClient(secret);
      const doc = await databases.getDocument<WorkspaceDocument>(DATABASE_ID, WORKSPACE_COLLECTION_ID, WORKSPACE_DOCUMENT_ID);
      const dto = toDto(doc);
      workspaceCache.set(dto);
      res.json(dto);
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not load workspace settings.',
      });
    }
  });

  app.patch('/api/workspace', async (req, res) => {
    const secret = readSessionSecret(req);
    if (!secret) {
      res.status(401).json({ message: 'Not authenticated.' });
      return;
    }

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
      const { databases } = createSessionClient(secret);
      const doc = await databases.updateDocument<WorkspaceDocument>(
        DATABASE_ID,
        WORKSPACE_COLLECTION_ID,
        WORKSPACE_DOCUMENT_ID,
        fields,
      );
      const dto = toDto(doc);
      workspaceCache.set(dto);
      res.json(dto);
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update workspace settings.',
      });
    }
  });
}
