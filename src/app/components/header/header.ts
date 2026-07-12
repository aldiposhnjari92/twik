import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonDirective, ButtonIcon } from 'primeng/button';
import { Avatar } from 'primeng/avatar';
import { Menu } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';
import { Auth } from '../../auth/auth';

@Component({
  selector: 'app-header',
  imports: [ButtonDirective, ButtonIcon, Avatar, Menu],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly title = input('Dashboard');
  readonly openNav = output<void>();

  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');

  protected readonly currentUser = this.auth.currentUser;

  protected readonly userInitials = computed(() => {
    const name = this.currentUser()?.name.trim();
    if (!name) {
      return '?';
    }
    const parts = name.split(/\s+/);
    const initials = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
    return initials.map((part) => part[0]?.toUpperCase()).join('');
  });

  protected readonly accountMenuItems: MenuItem[] = [
    { label: 'Profile', icon: 'pi pi-user', routerLink: '/profile' },
    { label: 'Log out', icon: 'pi pi-sign-out', command: () => this.logout() },
  ];

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  focusMenuButton(): void {
    this.menuButton()?.nativeElement.focus();
  }
}
