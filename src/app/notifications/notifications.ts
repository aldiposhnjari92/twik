import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

export const NETWORK_TOAST_KEY = 'network';

const DEFAULT_LIFE_MS = 4000;
const ERROR_LIFE_MS = 6000;

/**
 * Thin, friendly wrapper around PrimeNG's `MessageService` so features don't need to know
 * severity strings or toast plumbing to surface a message to the user.
 */
@Injectable({ providedIn: 'root' })
export class Notifications {
  private readonly messageService = inject(MessageService);

  success(summary: string, detail?: string): void {
    this.messageService.add({ severity: 'success', summary, detail, life: DEFAULT_LIFE_MS });
  }

  info(summary: string, detail?: string): void {
    this.messageService.add({ severity: 'info', summary, detail, life: DEFAULT_LIFE_MS });
  }

  warning(summary: string, detail?: string): void {
    this.messageService.add({ severity: 'warn', summary, detail, life: ERROR_LIFE_MS });
  }

  error(summary: string, detail?: string): void {
    this.messageService.add({ severity: 'error', summary, detail, life: ERROR_LIFE_MS });
  }

  /** Shows a connectivity message in the dedicated network toast outlet, staying until `clearNetworkStatus()` is called. */
  showOffline(): void {
    this.messageService.add({
      key: NETWORK_TOAST_KEY,
      severity: 'warn',
      summary: "You're offline",
      detail: 'Check your internet connection. Some features may not work.',
      sticky: true,
      closable: false,
    });
  }

  showBackOnline(): void {
    this.clearNetworkStatus();
    // PrimeNG's toast clear animates out before removing the message; adding the replacement in the
    // same tick can race with it, so defer briefly to let the clear settle first.
    setTimeout(() => {
      this.messageService.add({
        key: NETWORK_TOAST_KEY,
        severity: 'success',
        summary: 'Back online',
        detail: 'Your internet connection has been restored.',
        life: DEFAULT_LIFE_MS,
      });
    });
  }

  clearNetworkStatus(): void {
    this.messageService.clear(NETWORK_TOAST_KEY);
  }
}
