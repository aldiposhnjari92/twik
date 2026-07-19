import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Feature {
  icon: string;
  title: string;
  description: string;
}

interface PricingPlan {
  name: string;
  price: string;
  priceNote: string;
  description: string;
  features: string[];
  cta: string;
  highlighted: boolean;
}

interface Faq {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-marketing',
  imports: [RouterLink],
  templateUrl: './marketing.html',
  styleUrl: './marketing.css',
})
export class Marketing {
  /** Computed once per instance, not read live in the template — see CLAUDE.md on SSR/hydration. */
  protected readonly currentYear = new Date().getFullYear();

  protected readonly features: Feature[] = [
    {
      icon: 'pi pi-folder-open',
      title: 'Projects that stay on track',
      description: 'Owners, assignees, deadlines, and status in one place — nothing falls through the cracks.',
    },
    {
      icon: 'pi pi-users',
      title: 'Team workspaces',
      description: 'Invite your team, assign departments, and control access with admin and member roles.',
    },
    {
      icon: 'pi pi-history',
      title: 'Full audit log',
      description: 'Every project, membership, and settings change is recorded — know who did what, when.',
    },
    {
      icon: 'pi pi-google',
      title: 'Sign in with Google',
      description: 'Get your team onboarded in seconds with one-click Google sign-in.',
    },
    {
      icon: 'pi pi-shield',
      title: 'Workspace isolation',
      description: 'Every workspace is fully isolated — your data is never visible to anyone outside your team.',
    },
    {
      icon: 'pi pi-credit-card',
      title: 'Simple per-seat pricing',
      description: 'Pay only for the teammates you invite. No hidden fees, cancel anytime.',
    },
  ];

  protected readonly pricingPlans: PricingPlan[] = [
    {
      name: 'Free',
      price: '$0',
      priceNote: 'forever',
      description: 'For small teams just getting started.',
      features: ['Up to 3 seats', 'Up to 5 projects', 'Team workspace', 'Full audit log'],
      cta: 'Start for free',
      highlighted: false,
    },
    {
      name: 'Pro',
      price: '$15',
      priceNote: 'per seat / month',
      description: 'For growing teams that need more room.',
      features: ['Unlimited seats', 'Unlimited projects', 'Everything in Free', '14-day free trial, no card required'],
      cta: 'Start free trial',
      highlighted: true,
    },
    {
      name: 'Enterprise',
      price: 'Contact us',
      priceNote: '',
      description: 'For organizations with custom needs.',
      features: ['Unlimited seats', 'Unlimited projects', 'Dedicated support', 'Custom onboarding'],
      cta: 'Contact us',
      highlighted: false,
    },
  ];

  protected readonly faqs: Faq[] = [
    {
      question: 'Do I need a credit card to start?',
      answer: 'No. Every new workspace starts on a 14-day Pro trial with no credit card required.',
    },
    {
      question: 'What happens when my trial ends?',
      answer:
        'Your workspace drops to the Free plan limits. Nothing is deleted — you can upgrade anytime to unlock unlimited seats and projects again.',
    },
    {
      question: 'Can I change plans later?',
      answer: 'Yes. Upgrade or manage your subscription anytime from Settings → Billing.',
    },
    {
      question: 'Is my data isolated from other workspaces?',
      answer: 'Yes. Every workspace is fully isolated at the data level — nobody outside your team can see your projects or members.',
    },
  ];
}
