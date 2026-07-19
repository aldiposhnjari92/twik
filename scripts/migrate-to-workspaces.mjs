// One-time migration: wraps the pre-multi-tenancy single global workspace into an Appwrite Team,
// so existing users and projects keep working once the app starts treating "workspace" as a team
// instead of a hardcoded singleton document. Run this once, against the live project, AFTER
// `node scripts/setup-appwrite.mjs` (which provisions the new schema) and BEFORE deploying server
// code that expects `projects.workspaceId` / team-based permissions to already be in place.
//
// Usage: node scripts/migrate-to-workspaces.mjs
import { Client, Databases, ID, Permission, Query, Role, Teams, Users } from 'node-appwrite';

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
const OLD_WORKSPACE_DOCUMENT_ID = 'settings';
const ADMIN_ROLE = 'admin';
const MEMBER_ROLE = 'member';
const PAGE_SIZE = 100;

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(apiKey);
const databases = new Databases(client);
const users = new Users(client);
const teams = new Teams(client);

async function fetchAllUsers() {
  const all = [];
  let cursor;
  while (true) {
    const queries = [Query.limit(PAGE_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await users.list({ queries });
    all.push(...page.users);
    if (page.users.length < PAGE_SIZE) break;
    cursor = page.users[page.users.length - 1].$id;
  }
  return all;
}

async function fetchAllProjects() {
  const all = [];
  let cursor;
  while (true) {
    const queries = [Query.limit(PAGE_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await databases.listDocuments(DATABASE_ID, PROJECTS_COLLECTION_ID, queries);
    all.push(...page.documents);
    if (page.documents.length < PAGE_SIZE) break;
    cursor = page.documents[page.documents.length - 1].$id;
  }
  return all;
}

async function readOldWorkspaceSettings() {
  try {
    return await databases.getDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, OLD_WORKSPACE_DOCUMENT_ID);
  } catch (error) {
    if (error.code === 404) return null;
    throw error;
  }
}

async function alreadyMigrated() {
  const { total } = await teams.list({ queries: [Query.limit(1)] });
  return total > 0;
}

async function run() {
  if (await alreadyMigrated()) {
    console.log('At least one team already exists — migration appears to have already run. Exiting without changes.');
    return;
  }

  const oldSettings = await readOldWorkspaceSettings();
  const workspaceName = oldSettings?.name || 'Default Workspace';
  console.log(`Creating team "${workspaceName}"...`);

  const teamId = ID.unique();
  await teams.create({ teamId, name: workspaceName });
  console.log(`Created team ${teamId}.`);

  const allUsers = await fetchAllUsers();
  console.log(`Found ${allUsers.length} existing user(s). Adding them as workspace members...`);
  for (const user of allUsers) {
    const roles = user.labels.includes(ADMIN_ROLE) ? [ADMIN_ROLE] : [MEMBER_ROLE];
    await teams.createMembership({ teamId, userId: user.$id, roles });
    console.log(`  Added ${user.email} as ${roles[0]}.`);
  }
  if (allUsers.length === 0) {
    console.warn('  No existing users found — the workspace has no members yet. The next person to register or sign in will need to be added manually, or this migration re-run after they exist.');
  }

  await databases.createDocument(
    DATABASE_ID,
    WORKSPACE_COLLECTION_ID,
    teamId,
    {
      name: workspaceName,
      description: oldSettings?.description ?? '',
      timezone: oldSettings?.timezone ?? 'UTC',
      plan: 'free',
    },
    // documentSecurity is on for this collection — without explicit permissions, the document is
    // only ever readable by the admin/API-key client, not by the workspace's own members.
    [Permission.read(Role.team(teamId)), Permission.update(Role.team(teamId, ADMIN_ROLE))],
  );
  console.log(`Created workspace settings document at ${teamId}.`);

  const allProjects = await fetchAllProjects();
  console.log(`Found ${allProjects.length} existing project(s). Tagging them with the new workspace...`);
  for (const project of allProjects) {
    await databases.updateDocument(DATABASE_ID, PROJECTS_COLLECTION_ID, project.$id, { workspaceId: teamId }, [
      Permission.read(Role.team(teamId)),
      Permission.update(Role.team(teamId)),
      Permission.delete(Role.team(teamId)),
    ]);
  }
  console.log(`Tagged ${allProjects.length} project(s) with workspaceId ${teamId}.`);

  if (oldSettings) {
    await databases.deleteDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, OLD_WORKSPACE_DOCUMENT_ID);
    console.log('Deleted the old singleton workspace settings document.');
  }

  console.log('Migration complete.');
}

await run();
