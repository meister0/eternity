import { ALL_EQUIPMENT_SLOTS } from '../data/stash-macros';
import type { SelectedAffix } from '../types/affix';
import type { EquipmentSlot, SearchState } from '../types/stash-search';
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
  selectedAffixes: [],
  regexPatterns: [{ pattern: '' }],
  globalOperator: '&',
  expressionOperators: [],
});

// ---------------------------------------------------------------------------
// Selected-affix URL encoding
// ---------------------------------------------------------------------------
//
// Format: comma-separated list of `<affixId>:<slot>:<tier><suffix>` where
// `slot` is an EquipmentSlot literal (e.g. "Belt", "1HSword", "Amulet"),
// suffix is `=` for exact (only this tier) and `+` for inclusive (this tier
// or higher).
//
// Examples:
//   "330:Belt:8="                  — Mana Regen exactly T8 on Belt
//   "330:Belt:8=,330:Amulet:8="    — same affix on two different slots
//                                    (per-slot value scaling makes them distinct)
//   "330:Amulet:5+,0:Amulet:7+"    — two affixes on Amulet
//
// Breaking change from the previous format `<affixId>:<tier><suffix>`: slot
// was not part of the identity before. A SelectedAffix must carry its slot
// so `affixToRegex(affix, slot, minTier, exact)` can produce the correct
// per-slot value regex (Belt T8 and Amulet T8 of the same affix have
// different numeric ranges). No users of the old format in production yet,
// so silently accepting the old format is not required.
//
// An empty selectedAffixes array OMITS the `a=` param entirely so clean URLs
// stay clean.

const SELECTED_AFFIXES_PARAM = 'a';

const ALL_SLOT_SET: ReadonlySet<EquipmentSlot> = new Set<EquipmentSlot>(ALL_EQUIPMENT_SLOTS);

function isEquipmentSlot(value: string): value is EquipmentSlot {
  return (ALL_SLOT_SET as ReadonlySet<string>).has(value);
}

export function encodeSelectedAffixes(affixes: readonly SelectedAffix[]): string {
  return affixes
    .map((a) => {
      const suffix = a.exact ? '=' : '+';
      return `${a.affixId}:${a.slot}:${a.minTier}${suffix}`;
    })
    .join(',');
}

export function decodeSelectedAffixes(raw: string | null | undefined): SelectedAffix[] {
  if (!raw) return [];
  const out: SelectedAffix[] = [];
  for (const token of raw.split(',')) {
    const m = token.trim().match(/^(\d+):([A-Za-z0-9]+):(\d+)([=+])$/);
    if (!m) {
      console.warn(`url-state: ignored malformed selected-affix token "${token}"`);
      continue;
    }
    const affixId = parseInt(m[1], 10);
    const slotRaw = m[2];
    const minTier = parseInt(m[3], 10);
    const exact = m[4] === '=';
    if (!Number.isInteger(affixId) || affixId < 0) continue;
    if (!Number.isInteger(minTier) || minTier < 1 || minTier > 8) continue;
    if (!isEquipmentSlot(slotRaw)) {
      console.warn(`url-state: ignored selected-affix with unknown slot "${slotRaw}"`);
      continue;
    }
    out.push({ affixId, slot: slotRaw, minTier, exact });
  }
  return out;
}

/**
 * Get current state from URL query parameters. The `q` param holds the
 * full LE stash search string and is parsed back into state via
 * parseSearchString. The `a` param holds selectedAffixes in its own compact
 * encoding (see encodeSelectedAffixes) because parsing them back out of the
 * generated regex would be lossy.
 */
export function getStateFromURL(search?: string): SearchState {
  let fallback = createInitialState();
  let s = search;
  if (!s && typeof window !== 'undefined') {
    s = window.location.search;
  }
  if (!s) {
    return fallback;
  }

  const urlParams = new URLSearchParams(s);
  const searchQuery = urlParams.get('q');
  const selectedAffixes = decodeSelectedAffixes(urlParams.get(SELECTED_AFFIXES_PARAM));
  fallback = { ...fallback, selectedAffixes };

  if (searchQuery) {
    const decoded = decodeURIComponent(searchQuery);
    return parseSearchString(decoded, fallback);
  }

  return fallback;
}

/**
 * Update URL with current search string and selected affixes.
 */
export function updateURL(
  searchString: string,
  selectedAffixes: readonly SelectedAffix[] = [],
): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);

  if (searchString.trim()) {
    url.searchParams.set('q', searchString);
  } else {
    url.searchParams.delete('q');
  }

  if (selectedAffixes.length > 0) {
    url.searchParams.set(SELECTED_AFFIXES_PARAM, encodeSelectedAffixes(selectedAffixes));
  } else {
    url.searchParams.delete(SELECTED_AFFIXES_PARAM);
  }

  // Use replaceState to avoid creating history entries on every change
  window.history.replaceState(null, '', url.toString());
}

/**
 * Generate shareable link with current search string and selected affixes.
 */
export function generateShareableLink(
  searchString: string,
  selectedAffixes: readonly SelectedAffix[] = [],
): string {
  if (typeof window === 'undefined') return '';

  const url = new URL(window.location.href);

  if (searchString.trim()) {
    url.searchParams.set('q', searchString);
  } else {
    url.searchParams.delete('q');
  }

  if (selectedAffixes.length > 0) {
    url.searchParams.set(SELECTED_AFFIXES_PARAM, encodeSelectedAffixes(selectedAffixes));
  } else {
    url.searchParams.delete(SELECTED_AFFIXES_PARAM);
  }

  return url.toString();
}

/**
 * Clear search string and selected affixes from URL (return to clean URL).
 */
export function clearURLState(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.delete('q');
  url.searchParams.delete(SELECTED_AFFIXES_PARAM);
  window.history.replaceState(null, '', url.toString());
}
