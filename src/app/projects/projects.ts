import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  ownerId: string;
  ownerName: string;
  startDate: string | null;
  deadline: string | null;
  iteration: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  name: string;
  description: string;
  startDate: string;
  deadline: string;
  iteration: string;
  assigneeId: string | null;
  assigneeName: string | null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => undefined);
  return (data && typeof data.message === 'string' && data.message) || fallback;
}

@Injectable({ providedIn: 'root' })
export class Projects {
  private readonly platformId = inject(PLATFORM_ID);

  async list(search = ''): Promise<Project[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    const url = search ? `/api/projects?search=${encodeURIComponent(search)}` : '/api/projects';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not load projects.'));
    }
    const data = await response.json();
    return data.projects as Project[];
  }

  async get(id: string): Promise<Project> {
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(await readError(response, 'Project not found.'));
    }
    return response.json();
  }

  async create(input: ProjectInput): Promise<Project> {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not create the project.'));
    }
    return response.json();
  }

  async update(id: string, input: Partial<ProjectInput> & { status?: ProjectStatus }): Promise<Project> {
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not update the project.'));
    }
    return response.json();
  }

  async remove(id: string): Promise<void> {
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not delete the project.'));
    }
  }
}
