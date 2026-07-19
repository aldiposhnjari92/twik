import type { Express } from 'express';
import express from 'express';
import { Query, type Databases } from 'node-appwrite';
import type Stripe from 'stripe';
import { requireAdmin, requireWorkspace } from './access';
import { createAdminClient } from './appwrite-admin';
import {
  DATABASE_ID,
  FREE_PROJECT_LIMIT,
  FREE_SEAT_LIMIT,
  WORKSPACE_COLLECTION_ID,
  effectivePlan,
  getWorkspaceBillingDoc,
  type WorkspaceBillingDocument,
} from './billing';
import { getStripeClient } from './stripe-client';
import { errorStatus, originOf } from './session';

const PROJECTS_COLLECTION_ID = 'projects';

async function findWorkspaceByCustomerId(databases: Databases, customerId: string): Promise<WorkspaceBillingDocument | undefined> {
  const { documents } = await databases.listDocuments<WorkspaceBillingDocument>(DATABASE_ID, WORKSPACE_COLLECTION_ID, [
    Query.equal('stripeCustomerId', customerId),
    Query.limit(1),
  ]);
  return documents[0];
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const { databases } = createAdminClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const teamId = session.client_reference_id;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (!teamId || !customerId || !subscriptionId) return;

      const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
      await databases.updateDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, teamId, {
        plan: 'pro',
        subscriptionStatus: subscription.status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });
      return;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const doc = await findWorkspaceByCustomerId(databases, customerId);
      if (!doc) return;

      await databases.updateDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, doc.$id, { subscriptionStatus: subscription.status });
      return;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const doc = await findWorkspaceByCustomerId(databases, customerId);
      if (!doc) return;

      await databases.updateDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, doc.$id, {
        plan: 'free',
        subscriptionStatus: 'canceled',
        stripeSubscriptionId: null,
      });
      return;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customerId) return;
      const doc = await findWorkspaceByCustomerId(databases, customerId);
      if (!doc) return;

      await databases.updateDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, doc.$id, { subscriptionStatus: 'past_due' });
      return;
    }

    default:
      return;
  }
}

/**
 * Registered separately from registerBillingRoutes, and must run BEFORE the app's global
 * `express.json()` middleware — Stripe signature verification needs the raw, unparsed request body.
 */
export function registerBillingWebhook(app: Express): void {
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
    if (!webhookSecret || typeof signature !== 'string') {
      res.status(400).json({ message: 'Missing webhook signature.' });
      return;
    }

    let event: Stripe.Event;
    try {
      event = getStripeClient().webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch {
      res.status(400).json({ message: 'Webhook signature verification failed.' });
      return;
    }

    try {
      await handleStripeEvent(event);
      res.json({ received: true });
    } catch (error) {
      // Non-2xx makes Stripe retry with backoff — appropriate for a transient Appwrite/Stripe failure.
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : 'Could not process webhook event.' });
    }
  });
}

export function registerBillingRoutes(app: Express): void {
  app.get('/api/billing', async (req, res) => {
    const workspace = await requireWorkspace(req, res);
    if (!workspace) return;

    try {
      const doc = await getWorkspaceBillingDoc(workspace.databases, workspace.teamId);
      const plan = effectivePlan(doc);

      const [{ total: seatCount }, { total: projectCount }] = await Promise.all([
        workspace.teams.listMemberships({ teamId: workspace.teamId, queries: [Query.limit(1)] }),
        workspace.databases.listDocuments(DATABASE_ID, PROJECTS_COLLECTION_ID, [Query.equal('workspaceId', workspace.teamId), Query.limit(1)]),
      ]);

      res.json({
        plan,
        subscriptionStatus: doc.subscriptionStatus,
        trialEndsAt: doc.trialEndsAt,
        seatCount,
        seatLimit: plan === 'free' ? FREE_SEAT_LIMIT : null,
        projectCount,
        projectLimit: plan === 'free' ? FREE_PROJECT_LIMIT : null,
      });
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : 'Could not load billing details.' });
    }
  });

  app.post('/api/billing/checkout', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    const priceId = process.env['STRIPE_PRICE_ID_PRO'];
    if (!priceId) {
      res.status(500).json({ message: 'Billing is not configured yet.' });
      return;
    }

    try {
      const stripe = getStripeClient();
      const doc = await getWorkspaceBillingDoc(workspace.databases, workspace.teamId);

      let customerId = doc.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: workspace.user.email,
          name: workspace.user.name,
          metadata: { workspaceId: workspace.teamId },
        });
        customerId = customer.id;
        await workspace.databases.updateDocument(DATABASE_ID, WORKSPACE_COLLECTION_ID, workspace.teamId, { stripeCustomerId: customerId });
      }

      const { total: seatCount } = await workspace.teams.listMemberships({ teamId: workspace.teamId, queries: [Query.limit(1)] });
      const origin = originOf(req);

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: workspace.teamId,
        line_items: [{ price: priceId, quantity: Math.max(seatCount, 1) }],
        success_url: `${origin}/settings?billing=success`,
        cancel_url: `${origin}/settings?billing=cancelled`,
      });

      if (!session.url) {
        res.status(500).json({ message: 'Could not start checkout.' });
        return;
      }
      res.json({ url: session.url });
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : 'Could not start checkout.' });
    }
  });

  app.post('/api/billing/portal', async (req, res) => {
    const workspace = await requireAdmin(req, res);
    if (!workspace) return;

    try {
      const doc = await getWorkspaceBillingDoc(workspace.databases, workspace.teamId);
      if (!doc.stripeCustomerId) {
        res.status(400).json({ message: "This workspace doesn't have a billing account yet." });
        return;
      }

      const session = await getStripeClient().billingPortal.sessions.create({
        customer: doc.stripeCustomerId,
        return_url: `${originOf(req)}/settings`,
      });
      res.json({ url: session.url });
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : 'Could not open the billing portal.' });
    }
  });
}
