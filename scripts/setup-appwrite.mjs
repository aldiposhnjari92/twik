// One-time, idempotent provisioning script for the Appwrite resources this app depends on.
// Usage: node scripts/setup-appwrite.mjs
import { Client, Databases, Permission, Role } from 'node-appwrite';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; environment variables are expected to be set another way.
}

const apiKey = process.env.APPWRITE_API_KEY;
if (!apiKey) {
  console.error('APPWRITE_API_KEY is not set.');
  process.exit(1);
}

const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = 'twik';
const DATABASE_ID = 'main';
const PROJECTS_COLLECTION_ID = 'projects';
const WORKSPACE_COLLECTION_ID = 'workspace';

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(apiKey);
const databases = new Databases(client);

async function ensureDatabase() {
  try {
    await databases.get(DATABASE_ID);
    console.log(`Database "${DATABASE_ID}" already exists.`);
  } catch (error) {
    if (error.code !== 404) throw error;
    await databases.create(DATABASE_ID, 'Twik');
    console.log(`Created database "${DATABASE_ID}".`);
  }
}

async function waitForAttributes(collectionId, keys) {
  const pending = new Set(keys);
  while (pending.size > 0) {
    const { attributes } = await databases.listAttributes(DATABASE_ID, collectionId);
    for (const attribute of attributes) {
      if (!pending.has(attribute.key)) continue;
      if (attribute.status === 'available') {
        pending.delete(attribute.key);
      } else if (attribute.status === 'failed' || attribute.status === 'stuck') {
        throw new Error(`Attribute "${attribute.key}" failed to provision (status: ${attribute.status}).`);
      }
    }
    if (pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Attributes are optional at the database level even where the app requires them at creation time:
// Appwrite won't backfill existing documents when a required attribute is added, so keeping them
// optional here avoids breaking documents that predate a schema change.
const PROJECT_ATTRIBUTES = [
  { key: 'name', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'name', 200, true) },
  { key: 'description', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'description', 2000, false, '') },
  {
    key: 'status',
    create: () => databases.createEnumAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'status', ['active', 'archived'], false, 'active'),
  },
  { key: 'ownerId', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'ownerId', 64, true) },
  { key: 'ownerName', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'ownerName', 128, true) },
  { key: 'startDate', create: () => databases.createDatetimeAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'startDate', false) },
  { key: 'deadline', create: () => databases.createDatetimeAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'deadline', false) },
  { key: 'iteration', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'iteration', 7, false) },
  { key: 'assigneeId', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'assigneeId', 64, false) },
  { key: 'assigneeName', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'assigneeName', 128, false) },
  // Optional at the schema level (not required) even though the app always sets it on create: pre-existing
  // documents from before multi-tenancy predate this attribute, and Appwrite won't backfill them — the
  // one-time migrate-to-workspaces.mjs script does that instead. See PROJECT_ATTRIBUTES comment above.
  { key: 'workspaceId', create: () => databases.createStringAttribute(DATABASE_ID, PROJECTS_COLLECTION_ID, 'workspaceId', 36, false) },
];

// Read/update/delete isolation between workspaces is enforced per-document (Role.team(teamId)
// permissions set at create time), which requires documentSecurity: true — Appwrite otherwise ignores
// per-document permissions in favor of the collection-level set. `create` has no document to scope to
// yet, so it stays a collection-level grant to any authenticated user; the Express server (never the
// browser directly) is what actually decides which workspace a create is allowed to attach to. Asserted
// on every run so this also self-heals collections created before this switch (the pre-multi-tenancy schema).
async function ensureProjectsCollection() {
  try {
    await databases.getCollection(DATABASE_ID, PROJECTS_COLLECTION_ID);
    console.log(`Collection "${PROJECTS_COLLECTION_ID}" already exists.`);
  } catch (error) {
    if (error.code !== 404) throw error;
    await databases.createCollection(DATABASE_ID, PROJECTS_COLLECTION_ID, 'Projects', [Permission.create(Role.users())], true);
    console.log(`Created collection "${PROJECTS_COLLECTION_ID}".`);
  }

  await databases.updateCollection({
    databaseId: DATABASE_ID,
    collectionId: PROJECTS_COLLECTION_ID,
    name: 'Projects',
    permissions: [Permission.create(Role.users())],
    documentSecurity: true,
  });

  const { attributes: existingAttributes } = await databases.listAttributes(DATABASE_ID, PROJECTS_COLLECTION_ID);
  const existingKeys = new Set(existingAttributes.map((a) => a.key));
  const missing = PROJECT_ATTRIBUTES.filter((a) => !existingKeys.has(a.key));

  if (missing.length === 0) {
    console.log('All project attributes already exist.');
    return;
  }

  for (const attribute of missing) {
    await attribute.create();
  }
  console.log(`Created attributes: ${missing.map((a) => a.key).join(', ')}. Waiting for them to become available...`);

  await waitForAttributes(PROJECTS_COLLECTION_ID, missing.map((a) => a.key));
  console.log('All attributes are available.');
}

