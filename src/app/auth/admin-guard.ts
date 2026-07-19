import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const adminGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const auth = inject(Auth);

  await auth.sessionReady;
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  return auth.isAdmin() ? true : router.parseUrl('/dashboard');
};
