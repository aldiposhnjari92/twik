import { Component, inject } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

interface Crumb {
  label: string;
  url: string;
}

const HOME: Crumb = { label: 'Home', url: '/dashboard' };

@Component({
  selector: 'app-breadcrumb',
  imports: [RouterLink],
  templateUrl: './breadcrumb.html',
  styleUrl: './breadcrumb.css',
})
export class Breadcrumb {
  private readonly router = inject(Router);

  protected readonly crumbs = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.buildCrumbs()),
    ),
    { initialValue: this.buildCrumbs() },
  );

  private buildCrumbs(): Crumb[] {
    const trail: Crumb[] = [];
    let node: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    let path = '';

    while (node) {
      const segment = node.url.map((s) => s.path).join('/');
      if (segment) {
        path += `/${segment}`;
      }
      if (node.title) {
        const last = trail[trail.length - 1];
        if (last && last.url === path) {
          last.label = node.title;
        } else {
          trail.push({ label: node.title, url: path });
        }
      }
      node = node.firstChild;
    }

    if (trail.length === 0) {
      return [HOME];
    }
    if (trail[0].url === HOME.url) {
      trail[0] = { ...trail[0], label: HOME.label };
      return trail;
    }
    return [HOME, ...trail];
  }
}
