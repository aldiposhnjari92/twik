import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import compression from 'compression';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { join } from 'node:path';
import { registerAuthRoutes } from './server/auth-routes';
import { registerProjectRoutes } from './server/project-routes';
import { registerUsersRoutes } from './server/users-routes';
import { registerWorkspaceRoutes } from './server/workspace-routes';

try {
  process.loadEnvFile();
} catch {
  // No .env file present; environment variables are expected to be set another way.
}

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// This app runs behind a reverse proxy/PaaS that terminates TLS, so trust the first hop's
// X-Forwarded-* headers. Without this, req.protocol always reports "http" (silently disabling the
// Secure cookie flag) and the rate limiters key off the proxy's IP instead of the real client's.
app.set('trust proxy', 1);

// The Angular/PrimeNG bundle relies on runtime-injected inline <style> tags (PrimeNG's theme
// engine) with no nonce wiring yet, so a default CSP would break styling. The other headers
// (frameguard, no-sniff, HSTS, etc.) are safe to enable as-is.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Sensitive auth endpoints (credential checks, account creation/deletion) get a tighter limit
// than general API traffic to blunt brute-force and credential-stuffing attempts. Registered
// after apiLimiter so its (stricter) rate-limit headers are the ones exposed on these paths.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a while and try again.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/password', authLimiter);
app.use('/api/auth/recovery', authLimiter);
app.use('/api/auth/account', authLimiter);

registerAuthRoutes(app);
registerProjectRoutes(app);
registerUsersRoutes(app);
registerWorkspaceRoutes(app);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud
 * Functions. Also exported as default since that's the convention platforms like Vercel look for
 * to detect the SSR entry point.
 */
export const reqHandler = createNodeRequestHandler(app);
export default reqHandler;
