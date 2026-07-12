import { Injectable, PLATFORM_ID, REQUEST, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface UserSession {
  id: string;
  current: boolean;
  clientName: string | null;
  osName: string | null;
  deviceName: string | null;
  ip: string | null;
  countryName: string | null;
  createdAt: string;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => undefined);
  return (data && typeof data.message === 'string' && data.message) || fallback;
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly request = inject(REQUEST, { optional: true });

  private readonly user = signal<AuthUser | null>(null);

  readonly currentUser = this.user.asReadonly();
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => this.user()?.isAdmin ?? false);

  /** Resolves once the initial session check has completed. */
  readonly sessionReady: Promise<void>;

  constructor() {
    this.sessionReady = this.refreshUser();
  }

  async login(email: string, password: string): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        this.user.set(null);
        return false;
      }
      const data = await response.json();
      this.user.set({ id: data.id, name: data.name, email: data.email, isAdmin: !!data.isAdmin });
      return true;
    } catch {
      this.user.set(null);
      return false;
    }
  }

  async register(name: string, email: string, password: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    if (!response.ok) {
      this.user.set(null);
      throw new Error(await readError(response, 'Registration failed.'));
    }
    const data = await response.json();
    this.user.set({ id: data.id, name: data.name, email: data.email, isAdmin: !!data.isAdmin });
  }

  loginWithGoogle(): void {
    window.location.href = '/api/auth/google';
  }

  async updateName(name: string): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      this.user.set({ id: data.id, name: data.name, email: data.email, isAdmin: !!data.isAdmin });
      return true;
    } catch {
      return false;
    }
  }

  async updatePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async completeRecovery(userId: string, secret: string, password: string): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, secret, password }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      this.user.set(null);
    }
  }

  async listSessions(): Promise<UserSession[]> {
    const response = await fetch('/api/auth/sessions');
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not load your sessions.'));
    }
    const data = await response.json();
    return data.sessions as UserSession[];
  }

  async revokeSession(id: string): Promise<void> {
    const response = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not sign out that session.'));
    }
  }

  async revokeOtherSessions(): Promise<void> {
    const response = await fetch('/api/auth/sessions/other', { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not sign out your other sessions.'));
    }
  }

  async deleteAccount(password: string): Promise<void> {
    const response = await fetch('/api/auth/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      throw new Error(await readError(response, 'Could not delete your account.'));
    }
    this.user.set(null);
  }

  private async refreshUser(): Promise<void> {
    try {
      let url = '/api/auth/me';
      const headers: Record<string, string> = {};

      if (!isPlatformBrowser(this.platformId)) {
        if (!this.request) {
          this.user.set(null);
          return;
        }
        const cookie = this.request.headers.get('cookie');
        if (cookie) {
          headers['cookie'] = cookie;
        }
        url = new URL('/api/auth/me', this.request.url).toString();
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        this.user.set(null);
        return;
      }
      const data = await response.json();
      this.user.set({ id: data.id, name: data.name, email: data.email, isAdmin: !!data.isAdmin });
    } catch {
      this.user.set(null);
    }
  }
}
