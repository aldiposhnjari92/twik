import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { AuditEvent, AuditLog } from '../../audit-log/audit-log';
import { EmptyState } from '../empty-state/empty-state';

const ACTION_LABELS: Record<string, string> = {
  'project.created': 'created a project',
  'project.updated': 'updated a project',
  'project.deleted': 'deleted a project',
  'member.invited': 'invited a teammate',
  'member.updated': 'updated a teammate',
  'member.removed': 'removed a teammate',
  'member.role_changed': "changed a teammate's role",
  'workspace.updated': 'updated workspace settings',
  'billing.subscription_started': 'started a Pro subscription',
  'billing.subscription_updated': 'updated the subscription',
  'billing.subscription_canceled': 'canceled the subscription',
  'billing.payment_failed': 'had a payment fail',
};

const ACTION_ICONS: Record<string, string> = {
  'project.created': 'pi pi-folder-open',
  'project.updated': 'pi pi-pencil',
  'project.deleted': 'pi pi-trash',
  'member.invited': 'pi pi-user-plus',
  'member.updated': 'pi pi-user-edit',
  'member.removed': 'pi pi-user-minus',
  'member.role_changed': 'pi pi-shield',
  'workspace.updated': 'pi pi-sliders-h',
  'billing.subscription_started': 'pi pi-credit-card',
  'billing.subscription_updated': 'pi pi-credit-card',
  'billing.subscription_canceled': 'pi pi-credit-card',
  'billing.payment_failed': 'pi pi-exclamation-triangle',
};

@Component({
  selector: 'app-audit-log',
  imports: [ButtonDirective, Message, Skeleton, EmptyState, DatePipe],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.css',
})
export class AuditLogPage {
  private readonly auditLogApi = inject(AuditLog);

  protected readonly events = signal<AuditEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly nextCursor = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const page = await this.auditLogApi.list();
      this.events.set(page.events);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not load the audit log.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor) return;

    this.loadingMore.set(true);
    try {
      const page = await this.auditLogApi.list(cursor);
      this.events.update((list) => [...list, ...page.events]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not load more events.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected labelFor(event: AuditEvent): string {
    const base = ACTION_LABELS[event.action] ?? event.action;
    return event.targetLabel ? `${base} "${event.targetLabel}"` : base;
  }

  protected iconFor(action: string): string {
    return ACTION_ICONS[action] ?? 'pi pi-circle';
  }
}
