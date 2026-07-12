/**
 * Minimal single-slot, per-process TTL cache for read-heavy, low-churn endpoints (e.g. the
 * workspace-wide user list and settings document). Not shared across instances if the app is
 * ever run with more than one Node process — a write on one instance won't invalidate another's
 * cached copy until its TTL expires, so keep the TTL short enough that staleness is a non-issue.
 */
export class TtlCache<T> {
  private entry: { value: T; expiresAt: number } | null = null;

  constructor(private readonly ttlMs: number) {}

  get(): T | undefined {
    if (!this.entry || Date.now() > this.entry.expiresAt) {
      return undefined;
    }
    return this.entry.value;
  }

  set(value: T): void {
    this.entry = { value, expiresAt: Date.now() + this.ttlMs };
  }

  clear(): void {
    this.entry = null;
  }
}
