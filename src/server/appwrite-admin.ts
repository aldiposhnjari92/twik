import { Account, Client, Databases } from 'node-appwrite';

const appwriteConfig = {
  endpoint: 'https://fra.cloud.appwrite.io/v1',
  projectId: 'twik',
};

/**
 * A client authenticated with the project API key. Only use this for operations that require
 * elevated privilege (creating a user, or creating a session — which needs the key present for
 * Appwrite to include the real `secret` in the response).
 *
 * Do not also call `setSession` on this client: Appwrite resolves the caller identity to the API
 * key (an "application" actor) when both are present, and Account operations then fail with
 * "missing scopes" since the key isn't granted account-level scope. Use `createSessionClient`
 * for anything that needs to act as the signed-in user.
 */
export function createAdminClient(): { client: Client; account: Account } {
  const apiKey = process.env['APPWRITE_API_KEY'];
  if (!apiKey) {
    throw new Error('APPWRITE_API_KEY environment variable is not set.');
  }

  const client = new Client().setEndpoint(appwriteConfig.endpoint).setProject(appwriteConfig.projectId).setKey(apiKey);

  return { client, account: new Account(client) };
}

/** A client authenticated as the signed-in user via their session secret, no API key attached. */
export function createSessionClient(secret: string): { client: Client; account: Account; databases: Databases } {
  const client = new Client().setEndpoint(appwriteConfig.endpoint).setProject(appwriteConfig.projectId).setSession(secret);

  return { client, account: new Account(client), databases: new Databases(client) };
}
