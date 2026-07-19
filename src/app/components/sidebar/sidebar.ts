import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ButtonDirective, ButtonIcon } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { Auth } from '../../auth/auth';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'pi pi-home', route: '/dashboard' },
  { label: 'Projects', icon: 'pi pi-folder-open', route: '/projects' },
  { label: 'Team', icon: 'pi pi-users', route: '/team' },
  { label: 'Audit Log', icon: 'pi pi-history', route: '/audit-log', adminOnly: true },
  { label: 'Settings', icon: 'pi pi-cog', route: '/settings' },
];

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, ButtonDirective, ButtonIcon, Tooltip],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  private readonly auth = inject(Auth);

  readonly collapsed = input(false);
  readonly mobileOpen = input(false);
  readonly collapseToggle = output<void>();
  readonly close = output<void>();
  readonly linkActivated = output<void>();

  protected readonly navItems = computed(() => NAV_ITEMS.filter((item) => !item.adminOnly || this.auth.isAdmin()));
}
