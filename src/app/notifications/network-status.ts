import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Notifications } from './notifications';

/** Watches browser connectivity and surfaces an offline/back-online toast. Instantiate once, app-wide. */
@Injectable({ providedIn: 'root' })
export class NetworkStatus {
  private readonly notifications = inject(Notifications);
  private readonly platformId = inject(PLATFORM_ID);

  private wasOffline = false;

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (!navigator.onLine) {
      this.handleOffline();
    }

    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  private handleOffline(): void {
    this.wasOffline = true;
    this.notifications.showOffline();
  }

  private handleOnline(): void {
    if (this.wasOffline) {
      this.notifications.showBackOnline();
      this.wasOffline = false;
    } else {
      this.notifications.clearNetworkStatus();
    }
  }
}
