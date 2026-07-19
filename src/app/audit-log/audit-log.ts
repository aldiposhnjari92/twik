import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface AuditEvent {
  id: string;
  actorName: string;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogPage {
  events: AuditEvent[];
  nextCursor: string | null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => undefined);
  return (data && typeof data.message === 'string' && data.message) || fallback;
}

@Injectable({ providedIn: 'root' })
export class AuditLog {
  private readonly platformId = inject(PLATFORM_ID);

  async list(cursor?: string): Promise<AuditLogPage> {
    if (!isPlatformBrowser(this.platformId)) {
      return { events: [], nextCursor: null };
    }
    const url = cursor ? `/api/audit-log?cursor=${encodeURIComponent(cursor)}` : '/api/audit-log';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not load the audit log.'));
    }
    return response.json();
  }
}
