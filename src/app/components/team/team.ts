import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormField, emailError, form, requiredError, validate } from '@angular/forms/signals';
import { ConfirmationService } from 'primeng/api';
import { Avatar } from 'primeng/avatar';
import { ButtonDirective, ButtonIcon, ButtonLabel } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Fluid } from 'primeng/fluid';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { Skeleton } from 'primeng/skeleton';
import { Tag } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { RouterLink } from '@angular/router';
import { Auth } from '../../auth/auth';
import { Notifications } from '../../notifications/notifications';
import { Project, Projects } from '../../projects/projects';
import { DEPARTMENTS, Department, Users, WorkspaceUser } from '../../users/users';
import { EmptyState } from '../empty-state/empty-state';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AVATAR_COLORS = ['bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-500', 'bg-rose-600', 'bg-cyan-600'];

interface MemberRow extends WorkspaceUser {
  initials: string;
  avatarColor: string;
  isYou: boolean;
  departmentLabel: string;
  projectCount: number;
}

interface MemberProjectRow extends Project {
  memberRole: 'Owner' | 'Assignee';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const chars = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return chars.map((part) => part[0]?.toUpperCase()).join('');
}

function colorOf(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Counts, per user, the projects where they're the owner or the assignee (deduped per project). */
function countProjectsPerUser(projects: Project[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const involved = new Set([project.ownerId, project.assigneeId].filter((id): id is string => !!id));
    for (const userId of involved) {
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }
  }
  return counts;
}

@Component({
  selector: 'app-team',
  imports: [
    RouterLink,
    FormsModule,
    FormField,
    Avatar,
    ButtonDirective,
    ButtonIcon,
    ButtonLabel,
    Dialog,
    Fluid,
    IconField,
    InputIcon,
    InputText,
    Message,
    Select,
    Skeleton,
    Tag,
    TableModule,
    EmptyState,
    DatePipe,
  ],
  templateUrl: './team.html',
  styleUrl: './team.css',
})
export class Team {
  private readonly usersApi = inject(Users);
  private readonly projectsApi = inject(Projects);
  private readonly notifications = inject(Notifications);
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);
  private readonly confirmationService = inject(ConfirmationService);

  protected readonly departmentOptions = DEPARTMENTS.map((department) => ({ label: department, value: department }));

  protected readonly isAdmin = this.auth.isAdmin;
  protected readonly members = signal<WorkspaceUser[]>([]);
  protected readonly projects = signal<Project[]>([]);
  protected readonly projectCounts = signal<Map<string, number>>(new Map());
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly pageFirst = signal(0);
  protected readonly roleUpdatingId = signal<string | null>(null);
  protected readonly viewMode = signal<'table' | 'cards'>('table');
  protected readonly searchTerm = signal('');

  protected readonly rows = computed<MemberRow[]>(() => {
    const currentEmail = this.auth.currentUser()?.email;
    const counts = this.projectCounts();
    return this.members()
      .map((member) => ({
        ...member,
        initials: initialsOf(member.name),
        avatarColor: colorOf(member.id),
        isYou: member.email === currentEmail,
        departmentLabel: member.department ?? 'Unassigned',
        projectCount: counts.get(member.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly filteredRows = computed<MemberRow[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.rows();
    return this.rows().filter(
      (m) => m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term) || m.departmentLabel.toLowerCase().includes(term),
    );
  });

  constructor() {
    this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const [members, projects] = await Promise.all([this.usersApi.list(), this.projectsApi.list()]);
      this.members.set(members);
      this.projects.set(projects);
      this.projectCounts.set(countProjectsPerUser(projects));
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not load teammates.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Reassigning a value re-binds the table's `[value]` array, which resets p-table to page 1 while a
   * filter is active (it emits `firstChange(0)`, which our binding below would otherwise accept).
   * Re-assert the admin's actual page once that reset render has gone through.
   */
  private applyMemberUpdate(id: string, patch: Partial<WorkspaceUser>): void {
    const currentPage = this.pageFirst();
    this.members.update((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    afterNextRender(() => this.pageFirst.set(currentPage), { injector: this.injector });
  }

  private applyMemberRemoval(id: string): void {
    const currentPage = this.pageFirst();
    this.members.update((list) => list.filter((m) => m.id !== id));
    afterNextRender(() => this.pageFirst.set(currentPage), { injector: this.injector });
  }

  protected async onDepartmentChange(member: MemberRow, department: Department): Promise<void> {
    const previous = member.department;
    this.applyMemberUpdate(member.id, { department });
    try {
      await this.usersApi.updateDepartment(member.id, department);
    } catch (error) {
      this.applyMemberUpdate(member.id, { department: previous });
      this.notifications.error(
        'Could not update department',
        error instanceof Error ? error.message : 'Please try again.',
      );
    }
  }

  protected async toggleAdmin(member: MemberRow): Promise<void> {
    const next = !member.isAdmin;
    this.roleUpdatingId.set(member.id);
    this.applyMemberUpdate(member.id, { isAdmin: next });
    try {
      await this.usersApi.setAdmin(member.id, next);
      this.notifications.success(
        next ? 'Promoted to admin' : 'Admin access removed',
        `${member.name} is ${next ? 'now' : 'no longer'} a workspace admin.`,
      );
    } catch (error) {
      this.applyMemberUpdate(member.id, { isAdmin: !next });
      this.notifications.error("Could not update role", error instanceof Error ? error.message : 'Please try again.');
    } finally {
      this.roleUpdatingId.set(null);
    }
  }

  // --- Invite dialog ---
  protected readonly dialogVisible = signal(false);
  protected readonly invitee = signal({ name: '', email: '', department: '' as Department | '' });
  protected readonly submitting = signal(false);
  protected readonly inviteError = signal('');

  protected readonly inviteForm = form(this.invitee, (path) => {
    validate(path.name, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Enter a name' });
    });
    validate(path.email, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Enter an email address' });
      if (!EMAIL_PATTERN.test(value)) return emailError({ message: 'Enter a valid email address' });
      return undefined;
    });
    validate(path.department, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Choose a department' });
    });
  });

  protected openInviteDialog(): void {
    this.dialogVisible.set(true);
  }

  protected onInviteeDepartmentChange(value: Department | null): void {
    this.invitee.update((v) => ({ ...v, department: value ?? '' }));
  }

  protected closeInviteDialog(): void {
    this.dialogVisible.set(false);
    this.inviteForm().reset({ name: '', email: '', department: '' });
    this.inviteError.set('');
  }

  protected async onInviteSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.inviteForm.name().markAsTouched();
    this.inviteForm.email().markAsTouched();
    this.inviteForm.department().markAsTouched();
    if (this.inviteForm().invalid()) {
      return;
    }

    this.submitting.set(true);
    this.inviteError.set('');
    try {
      const current = this.invitee();
      const created = await this.usersApi.invite({ ...current, department: current.department as Department });
      this.members.update((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
      this.notifications.success('Invitation sent', `${created.name} will receive an email to set up their account.`);
      this.closeInviteDialog();
    } catch (error) {
      this.inviteError.set(error instanceof Error ? error.message : 'Could not invite teammate.');
    } finally {
      this.submitting.set(false);
    }
  }

  // --- View details dialog ---
  protected readonly detailsMember = signal<MemberRow | null>(null);

  protected readonly detailsProjects = computed<MemberProjectRow[]>(() => {
    const member = this.detailsMember();
    if (!member) return [];
    return this.projects()
      .filter((p) => p.ownerId === member.id || p.assigneeId === member.id)
      .map((p) => ({ ...p, memberRole: p.ownerId === member.id ? 'Owner' : 'Assignee' }));
  });

  protected openDetails(member: MemberRow): void {
    this.detailsMember.set(member);
  }

  protected closeDetails(): void {
    this.detailsMember.set(null);
  }

  // --- Edit dialog ---
  protected readonly editDialogVisible = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editTarget = signal({ name: '', email: '' });
  protected readonly editSubmitting = signal(false);
  protected readonly editError = signal('');

  protected readonly editForm = form(this.editTarget, (path) => {
    validate(path.name, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Enter a name' });
    });
    validate(path.email, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Enter an email address' });
      if (!EMAIL_PATTERN.test(value)) return emailError({ message: 'Enter a valid email address' });
      return undefined;
    });
  });

  protected openEditDialog(member: MemberRow): void {
    this.editingId.set(member.id);
    this.editForm().reset({ name: member.name, email: member.email });
    this.editError.set('');
    this.editDialogVisible.set(true);
  }

  protected closeEditDialog(): void {
    this.editDialogVisible.set(false);
    this.editingId.set(null);
    this.editError.set('');
  }

  protected async onEditSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.editForm.name().markAsTouched();
    this.editForm.email().markAsTouched();
    if (this.editForm().invalid()) {
      return;
    }

    const id = this.editingId();
    if (!id) return;

    this.editSubmitting.set(true);
    this.editError.set('');
    try {
      const { name, email } = this.editTarget();
      await this.usersApi.update(id, { name, email });
      this.applyMemberUpdate(id, { name, email });
      this.notifications.success('Teammate updated', `${name}'s details were saved.`);
      this.closeEditDialog();
    } catch (error) {
      this.editError.set(error instanceof Error ? error.message : 'Could not update that teammate.');
    } finally {
      this.editSubmitting.set(false);
    }
  }

  // --- Remove teammate ---
  protected confirmRemove(member: MemberRow): void {
    this.confirmationService.confirm({
      header: 'Remove teammate',
      message: `Remove "${member.name}" from the workspace? This can't be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-outlined',
      accept: () => this.removeMember(member),
    });
  }

  private async removeMember(member: MemberRow): Promise<void> {
    try {
      await this.usersApi.remove(member.id);
      this.applyMemberRemoval(member.id);
      this.notifications.success('Teammate removed', `"${member.name}" was removed from the workspace.`);
    } catch (error) {
      this.notifications.error(
        'Could not remove teammate',
        error instanceof Error ? error.message : 'Please try again.',
      );
    }
  }
}
