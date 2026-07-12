import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export type Timezone = (typeof TIMEZONES)[number];

export interface WorkspaceSettings {
  name: string;
  description: string;
  timezone: Timezone;
  updatedAt: string;
}

export interface WorkspaceInput {
  name?: string;
  description?: string;
  timezone?: Timezone;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => undefined);
  return (data && typeof data.message === 'string' && data.message) || fallback;
}

@Injectable({ providedIn: 'root' })
export class Workspace {
  private readonly platformId = inject(PLATFORM_ID);

  async get(): Promise<WorkspaceSettings> {
    if (!isPlatformBrowser(this.platformId)) {
      return { name: '', description: '', timezone: 'UTC', updatedAt: '' };
    }
    const response = await fetch('/api/workspace');
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not load workspace settings.'));
    }
    return response.json();
  }

  async update(input: WorkspaceInput): Promise<WorkspaceSettings> {
    const response = await fetch('/api/workspace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not update workspace settings.'));
    }
    return response.json();
  }
}
