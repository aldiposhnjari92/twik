import type { Databases, Models } from 'node-appwrite';

export const DATABASE_ID = 'main';
export const WORKSPACE_COLLECTION_ID = 'workspace';

/** Free tier blocks new creation past these counts; existing data over the limit is never touched. */
export const FREE_SEAT_LIMIT = 3;
export const FREE_PROJECT_LIMIT = 5;

export type Plan = 'free' | 'pro' | 'enterprise';
/** Whatever Stripe's subscription status enum says — stored as-is, not re-validated against a closed set. */
export type SubscriptionStatus = string | null;

export interface WorkspaceBillingDocument extends Models.Document {
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/**
 * The tier actually enforced — `plan` alone isn't the final answer. No cron job flips a workspace
 * out of its trial; expiry is just a timestamp comparison evaluated wherever this is called.
 */
export function effectivePlan(doc: Pick<WorkspaceBillingDocument, 'plan' | 'subscriptionStatus' | 'trialEndsAt'>): Plan {
  if (doc.plan === 'enterprise') return 'enterprise';
  if (doc.plan === 'pro') {
    if (doc.subscriptionStatus === 'active' || doc.subscriptionStatus === 'past_due') return 'pro';
    if (doc.subscriptionStatus === 'trialing' && doc.trialEndsAt && new Date(doc.trialEndsAt) > new Date()) return 'pro';
  }
  return 'free';
}

/** Always reads fresh — no caching, since plan/limit checks need an up-to-date answer. */
export async function getWorkspaceBillingDoc(databases: Databases, teamId: string): Promise<WorkspaceBillingDocument> {
  return databases.getDocument<WorkspaceBillingDocument>(DATABASE_ID, WORKSPACE_COLLECTION_ID, teamId);
}
