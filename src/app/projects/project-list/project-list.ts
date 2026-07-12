import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FormField, form, maxLengthError, requiredError, validate } from '@angular/forms/signals';
import { ConfirmationService } from 'primeng/api';
import { ButtonDirective, ButtonIcon, ButtonLabel } from 'primeng/button';
import { DatePicker } from 'primeng/datepicker';
import { Dialog } from 'primeng/dialog';
import { Fluid } from 'primeng/fluid';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { Skeleton } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { Tag } from 'primeng/tag';
import { Textarea } from 'primeng/textarea';
import { EmptyState } from '../../components/empty-state/empty-state';
import { Notifications } from '../../notifications/notifications';
import { Auth } from '../../auth/auth';
import { Users, WorkspaceUser } from '../../users/users';
import { Project, Projects } from '../projects';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

interface ProjectRow extends Project {
  deadlineDate: Date | null;
  assigneeLabel: string;
}

function currentMonthDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Local calendar date (no UTC conversion), matching the "YYYY-MM-DD" shape the API expects. */
function toDateOnlyString(date: Date | null): string {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toMonthString(date: Date | null): string {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function emptyProject() {
  return {
    name: '',
    description: '',
    startDate: null as Date | null,
    deadline: null as Date | null,
    iteration: currentMonthDate() as Date | null,
    assigneeId: null as string | null,
  };
}

@Component({
  selector: 'app-project-list',
  imports: [
    RouterLink,
    FormsModule,
    FormField,
    ButtonDirective,
    ButtonIcon,
    ButtonLabel,
    DatePicker,
    Dialog,
    Fluid,
    IconField,
    InputIcon,
    InputText,
    Message,
    Select,
    Skeleton,
    TableModule,
    Tag,
    Textarea,
    EmptyState,
    DatePipe,
  ],
  templateUrl: './project-list.html',
  styleUrl: './project-list.css',
})
export class ProjectList {
  private readonly projectsApi = inject(Projects);
  private readonly usersApi = inject(Users);
  private readonly notifications = inject(Notifications);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly auth = inject(Auth);

  protected readonly projects = signal<Project[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly viewMode = signal<'table' | 'cards'>('table');
  protected readonly searchTerm = signal('');

  protected readonly rows = computed<ProjectRow[]>(() =>
    this.projects().map((project) => ({
      ...project,
      deadlineDate: project.deadline ? new Date(project.deadline) : null,
      assigneeLabel: project.assigneeName ?? 'Unassigned',
    })),
  );

  protected readonly filteredRows = computed<ProjectRow[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.rows();
    return this.rows().filter(
      (p) => p.name.toLowerCase().includes(term) || p.ownerName.toLowerCase().includes(term) || p.assigneeLabel.toLowerCase().includes(term),
    );
  });

  protected readonly statusFilterOptions = [
    { label: 'Active', value: 'active' },
    { label: 'Archived', value: 'archived' },
  ];

  // --- Create project dialog ---
  protected readonly dialogVisible = signal(false);
  protected readonly teammates = signal<WorkspaceUser[]>([]);
  protected readonly submitting = signal(false);
  protected readonly createError = signal('');

  protected readonly project = signal(emptyProject());

  protected readonly projectForm = form(this.project, (path) => {
    validate(path.name, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Enter a project name' });
      if (value.length > NAME_MAX_LENGTH) return maxLengthError(NAME_MAX_LENGTH, { message: `Keep it under ${NAME_MAX_LENGTH} characters` });
      return undefined;
    });
    validate(path.description, (ctx) => {
      const value = ctx.value();
      if (value.length > DESCRIPTION_MAX_LENGTH) {
        return maxLengthError(DESCRIPTION_MAX_LENGTH, { message: `Keep it under ${DESCRIPTION_MAX_LENGTH} characters` });
      }
      return undefined;
    });
    validate(path.startDate, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Select a start date' });
    });
    validate(path.deadline, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Select a deadline' });
      const start = ctx.valueOf(path.startDate);
      if (start && value.getTime() < start.getTime()) {
        return { kind: 'invalid-range', message: 'Deadline must be on or after the start date' };
      }
      return undefined;
    });
    validate(path.iteration, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Select an iteration' });
    });
  });

  protected readonly assigneeName = computed(() => {
    const id = this.project().assigneeId;
    return id ? (this.teammates().find((user) => user.id === id)?.name ?? null) : null;
  });

  constructor() {
    this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      this.projects.set(await this.projectsApi.list());
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not load projects.');
    } finally {
      this.loading.set(false);
    }
  }

  protected canEdit(project: Project): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    return user.isAdmin || user.id === project.ownerId || user.id === project.assigneeId;
  }

  protected canDelete(project: Project): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    return user.isAdmin || user.id === project.ownerId;
  }

  protected confirmDelete(project: Project): void {
    this.confirmationService.confirm({
      header: 'Delete project',
      message: `Delete "${project.name}"? This can't be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-outlined',
      accept: () => this.deleteProject(project),
    });
  }

  private async deleteProject(project: Project): Promise<void> {
    try {
      await this.projectsApi.remove(project.id);
      this.projects.update((list) => list.filter((p) => p.id !== project.id));
      this.notifications.success('Project deleted', `"${project.name}" was deleted.`);
    } catch (error) {
      this.notifications.error('Could not delete project', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  protected openCreateDialog(): void {
    this.dialogVisible.set(true);
    if (this.teammates().length === 0) {
      this.loadTeammates();
    }
  }

  protected closeCreateDialog(): void {
    this.dialogVisible.set(false);
    this.projectForm().reset(emptyProject());
    this.createError.set('');
  }

  private async loadTeammates(): Promise<void> {
    try {
      this.teammates.set(await this.usersApi.list());
    } catch {
      // Non-critical: the assignee picker just falls back to "Unassigned" only.
    }
  }

  protected onDescriptionInput(value: string): void {
    this.project.update((p) => ({ ...p, description: value }));
  }

  // PrimeNG's DatePicker/Select components redeclare a couple of BaseEditableHolder inputs (e.g.
  // `readonly`) as plain properties instead of signal inputs, which breaks structural compatibility
  // with Signal Forms' `FormUiControl` contract that `[formField]` checks against. Binding manually
  // via their standard ControlValueAccessor (through `[ngModel]`) sidesteps that mismatch while still
  // keeping the field's value, touched state, and validation driven by the Signal Form as usual.
  protected onStartDateChange(value: Date | null): void {
    this.project.update((p) => ({ ...p, startDate: value ?? null }));
  }

  protected onDeadlineChange(value: Date | null): void {
    this.project.update((p) => ({ ...p, deadline: value ?? null }));
  }

  protected onIterationChange(value: Date | null): void {
    this.project.update((p) => ({ ...p, iteration: value ?? null }));
  }

  protected onAssigneeChange(value: string | null): void {
    this.project.update((p) => ({ ...p, assigneeId: value ?? null }));
  }

  protected async onCreateSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.projectForm.name().markAsTouched();
    this.projectForm.startDate().markAsTouched();
    this.projectForm.deadline().markAsTouched();
    this.projectForm.iteration().markAsTouched();
    if (this.projectForm().invalid()) {
      return;
    }

    this.submitting.set(true);
    this.createError.set('');
    try {
      const current = this.project();
      const created = await this.projectsApi.create({
        name: current.name,
        description: current.description,
        startDate: toDateOnlyString(current.startDate),
        deadline: toDateOnlyString(current.deadline),
        iteration: toMonthString(current.iteration),
        assigneeId: current.assigneeId,
        assigneeName: this.assigneeName(),
      });
      this.projects.update((list) => [created, ...list]);
      this.notifications.success('Project created', `"${created.name}" is ready to go.`);
      this.closeCreateDialog();
    } catch (error) {
      this.createError.set(error instanceof Error ? error.message : 'Could not create the project.');
    } finally {
      this.submitting.set(false);
    }
  }
}
