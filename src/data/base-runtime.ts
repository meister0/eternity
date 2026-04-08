/**
 * Lazy-loaded base database.
 *
 * `public/data/bases.json` ships the full processed equipment-base catalog
 * (every base name, slot, sub-type id, level, implicits, and per-base
 * affix-effect modifier). It is order-of-magnitude smaller than `affixes.json`
 * but still meaningful weight to put on the critical path — and most users of
 * the stash search builder never need it (they only build affix/macro
 * filters). Statically importing it would bloat first paint for nothing.
 *
 * This module fetches `bases.json` on first request via `fetch('/data/bases.json')`
 * (Astro serves `public/` as static assets at the root URL), caches the parsed
 * BaseDb at module scope, and returns it from a React hook with the usual
 * `{ data, loading, error }` shape. Mirrors `affix-runtime.ts` exactly.
 *
 * SSR safety: `fetch()` is called only inside the React effect, never at
 * module load time. The hook returns `{ data: null, loading: true }` during
 * SSR / first render and updates client-side after the asset loads.
 *
 * Astro caveat: Vite/Astro do NOT bundle files under `public/` — they serve
 * them verbatim at runtime. Importing `public/data/bases.json` directly
 * would either fail or produce an inlined bundle, both undesirable. Always
 * fetch by URL.
 */

import { useEffect, useState } from 'react';
import type { BaseDb, ProcessedBase } from '../types/affix';

// Prepend Vite's resolved BASE_URL so the fetch works whether the app is
// served at the root ('/') in tests/standalone or under the Astro `base`
// config (e.g. '/eternity/' in dev and on GitHub Pages). `BASE_URL` is
// guaranteed to end with a trailing slash by Vite.
const BASES_URL = `${import.meta.env.BASE_URL}data/bases.json`;

interface BasesPayload {
  readonly _meta?: unknown;
  readonly bases: Record<string, ProcessedBase>;
}

/** Module-scope cache. Populated on first successful fetch. */
let cachedDb: BaseDb | null = null;
/** In-flight promise for deduping concurrent loads. */
let inflightPromise: Promise<BaseDb> | null = null;

/**
 * Fetch (or return cached) base database. Safe to call multiple times — the
 * first call kicks off a single fetch and all subsequent calls share its
 * result. After the first successful resolve, the cache is hot and the
 * promise resolves synchronously to the cached value.
 */
export function loadBaseDb(): Promise<BaseDb> {
  if (cachedDb !== null) {
    return Promise.resolve(cachedDb);
  }
  if (inflightPromise !== null) {
    return inflightPromise;
  }
  inflightPromise = fetch(BASES_URL)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`failed to fetch ${BASES_URL}: HTTP ${res.status}`);
      }
      return res.json() as Promise<BasesPayload>;
    })
    .then((payload) => {
      if (!payload || typeof payload.bases !== 'object') {
        throw new Error(`malformed bases payload from ${BASES_URL}`);
      }
      // The on-disk shape is `Record<string, ProcessedBase>` keyed by base
      // display name, which is exactly what `BaseDb` is. No conversion needed.
      cachedDb = payload.bases as BaseDb;
      return cachedDb;
    })
    .catch((err) => {
      // Reset inflight on error so a retry is possible.
      inflightPromise = null;
      throw err;
    });
  return inflightPromise;
}

/**
 * Reset the in-memory cache. Intended for tests; callers should NOT use this
 * in production code.
 */
export function __resetBaseDbCache(): void {
  cachedDb = null;
  inflightPromise = null;
}

export interface UseBaseDbResult {
  readonly data: BaseDb | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

/**
 * React hook that lazy-loads the base database on mount and returns its
 * loading state. The fetch is shared across all consumers via the module-
 * scope cache, so mounting multiple components that use this hook still
 * only triggers one network request.
 */
export function useBaseDb(): UseBaseDbResult {
  // Synchronous cache hit: skip the loading state entirely so consumers
  // mounted after the first load don't flash a spinner.
  const [data, setData] = useState<BaseDb | null>(cachedDb);
  const [loading, setLoading] = useState<boolean>(cachedDb === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cachedDb !== null) {
      // Cache populated between component instantiation and effect run.
      setData(cachedDb);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadBaseDb()
      .then((db) => {
        if (cancelled) return;
        setData(db);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
