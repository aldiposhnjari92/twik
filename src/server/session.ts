import type { Request } from 'express';
import { AppwriteException } from 'node-appwrite';

export const SESSION_COOKIE = 'twik_session';

export function originOf(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

export function readSessionSecret(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return undefined;
}

export function errorStatus(error: unknown): number {
  return error instanceof AppwriteException && error.code ? error.code : 500;
}
