import type { SearchState } from '../types/stash-search';
import { parseSearchString } from './search-parser';

export const createInitialState = (): SearchState => ({
  selectedPreset: null,
  itemPotential: {
    LP: { enabled: false, value: 1, operator: '+' },
    WW: { enabled: false, value: 16, operator: '+' },
    PT: { enabled: false, value: 16, operator: '+' },
    WT: { enabled: false },
    FP: { enabled: false, value: 1, operator: '+' },
    SwapAttributes: { enabled: false },
    Corrupted: { enabled: false },
    Corruptable: { enabled: false },
    Ruined: { enabled: false },
  },
  itemRarity: null,
  classRequirements: new Set(),
  itemTypes: new Set(),
  equipmentSlots: new Set(),
  equipmentRequirements: {
    Lvl: { enabled: false, value: 1, operator: '=' },
    CoF: { enabled: false },
    MG: { enabled: false },
    Trade: { enabled: false },
  },
  affixTiers: [],
  affixCounts: {
    Prefixes: { enabled: false, value: 0, operator: '=' },
    Suffixes: { enabled: false, value: 0, operator: '=' },
    Affixes: { enabled: false, value: 0, operator: '=' },
    Sealed: { enabled: false, value: 0, operator: '=' },
    Experimental: { enabled: false, value: 0, operator: '=' },
    Personal: { enabled: false, value: 0, operator: '=' },
  },
  regexPatterns: [{ pattern: '' }],
  globalOperator: '&',
  expressionOperators: [],
});

/**
 * Get current state from URL query parameter
 */
export function getStateFromURL(search?: string): SearchState {
  const fallback = createInitialState();
  let s = search;
  if (!s && typeof window !== 'undefined') {
    s = window.location.search;
  }
  if (!s) {
    return fallback;
  }

  const urlParams = new URLSearchParams(s);
  const searchQuery = urlParams.get('q');

  if (searchQuery) {
    const decoded = decodeURIComponent(searchQuery);
    return parseSearchString(decoded, fallback);
  }

  return fallback;
}

/**
 * Update URL with current search string
 */
export function updateURL(searchString: string): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);

  if (searchString.trim()) {
    url.searchParams.set('q', searchString);
  } else {
    url.searchParams.delete('q');
  }

  // Use replaceState to avoid creating history entries on every change
  window.history.replaceState(null, '', url.toString());
}

/**
 * Generate shareable link with current search string
 */
export function generateShareableLink(searchString: string): string {
  if (typeof window === 'undefined') return '';

  const url = new URL(window.location.href);

  if (searchString.trim()) {
    url.searchParams.set('q', searchString);
    return url.toString();
  }

  // Return clean URL if no search string
  url.searchParams.delete('q');
  return url.toString();
}

/**
 * Clear search string from URL (return to clean URL)
 */
export function clearURLState(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.delete('q');
  window.history.replaceState(null, '', url.toString());
}
