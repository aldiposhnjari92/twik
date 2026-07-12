import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const DEPARTMENTS = [
  'Engineering',
  'Design',
  'Product',
  'Marketing',
  'Sales',
  'Operations',
  'Finance',
  'Support',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  department: Department | null;
  isAdmin: boolean;
}

export interface InviteInput {
  name: string;
  email: string;
  department: Department;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => undefined);
  return (data && typeof data.message === 'string' && data.message) || fallback;
}

@Injectable({ providedIn: 'root' })
export class Users {
  private readonly platformId = inject(PLATFORM_ID);

  async list(): Promise<WorkspaceUser[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    const response = await fetch('/api/users');
    if (!response.ok) {
      throw new Error('Could not load teammates.');
    }
    const data = await response.json();
    return data.users as WorkspaceUser[];
  }

  async invite(input: InviteInput): Promise<WorkspaceUser> {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not invite teammate.'));
    }
    return response.json();
  }

  async updateDepartment(id: string, department: Department): Promise<void> {
    const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department }),
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not update department.'));
    }
  }

  async setAdmin(id: string, isAdmin: boolean): Promise<void> {
    const response = await fetch(`/api/users/${encodeURIComponent(id)}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin }),
    });
    if (!response.ok) {
      throw new Error(await readError(response, "Could not update that teammate's role."));
    }
  }
}
