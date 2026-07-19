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

/**
 * Same per-process TTL semantics as {@link TtlCache}, but keyed (e.g. by workspace/team ID) so one
 * tenant's cached data can never leak into another's response. Still not shared across instances.
 */
export class KeyedTtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(key: string): void {
    this.entries.delete(key);
  }
}
