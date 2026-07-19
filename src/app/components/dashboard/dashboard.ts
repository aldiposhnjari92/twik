import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { Auth } from '../../auth/auth';
import { Project, Projects } from '../../projects/projects';
import { Users, WorkspaceUser } from '../../users/users';

const RECENT_WINDOW_DAYS = 30;
const TREND_MONTHS = 6;
const UPCOMING_LIMIT = 5;
const WORKLOAD_LIMIT = 6;

interface StatusSlice {
  label: string;
  count: number;
  pct: number;
  barClass: string;
  dotClass: string;
}

interface TrendBucket {
  label: string;
  count: number;
}

interface WorkloadRow {
  name: string;
  count: number;
  pct: number;
}

type Urgency = 'critical' | 'warning' | 'normal';

interface DeadlineRow {
  id: string;
  name: string;
  assigneeLabel: string;
  deadline: Date;
  daysRemaining: number;
  urgency: Urgency;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short' });
}

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, Message, Skeleton],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly projectsApi = inject(Projects);
  private readonly usersApi = inject(Users);
  protected readonly auth = inject(Auth);

  /** Fixed once per component instance (not re-evaluated per render) to avoid SSR/CSR drift. */
  private readonly today = startOfDay(new Date());

  protected readonly projects = signal<Project[]>([]);
  protected readonly members = signal<WorkspaceUser[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');

  protected readonly totalProjects = computed(() => this.projects().length);
  protected readonly activeProjects = computed(() => this.projects().filter((p) => p.status === 'active'));
  protected readonly archivedProjects = computed(() => this.projects().filter((p) => p.status === 'archived'));

  protected readonly overdueProjects = computed(() =>
    this.activeProjects().filter((p) => p.deadline && new Date(p.deadline) < this.today),
  );

  protected readonly recentProjectsCount = computed(
    () => this.projects().filter((p) => daysBetween(new Date(p.createdAt), this.today) <= RECENT_WINDOW_DAYS).length,
  );

  protected readonly recentMembersCount = computed(
    () => this.members().filter((m) => daysBetween(new Date(m.createdAt), this.today) <= RECENT_WINDOW_DAYS).length,
  );

  protected readonly statusBreakdown = computed<StatusSlice[]>(() => {
    const total = this.totalProjects();
    if (total === 0) return [];
    const active = this.activeProjects().length;
    const archived = this.archivedProjects().length;
    return [
      { label: 'Active', count: active, pct: Math.round((active / total) * 100), barClass: 'bg-emerald-500', dotClass: 'bg-emerald-500' },
      { label: 'Archived', count: archived, pct: Math.round((archived / total) * 100), barClass: 'bg-slate-300', dotClass: 'bg-slate-400' },
    ];
  });

  protected readonly monthlyTrend = computed<TrendBucket[]>(() => {
    const buckets = new Map<string, TrendBucket>();
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const d = new Date(this.today.getFullYear(), this.today.getMonth() - i, 1);
      buckets.set(monthKey(d), { label: monthLabel(d), count: 0 });
    }
    for (const project of this.projects()) {
      const bucket = buckets.get(monthKey(new Date(project.createdAt)));
      if (bucket) bucket.count++;
    }
    return Array.from(buckets.values());
  });

  protected readonly monthlyTrendSummary = computed(() =>
    this.monthlyTrend()
      .map((b) => `${b.label} ${b.count}`)
      .join(', '),
  );

  protected readonly trendMax = computed(() => Math.max(1, ...this.monthlyTrend().map((b) => b.count)));

  protected readonly workload = computed<WorkloadRow[]>(() => {
    const counts = new Map<string, number>();
    for (const project of this.activeProjects()) {
      const name = project.assigneeName ?? 'Unassigned';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, pct: Math.round((count / max) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, WORKLOAD_LIMIT);
  });

  protected readonly upcomingDeadlines = computed<DeadlineRow[]>(() =>
    this.activeProjects()
      .filter((p) => p.deadline)
      .map((p) => {
        const deadline = new Date(p.deadline!);
        const daysRemaining = daysBetween(this.today, deadline);
        const urgency: Urgency = daysRemaining < 0 ? 'critical' : daysRemaining <= 7 ? 'warning' : 'normal';
        return { id: p.id, name: p.name, assigneeLabel: p.assigneeName ?? 'Unassigned', deadline, daysRemaining, urgency };
      })
      .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
      .slice(0, UPCOMING_LIMIT),
  );

  constructor() {
    this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const [projects, members] = await Promise.all([this.projectsApi.list(), this.usersApi.list()]);
      this.projects.set(projects);
      this.members.set(members);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not load dashboard data.');
    } finally {
      this.loading.set(false);
    }
  }
}
