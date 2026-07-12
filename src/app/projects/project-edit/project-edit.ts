import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FormField, form, maxLengthError, requiredError, validate } from '@angular/forms/signals';
import { ButtonDirective } from 'primeng/button';
import { DatePicker } from 'primeng/datepicker';
import { Fluid } from 'primeng/fluid';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { Textarea } from 'primeng/textarea';
import { Notifications } from '../../notifications/notifications';
import { Users, WorkspaceUser } from '../../users/users';
import { ProjectStatus, Projects } from '../projects';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

/** Local calendar date (no UTC conversion), matching the "YYYY-MM-DD" shape the API expects. */
function toDateOnlyString(date: Date | null): string {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toMonthString(date: Date | null): string {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Parses an ISO date string into a local calendar Date, avoiding the UTC-shift `new Date(iso)` would apply. */
function fromDateOnlyString(iso: string | null): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function fromMonthString(value: string | null): Date | null {
  if (!value) return null;
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

@Component({
  selector: 'app-project-edit',
  imports: [RouterLink, FormsModule, FormField, ButtonDirective, Fluid, InputText, Message, DatePicker, Select, SelectButton, Textarea],
  templateUrl: './project-edit.html',
  styleUrl: './project-edit.css',
})
export class ProjectEdit {
  private readonly projectsApi = inject(Projects);
  private readonly usersApi = inject(Users);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  private readonly projectId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly statusOptions = [
    { label: 'Active', value: 'active' as ProjectStatus },
    { label: 'Archived', value: 'archived' as ProjectStatus },
  ];

  protected readonly project = signal({
    name: '',
    description: '',
    startDate: null as Date | null,
    deadline: null as Date | null,
    iteration: null as Date | null,
    assigneeId: null as string | null,
    status: 'active' as ProjectStatus,
  });

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

  protected readonly teammates = signal<WorkspaceUser[]>([]);
  private initialAssigneeName: string | null = null;
  protected readonly assigneeName = computed(() => {
    const id = this.project().assigneeId;
    if (!id) return null;
    return this.teammates().find((user) => user.id === id)?.name ?? this.initialAssigneeName;
  });

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

  constructor() {
    this.load();
  }

  // Load the project and the teammate list together, and apply both to state in the same pass:
  // a dynamically-populated <select>-based control can only show a match for an option that
  // already exists, so data used to pre-select something must all land in one update.
  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const [found, teammates] = await Promise.all([this.projectsApi.get(this.projectId), this.usersApi.list().catch(() => [])]);
      this.teammates.set(teammates);
      this.project.set({
        name: found.name,
        description: found.description,
        startDate: fromDateOnlyString(found.startDate),
        deadline: fromDateOnlyString(found.deadline),
        iteration: fromMonthString(found.iteration),
        assigneeId: found.assigneeId,
        status: found.status,
      });
      this.initialAssigneeName = found.assigneeName;
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Project not found.');
    } finally {
      this.loading.set(false);
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

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.projectForm.name().markAsTouched();
    this.projectForm.startDate().markAsTouched();
    this.projectForm.deadline().markAsTouched();
    this.projectForm.iteration().markAsTouched();
    if (this.projectForm().invalid()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');
    try {
      const current = this.project();
      const updated = await this.projectsApi.update(this.projectId, {
        name: current.name,
        description: current.description,
        startDate: toDateOnlyString(current.startDate),
        deadline: toDateOnlyString(current.deadline),
        iteration: toMonthString(current.iteration),
        assigneeId: current.assigneeId,
        assigneeName: this.assigneeName(),
        status: current.status,
      });
      this.notifications.success('Project updated', `"${updated.name}" was saved.`);
      await this.router.navigateByUrl('/projects');
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not update the project.');
    } finally {
      this.submitting.set(false);
    }
  }
}
