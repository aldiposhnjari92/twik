import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { Auth } from './auth';

/**
 * Lets the public marketing page match at '/' only for signed-out visitors. Returning `false` (not
 * a redirect) makes the router fall through to try the next sibling route at the same path — the
 * authenticated Shell — whose own existing empty-child redirect sends signed-in users to /dashboard.
 */
export const guestGuard: CanMatchFn = async () => {
  const auth = inject(Auth);

  await auth.sessionReady;
  return !auth.isAuthenticated();
};
