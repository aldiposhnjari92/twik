import type { Express, Request, Response } from 'express';
import { ID, Query, type Models } from 'node-appwrite';
import { isAdmin } from './access';
import { createSessionClient } from './appwrite-admin';
import { errorStatus, readSessionSecret } from './session';

const DATABASE_ID = 'main';
const PROJECTS_COLLECTION_ID = 'projects';
const LIST_LIMIT = 100;
const ITERATION_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type ProjectStatus = 'active' | 'archived';

interface ProjectDocument extends Models.Document {
  name: string;
  description: string;
  status: ProjectStatus;
  ownerId: string;
  ownerName: string;
  startDate: string | null;
  deadline: string | null;
  iteration: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
}

interface ProjectDto {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  ownerId: string;
  ownerName: string;
  startDate: string | null;
  deadline: string | null;
  iteration: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDto(doc: ProjectDocument): ProjectDto {
  return {
    id: doc.$id,
    name: doc.name,
    description: doc.description,
    status: doc.status,
    ownerId: doc.ownerId,
    ownerName: doc.ownerName,
    startDate: doc.startDate ?? null,
    deadline: doc.deadline ?? null,
    iteration: doc.iteration ?? null,
    assigneeId: doc.assigneeId ?? null,
    assigneeName: doc.assigneeName ?? null,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
  };
}

function requireSession(req: Request, res: Response): ReturnType<typeof createSessionClient> | undefined {
  const secret = readSessionSecret(req);
  if (!secret) {
    res.status(401).json({ message: 'Not authenticated.' });
    return undefined;
  }
  return createSessionClient(secret);
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !isNaN(new Date(value).getTime());
}

interface ProjectWriteFields {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: string;
  deadline?: string;
  iteration?: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
}

/** Validates and normalizes the write-able project fields present in the request body. Returns an error message, or `undefined` if the body is valid. */
function parseProjectFields(body: unknown, target: ProjectWriteFields): string | undefined {
  const input = (body ?? {}) as Record<string, unknown>;

  if (input['name'] !== undefined) {
    const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
    if (!name) return 'Project name is required.';
    target.name = name;
  }

  if (input['description'] !== undefined) {
    target.description = typeof input['description'] === 'string' ? input['description'].trim() : '';
  }

  if (input['status'] !== undefined) {
    if (input['status'] !== 'active' && input['status'] !== 'archived') {
      return 'Status must be "active" or "archived".';
    }
    target.status = input['status'];
  }

  if (input['startDate'] !== undefined) {
    if (!isValidIsoDate(input['startDate'])) return 'Enter a valid start date.';
    target.startDate = new Date(input['startDate']).toISOString();
  }

  if (input['deadline'] !== undefined) {
    if (!isValidIsoDate(input['deadline'])) return 'Enter a valid deadline date.';
    target.deadline = new Date(input['deadline']).toISOString();
  }

  if (input['iteration'] !== undefined) {
    if (typeof input['iteration'] !== 'string' || !ITERATION_PATTERN.test(input['iteration'])) {
      return 'Iteration must be in YYYY-MM format.';
    }
    target.iteration = input['iteration'];
  }

  if (input['assigneeId'] !== undefined) {
    const assigneeId = input['assigneeId'];
    if (assigneeId === null || assigneeId === '') {
      target.assigneeId = null;
      target.assigneeName = null;
    } else if (typeof assigneeId === 'string') {
      const assigneeName = typeof input['assigneeName'] === 'string' ? input['assigneeName'].trim() : '';
      if (!assigneeName) return 'Assignee name is required when assigning a project.';
      target.assigneeId = assigneeId;
      target.assigneeName = assigneeName;
    } else {
      return 'Invalid assignee.';
    }
  }

  return undefined;
}

export function registerProjectRoutes(app: Express): void {
  app.get('/api/projects', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    const search = typeof req.query['search'] === 'string' ? req.query['search'].trim() : '';
    const status = req.query['status'];

    const queries = [Query.orderDesc('$createdAt'), Query.limit(LIST_LIMIT)];
    if (search) {
      queries.push(Query.search('name', search));
    }
    if (status === 'active' || status === 'archived') {
      queries.push(Query.equal('status', status));
    }

    try {
      const result = await session.databases.listDocuments<ProjectDocument>(DATABASE_ID, PROJECTS_COLLECTION_ID, queries);
      res.json({ projects: result.documents.map(toDto), total: result.total });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not load projects.',
      });
    }
  });

  app.get('/api/projects/:id', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    try {
      const doc = await session.databases.getDocument<ProjectDocument>(DATABASE_ID, PROJECTS_COLLECTION_ID, req.params['id']);
      res.json(toDto(doc));
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Project not found.',
      });
    }
  });

  app.post('/api/projects', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    const fields: ProjectWriteFields = {};
    const parseError = parseProjectFields(req.body, fields);
    if (parseError) {
      res.status(400).json({ message: parseError });
      return;
    }
    if (!fields.name) {
      res.status(400).json({ message: 'Project name is required.' });
      return;
    }
    if (!fields.startDate) {
      res.status(400).json({ message: 'Start date is required.' });
      return;
    }
    if (!fields.deadline) {
      res.status(400).json({ message: 'Deadline is required.' });
      return;
    }
    if (new Date(fields.deadline) < new Date(fields.startDate)) {
      res.status(400).json({ message: 'Deadline must be on or after the start date.' });
      return;
    }
    if (!fields.iteration) {
      res.status(400).json({ message: 'Iteration is required.' });
      return;
    }

    try {
      const user = await session.account.get();
      const doc = await session.databases.createDocument<ProjectDocument>(DATABASE_ID, PROJECTS_COLLECTION_ID, ID.unique(), {
        name: fields.name,
        description: fields.description ?? '',
        status: 'active',
        ownerId: user.$id,
        ownerName: user.name,
        startDate: fields.startDate,
        deadline: fields.deadline,
        iteration: fields.iteration,
        assigneeId: fields.assigneeId ?? null,
        assigneeName: fields.assigneeName ?? null,
      });
      res.status(201).json(toDto(doc));
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not create the project.',
      });
    }
  });

  app.patch('/api/projects/:id', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    const fields: ProjectWriteFields = {};
    const parseError = parseProjectFields(req.body, fields);
    if (parseError) {
      res.status(400).json({ message: parseError });
      return;
    }

    try {
      const current = await session.databases.getDocument<ProjectDocument>(DATABASE_ID, PROJECTS_COLLECTION_ID, req.params['id']);

      const caller = await session.account.get();
      const canModify = isAdmin(caller) || caller.$id === current.ownerId || caller.$id === current.assigneeId;
      if (!canModify) {
        res.status(403).json({ message: 'Only the owner, the assignee, or a workspace admin can edit this project.' });
        return;
      }

      if (fields.startDate !== undefined || fields.deadline !== undefined) {
        const effectiveStart = fields.startDate ?? current.startDate ?? undefined;
        const effectiveDeadline = fields.deadline ?? current.deadline ?? undefined;
        if (effectiveStart && effectiveDeadline && new Date(effectiveDeadline) < new Date(effectiveStart)) {
          res.status(400).json({ message: 'Deadline must be on or after the start date.' });
          return;
        }
      }

      const doc = await session.databases.updateDocument<ProjectDocument>(DATABASE_ID, PROJECTS_COLLECTION_ID, req.params['id'], fields);
      res.json(toDto(doc));
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not update the project.',
      });
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    try {
      const current = await session.databases.getDocument<ProjectDocument>(DATABASE_ID, PROJECTS_COLLECTION_ID, req.params['id']);

      const caller = await session.account.get();
      const canDelete = isAdmin(caller) || caller.$id === current.ownerId;
      if (!canDelete) {
        res.status(403).json({ message: 'Only the owner or a workspace admin can delete this project.' });
        return;
      }

      await session.databases.deleteDocument(DATABASE_ID, PROJECTS_COLLECTION_ID, req.params['id']);
      res.json({ success: true });
    } catch (error) {
      res.status(errorStatus(error)).json({
        message: error instanceof Error ? error.message : 'Could not delete the project.',
      });
    }
  });
}
