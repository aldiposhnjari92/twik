import Stripe from 'stripe';

let client: Stripe | undefined;

/** Lazily-instantiated singleton, mirroring appwrite-admin.ts's "throw if the env var is missing" convention. */
export function getStripeClient(): Stripe {
  if (!client) {
    const secretKey = process.env['STRIPE_SECRET_KEY'];
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set.');
    }
    client = new Stripe(secretKey);
  }
  return client;
}
