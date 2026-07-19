import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type Plan = 'free' | 'pro' | 'enterprise';

export interface BillingSummary {
  plan: Plan;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  seatCount: number;
  seatLimit: number | null;
  projectCount: number;
  projectLimit: number | null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => undefined);
  return (data && typeof data.message === 'string' && data.message) || fallback;
}

@Injectable({ providedIn: 'root' })
export class Billing {
  private readonly platformId = inject(PLATFORM_ID);

  async get(): Promise<BillingSummary> {
    if (!isPlatformBrowser(this.platformId)) {
      return { plan: 'free', subscriptionStatus: null, trialEndsAt: null, seatCount: 0, seatLimit: null, projectCount: 0, projectLimit: null };
    }
    const response = await fetch('/api/billing');
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not load billing details.'));
    }
    return response.json();
  }

  /** Redirects the browser to Stripe Checkout; resolves only if the request to start it fails. */
  async startCheckout(): Promise<void> {
    const response = await fetch('/api/billing/checkout', { method: 'POST' });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not start checkout.'));
    }
    const { url } = await response.json();
    window.location.href = url;
  }

  /** Redirects the browser to the Stripe Billing Portal; resolves only if the request to open it fails. */
  async openPortal(): Promise<void> {
    const response = await fetch('/api/billing/portal', { method: 'POST' });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not open the billing portal.'));
    }
    const { url } = await response.json();
    window.location.href = url;
  }
}
