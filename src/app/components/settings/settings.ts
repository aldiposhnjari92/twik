import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormField, form, maxLengthError, requiredError, validate } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonDirective, ButtonIcon, ButtonLabel } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Fluid } from 'primeng/fluid';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { PasswordDirective } from 'primeng/password';
import { Select } from 'primeng/select';
import { Skeleton } from 'primeng/skeleton';
import { TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import { Tag } from 'primeng/tag';
import { Textarea } from 'primeng/textarea';
import { Auth, UserSession } from '../../auth/auth';
import { Billing, BillingSummary } from '../../billing/billing';
import { Notifications } from '../../notifications/notifications';
import { TIMEZONES, Timezone, Workspace } from '../../workspace/workspace';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / MS_PER_DAY));
}

interface SessionRow extends UserSession {
  deviceLabel: string;
  locationLabel: string;
}

function deviceLabelOf(session: UserSession): string {
  const parts = [session.clientName, session.osName].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' on ') : 'Unknown device';
}

function locationLabelOf(session: UserSession): string {
  return session.countryName || session.ip || 'Unknown location';
}

@Component({
  selector: 'app-settings',
  imports: [
    FormsModule,
    FormField,
    ButtonDirective,
    ButtonIcon,
    ButtonLabel,
    Dialog,
    Fluid,
    InputText,
    Message,
    PasswordDirective,
    Select,
    Skeleton,
    TabPanel,
    TabPanels,
    Tabs,
    Tag,
    Textarea,
    DatePipe,
    TitleCasePipe,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  private readonly workspaceApi = inject(Workspace);
  private readonly billingApi = inject(Billing);
  protected readonly auth = inject(Auth);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private static readonly VALID_TABS = ['general', 'billing', 'security', 'danger'];

  protected readonly activeTab = signal<string | number | undefined>(this.initialTab());

  private initialTab(): string {
    const requested = this.route.snapshot.queryParamMap.get('tab');
    return requested && Settings.VALID_TABS.includes(requested) ? requested : 'general';
  }
  protected readonly timezoneOptions = TIMEZONES.map((timezone) => ({
    label: timezone.replace(/_/g, ' '),
    value: timezone,
  }));

  // --- General ---
  protected readonly loadingWorkspace = signal(true);
  protected readonly workspaceError = signal('');
  protected readonly workspaceSuccess = signal(false);
  protected readonly savingWorkspace = signal(false);
  protected readonly workspaceUpdatedAt = signal<string | null>(null);
  protected readonly workspace = signal({ name: '', description: '', timezone: 'UTC' as Timezone });

  protected readonly workspaceForm = form(this.workspace, (path) => {
    validate(path.name, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Enter a workspace name' });
      if (value.length > NAME_MAX_LENGTH) {
        return maxLengthError(NAME_MAX_LENGTH, { message: `Keep it under ${NAME_MAX_LENGTH} characters` });
      }
      return undefined;
    });
    validate(path.description, (ctx) => {
      const value = ctx.value();
      if (value.length > DESCRIPTION_MAX_LENGTH) {
        return maxLengthError(DESCRIPTION_MAX_LENGTH, { message: `Keep it under ${DESCRIPTION_MAX_LENGTH} characters` });
      }
      return undefined;
    });
  });

  // --- Billing ---
  protected readonly loadingBilling = signal(true);
  protected readonly billingError = signal('');
  protected readonly billing = signal<BillingSummary | null>(null);
  protected readonly checkingOut = signal(false);
  protected readonly openingPortal = signal(false);

  protected readonly trialDaysLeft = computed(() => daysUntil(this.billing()?.trialEndsAt ?? null));
  protected readonly isTrialing = computed(() => this.billing()?.subscriptionStatus === 'trialing');
  protected readonly isPaidPro = computed(() => this.billing()?.plan === 'pro' && !this.isTrialing());

  // --- Security & sessions ---
  protected readonly loadingSessions = signal(true);
  protected readonly sessionsError = signal('');
  protected readonly sessions = signal<UserSession[]>([]);
  protected readonly revokingId = signal<string | null>(null);
  protected readonly revokingOthers = signal(false);

  protected readonly sessionRows = computed<SessionRow[]>(() =>
    this.sessions().map((session) => ({
      ...session,
      deviceLabel: deviceLabelOf(session),
      locationLabel: locationLabelOf(session),
    })),
  );

  protected readonly hasOtherSessions = computed(() => this.sessions().some((session) => !session.current));

  // --- Danger zone ---
  protected readonly deleteDialogVisible = signal(false);
  protected readonly deletePassword = signal('');
  protected readonly deleteError = signal('');
  protected readonly deleting = signal(false);

  constructor() {
    this.loadWorkspace();
    this.loadBilling();
    this.loadSessions();
  }

  private async loadWorkspace(): Promise<void> {
    this.loadingWorkspace.set(true);
    this.workspaceError.set('');
    try {
      const settings = await this.workspaceApi.get();
      this.workspace.set({ name: settings.name, description: settings.description, timezone: settings.timezone });
      this.workspaceUpdatedAt.set(settings.updatedAt);
    } catch (error) {
      this.workspaceError.set(error instanceof Error ? error.message : 'Could not load workspace settings.');
    } finally {
      this.loadingWorkspace.set(false);
    }
  }

  protected onTimezoneChange(value: Timezone | null): void {
    this.workspace.update((w) => ({ ...w, timezone: value ?? 'UTC' }));
  }

  protected async onWorkspaceSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.workspaceForm.name().markAsTouched();
    if (this.workspaceForm().invalid()) {
      return;
    }

    this.savingWorkspace.set(true);
    this.workspaceError.set('');
    this.workspaceSuccess.set(false);
    try {
      const updated = await this.workspaceApi.update(this.workspace());
      this.workspaceUpdatedAt.set(updated.updatedAt);
      this.workspaceSuccess.set(true);
      this.notifications.success('Workspace updated', 'Your changes have been saved.');
    } catch (error) {
      this.workspaceError.set(error instanceof Error ? error.message : 'Could not update workspace settings.');
    } finally {
      this.savingWorkspace.set(false);
    }
  }

  private async loadBilling(): Promise<void> {
    this.loadingBilling.set(true);
    this.billingError.set('');
    try {
      this.billing.set(await this.billingApi.get());
    } catch (error) {
      this.billingError.set(error instanceof Error ? error.message : 'Could not load billing details.');
    } finally {
      this.loadingBilling.set(false);
    }
  }

  protected async startCheckout(): Promise<void> {
    this.checkingOut.set(true);
    this.billingError.set('');
    try {
      await this.billingApi.startCheckout();
    } catch (error) {
      this.billingError.set(error instanceof Error ? error.message : 'Could not start checkout.');
      this.checkingOut.set(false);
    }
  }

  protected async openPortal(): Promise<void> {
    this.openingPortal.set(true);
    this.billingError.set('');
    try {
      await this.billingApi.openPortal();
    } catch (error) {
      this.billingError.set(error instanceof Error ? error.message : 'Could not open the billing portal.');
      this.openingPortal.set(false);
    }
  }

  private async loadSessions(): Promise<void> {
    this.loadingSessions.set(true);
    this.sessionsError.set('');
    try {
      this.sessions.set(await this.auth.listSessions());
    } catch (error) {
      this.sessionsError.set(error instanceof Error ? error.message : 'Could not load your sessions.');
    } finally {
      this.loadingSessions.set(false);
    }
  }

  protected async revokeSession(session: SessionRow): Promise<void> {
    this.revokingId.set(session.id);
    try {
      await this.auth.revokeSession(session.id);
      this.sessions.update((list) => list.filter((s) => s.id !== session.id));
      this.notifications.success('Signed out', `Signed out of ${session.deviceLabel}.`);
    } catch (error) {
      this.notifications.error('Could not sign out', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      this.revokingId.set(null);
    }
  }

  protected async revokeOtherSessions(): Promise<void> {
    this.revokingOthers.set(true);
    try {
      await this.auth.revokeOtherSessions();
      this.sessions.update((list) => list.filter((s) => s.current));
      this.notifications.success('Signed out', 'All other sessions have been signed out.');
    } catch (error) {
      this.notifications.error('Could not sign out', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      this.revokingOthers.set(false);
    }
  }

  protected openDeleteDialog(): void {
    this.deleteDialogVisible.set(true);
  }

  protected closeDeleteDialog(): void {
    this.deleteDialogVisible.set(false);
    this.deletePassword.set('');
    this.deleteError.set('');
    this.deleting.set(false);
  }

  protected async confirmDeleteAccount(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.deletePassword()) {
      this.deleteError.set('Enter your password to confirm.');
      return;
    }

    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await this.auth.deleteAccount(this.deletePassword());
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.deleteError.set(error instanceof Error ? error.message : 'Could not delete your account.');
      this.deleting.set(false);
    }
  }
}
