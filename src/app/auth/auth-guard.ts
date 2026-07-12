import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const authGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const auth = inject(Auth);

  await auth.sessionReady;
  return auth.isAuthenticated() ? true : router.parseUrl('/login');
};
