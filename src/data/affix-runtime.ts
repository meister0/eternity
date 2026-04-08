/**
 * Lazy-loaded affix database.
 *
 * `public/data/affixes.json` is ~3 MB and is the entire scraped Tunklab+PoB-LE
 * affix dataset (1112 affixes with per-slot tier values, names, types, etc.).
 * Statically importing it would bloat the initial JS bundle from ~50 KB to
 * ~3 MB, killing first paint for users who never open the affix UI.
 *
 * This module fetches `affixes.json` on first request via `fetch('/data/affixes.json')`
 * (Astro serves `public/` as static assets at the root URL), caches the parsed
 * AffixDb at module scope, and returns it from a React hook with the usual
 * `{ data, loading, error }` shape.
 *
 * SSR safety: `fetch()` is called only inside the React effect, never at
 * module load time. The hook returns `{ data: null, loading: true }` during
 * SSR / first render and updates client-side after the asset loads.
 *
 * Astro caveat: Vite/Astro do NOT bundle files under `public/` — they serve
 * them verbatim at runtime. Importing `public/data/affixes.json` directly
 * would either fail or produce an inlined bundle, both undesirable. Always
 * fetch by URL.
 */

import { useEffect, useState } from 'react';
import type { AffixDb, ProcessedAffix } from '../types/affix';

const AFFIXES_URL = '/data/affixes.json';

interface AffixesPayload {
  readonly _meta?: unknown;
  readonly affixes: Record<string, ProcessedAffix>;
}

/** Module-scope cache. Populated on first successful fetch. */
let cachedDb: AffixDb | null = null;
/** In-flight promise for deduping concurrent loads. */
let inflightPromise: Promise<AffixDb> | null = null;

/**
 * Fetch (or return cached) affix database. Safe to call multiple times — the
 * first call kicks off a single fetch and all subsequent calls share its
 * result. After the first successful resolve, the cache is hot and the
 * promise resolves synchronously to the cached value.
 */
export function loadAffixDb(): Promise<AffixDb> {
  if (cachedDb !== null) {
    return Promise.resolve(cachedDb);
  }
  if (inflightPromise !== null) {
    return inflightPromise;
  }
  inflightPromise = fetch(AFFIXES_URL)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`failed to fetch ${AFFIXES_URL}: HTTP ${res.status}`);
      }
      return res.json() as Promise<AffixesPayload>;
    })
    .then((payload) => {
      if (!payload || typeof payload.affixes !== 'object') {
        throw new Error(`malformed affixes payload from ${AFFIXES_URL}`);
      }
      // Convert string-keyed object into a numeric-keyed Record so the type
      // matches `AffixDb = Readonly<Record<number, ProcessedAffix>>`. Both
      // representations are runtime-equivalent in JS but the type contract is
      // numeric.
      cachedDb = payload.affixes as unknown as AffixDb;
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
export function __resetAffixDbCache(): void {
  cachedDb = null;
  inflightPromise = null;
}

export interface UseAffixDbResult {
  readonly data: AffixDb | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

/**
 * React hook that lazy-loads the affix database on mount and returns its
 * loading state. The fetch is shared across all consumers via the module-
 * scope cache, so mounting multiple components that use this hook still
 * only triggers one network request.
 */
export function useAffixDb(): UseAffixDbResult {
  // Synchronous cache hit: skip the loading state entirely so consumers
  // mounted after the first load don't flash a spinner.
  const [data, setData] = useState<AffixDb | null>(cachedDb);
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
    loadAffixDb()
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