const WORKSPACE_ATTRIBUTES = [
  { key: 'name', create: () => databases.createStringAttribute(DATABASE_ID, WORKSPACE_COLLECTION_ID, 'name', 200, true) },
  { key: 'description', create: () => databases.createStringAttribute(DATABASE_ID, WORKSPACE_COLLECTION_ID, 'description', 2000, false, '') },
  { key: 'timezone', create: () => databases.createStringAttribute(DATABASE_ID, WORKSPACE_COLLECTION_ID, 'timezone', 64, false, 'UTC') },
  { key: 'plan', create: () => databases.createStringAttribute(DATABASE_ID, WORKSPACE_COLLECTION_ID, 'plan', 32, false, 'free') },
];

// One document per workspace (Appwrite Team), keyed by teamId — no longer a single global
// singleton document, so this function only provisions the collection/attributes, not any document.
async function ensureWorkspaceCollection() {
  try {
    await databases.getCollection(DATABASE_ID, WORKSPACE_COLLECTION_ID);
    console.log(`Collection "${WORKSPACE_COLLECTION_ID}" already exists.`);
  } catch (error) {
    if (error.code !== 404) throw error;
    await databases.createCollection(DATABASE_ID, WORKSPACE_COLLECTION_ID, 'Workspace', [], true);
    console.log(`Created collection "${WORKSPACE_COLLECTION_ID}".`);
  }

  await databases.updateCollection({
    databaseId: DATABASE_ID,
    collectionId: WORKSPACE_COLLECTION_ID,
    name: 'Workspace',
    permissions: [],
    documentSecurity: true,
  });

  const { attributes: existingAttributes } = await databases.listAttributes(DATABASE_ID, WORKSPACE_COLLECTION_ID);
  const existingKeys = new Set(existingAttributes.map((a) => a.key));
  const missing = WORKSPACE_ATTRIBUTES.filter((a) => !existingKeys.has(a.key));

  if (missing.length > 0) {
    for (const attribute of missing) {
      await attribute.create();
    }
    console.log(`Created attributes: ${missing.map((a) => a.key).join(', ')}. Waiting for them to become available...`);
    await waitForAttributes(WORKSPACE_COLLECTION_ID, missing.map((a) => a.key));
    console.log('All workspace attributes are available.');
  } else {
    console.log('All workspace attributes already exist.');
  }
}

async function waitForIndexAvailable(collectionId, key) {
  while (true) {
    const { indexes } = await databases.listIndexes(DATABASE_ID, collectionId);
    const index = indexes.find((i) => i.key === key);
    if (index?.status === 'available') return;
    if (index?.status === 'failed' || index?.status === 'stuck') {
      throw new Error(`Index "${key}" failed to provision (status: ${index.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Speeds up the "filter by status" query on the projects list; without it Appwrite falls back to
// scanning every document in the collection to evaluate the equality filter.
async function ensureStatusIndex() {
  const { indexes } = await databases.listIndexes(DATABASE_ID, PROJECTS_COLLECTION_ID);
  if (indexes.some((index) => index.key === 'status_idx')) {
    console.log('"status_idx" index already exists.');
    return;
  }

  await databases.createIndex(DATABASE_ID, PROJECTS_COLLECTION_ID, 'status_idx', 'key', ['status']);
  await waitForIndexAvailable(PROJECTS_COLLECTION_ID, 'status_idx');
  console.log('Created "status_idx" index.');
}

// Speeds up (and is required for) scoping every projects query to the caller's workspace.
async function ensureWorkspaceIdIndex() {
  const { indexes } = await databases.listIndexes(DATABASE_ID, PROJECTS_COLLECTION_ID);
  if (indexes.some((index) => index.key === 'workspaceId_idx')) {
    console.log('"workspaceId_idx" index already exists.');
    return;
  }

  await databases.createIndex(DATABASE_ID, PROJECTS_COLLECTION_ID, 'workspaceId_idx', 'key', ['workspaceId']);
  await waitForIndexAvailable(PROJECTS_COLLECTION_ID, 'workspaceId_idx');
  console.log('Created "workspaceId_idx" index.');
}

// Query.search() requires a `fulltext` index; a plain `key` index silently fails at query time.
async function ensureNameSearchIndex() {
  const { indexes } = await databases.listIndexes(DATABASE_ID, PROJECTS_COLLECTION_ID);
  const existing = indexes.find((index) => index.key === 'name_idx');

  if (existing?.type === 'fulltext') {
    console.log('"name_idx" fulltext index already exists.');
    return;
  }

  if (existing) {
    console.log(`"name_idx" exists as type "${existing.type}"; recreating as "fulltext"...`);
    await databases.deleteIndex(DATABASE_ID, PROJECTS_COLLECTION_ID, 'name_idx');
    while ((await databases.listIndexes(DATABASE_ID, PROJECTS_COLLECTION_ID)).indexes.some((i) => i.key === 'name_idx')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await databases.createIndex(DATABASE_ID, PROJECTS_COLLECTION_ID, 'name_idx', 'fulltext', ['name']);
  await waitForIndexAvailable(PROJECTS_COLLECTION_ID, 'name_idx');
  console.log('Created "name_idx" fulltext index.');
}

await ensureDatabase();
await ensureProjectsCollection();
await ensureNameSearchIndex();
await ensureStatusIndex();
await ensureWorkspaceIdIndex();
await ensureWorkspaceCollection();
console.log('Appwrite setup complete.');
