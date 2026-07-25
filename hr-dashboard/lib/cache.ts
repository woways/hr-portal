/**
 * Lightweight two-tier cache: in-memory (per tab session) + sessionStorage.
 *
 *  - readCache<T>(key)        → cached value or null (in-memory first, falls back to sessionStorage)
 *  - writeCache(key, value)   → writes to both tiers
 *  - invalidate(prefix?)      → clears a single key or every key starting with a prefix
 *  - swr<T>(key, fetcher, on) → SWR-style read: returns cached synchronously (via `on(cached)`)
 *                               and re-fetches in the background, calling `on(fresh)` when done.
 *
 * The store is keyed by a string. Callers pick keys that carry enough context to be safe
 * across users (e.g. include the empId), and call invalidate() after mutations.
 */

const MEM = new Map<string, { v: unknown; t: number }>();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface Wrapper<T> { v: T; t: number }

export function readCache<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const now = Date.now();
  const hot = MEM.get(key);
  if (hot && now - hot.t < ttlMs) return hot.v as T;
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Wrapper<T>;
    if (now - parsed.t >= ttlMs) return null;
    MEM.set(key, { v: parsed.v, t: parsed.t });
    return parsed.v;
  } catch { return null; }
}

export function writeCache<T>(key: string, value: T): void {
  const t = Date.now();
  MEM.set(key, { v: value, t });
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(key, JSON.stringify({ v: value, t })); }
  catch { /* quota / disabled — memory tier still works */ }
}

export function invalidate(keyOrPrefix: string): void {
  // Delete matching in-memory entries
  for (const k of MEM.keys()) {
    if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) MEM.delete(k);
  }
  if (typeof window === "undefined") return;
  try {
    // sessionStorage doesn't expose prefix scan cheaply — collect and remove
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k) continue;
      if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) toRemove.push(k);
    }
    toRemove.forEach(k => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

/**
 * SWR-style read. `on(data, isFresh)` is called up to twice:
 *   1. synchronously with the cached value (isFresh=false) if a cache hit exists;
 *   2. after the network fetch resolves (isFresh=true) with the fresh value.
 *
 * If the fetcher throws, the cached value is kept and the error is silently swallowed
 * (callers can still observe by wrapping the fetcher). Returns the fresh promise so
 * callers can await if needed.
 */
export async function swr<T>(
  key: string,
  fetcher: () => Promise<T>,
  on: (data: T, isFresh: boolean) => void,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T | null> {
  const cached = readCache<T>(key, ttlMs);
  if (cached !== null) on(cached, false);
  try {
    const fresh = await fetcher();
    writeCache(key, fresh);
    on(fresh, true);
    return fresh;
  } catch (err) {
    if (cached === null) throw err;
    return null;
  }
}
