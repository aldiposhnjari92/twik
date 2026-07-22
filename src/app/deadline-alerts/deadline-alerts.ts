import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth } from '../auth/auth';
import { Projects } from '../projects/projects';

const NEAR_DEADLINE_WINDOW_DAYS = 7;
const ALERT_LIMIT = 10;

export type AlertUrgency = 'critical' | 'warning';

export interface DeadlineAlert {
  id: string;
  name: string;
  daysRemaining: number;
  urgency: AlertUrgency;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/**
 * Role-based deadline alerts for the header notification bell: admins see every overdue/near-deadline
 * active project workspace-wide, regular members only see ones where they're the owner or assignee —
 * mirrors the existing owner/assignee/admin visibility split already used for edit/delete permissions
 * in project-list.ts, applied here to "who should be alerted" instead of "who can act."
 */
@Injectable({ providedIn: 'root' })
export class DeadlineAlerts {
  private readonly projectsApi = inject(Projects);
  private readonly auth = inject(Auth);

  private readonly today = startOfDay(new Date());

  readonly loading = signal(true);
  readonly alerts = signal<DeadlineAlert[]>([]);

  readonly overdueCount = computed(() => this.alerts().filter((a) => a.urgency === 'critical').length);
  readonly totalCount = computed(() => this.alerts().length);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const projects = await this.projectsApi.list();
      const user = this.auth.currentUser();
      const isAdmin = this.auth.isAdmin();

      const relevant = projects.filter((p) => {
        if (p.status !== 'active' || !p.deadline) return false;
        if (isAdmin) return true;
        return !!user && (p.ownerId === user.id || p.assigneeId === user.id);
      });

      this.alerts.set(
        relevant
          .map((p) => ({
            id: p.id,
            name: p.name,
            daysRemaining: daysBetween(this.today, new Date(p.deadline!)),
          }))
          .filter((a) => a.daysRemaining <= NEAR_DEADLINE_WINDOW_DAYS)
          .map((a) => ({ ...a, urgency: (a.daysRemaining < 0 ? 'critical' : 'warning') as AlertUrgency }))
          .sort((a, b) => a.daysRemaining - b.daysRemaining)
          .slice(0, ALERT_LIMIT),
      );
    } catch {
      // Non-critical: the bell just shows no alerts if this fails.
      this.alerts.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
