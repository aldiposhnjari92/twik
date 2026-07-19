import { Component, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { filter, map } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { hydrateUiState } from '../../state/ui/ui.actions';
import { readPersistedUiState } from '../../state/ui/ui.persistence';
import { Sidebar } from '../sidebar/sidebar';
import { Header } from '../header/header';
import { Breadcrumb } from '../breadcrumb/breadcrumb';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, Sidebar, Header, Breadcrumb, ConfirmDialog],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  providers: [ConfirmationService],
  host: {
    '(document:keydown.escape)': 'closeMobileNav()',
  },
})
export class Shell {
  private readonly router = inject(Router);
  private readonly store = inject(Store);

  private readonly header = viewChild(Header);

  protected readonly sidebarCollapsed = signal(false);
  protected readonly mobileNavOpen = signal(false);

  constructor() {
    // Runs once, client-only, after the first render — applying a persisted view mode any
    // earlier than this would make the server and the client disagree on what to render,
    // which breaks hydration (see ui.model.ts for why).
    afterNextRender(() => {
      const persisted = readPersistedUiState();
      if (persisted) {
        this.store.dispatch(hydrateUiState({ state: persisted }));
      }
    });
  }

  protected readonly pageTitle = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.resolveTitle()),
    ),
    { initialValue: this.resolveTitle() },
  );

  protected toggleSidebarCollapse(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  protected openMobileNav(): void {
    this.mobileNavOpen.set(true);
  }

  protected closeMobileNav(): void {
    if (!this.mobileNavOpen()) {
      return;
    }
    this.mobileNavOpen.set(false);
    this.header()?.focusMenuButton();
  }

  /** Closes the mobile drawer after a nav link click without stealing focus back to the toggle button. */
  protected closeMobileNavAfterNavigation(): void {
    this.mobileNavOpen.set(false);
  }

  private resolveTitle(): string {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route.title ?? 'Twik';
  }
}
