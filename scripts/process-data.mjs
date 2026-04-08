#!/usr/bin/env node
// scripts/process-data.mjs
//
// Transforms the raw upstream data into the processed shape consumed by the
// UI: public/data/{affixes,bases}.json. Output matches src/types/affix.ts.
//
// =============================================================================
// SOURCES — JOIN of PoB-LE and Tunklab (see PLAN.md §4 + docs/data-sources.md)
// =============================================================================
// Primary source: TUNKLAB (https://lastepoch.tunklab.com)
//   Scraped via `npm run scrape-tunklab` (uses playwright-cli + headless
//   Chromium because Tier6-Tier8 columns are JS-hydrated and not in raw HTML).
//   Output: data/raw/tunklab-cache/<slug>.json (gitignored, ~1112 files).
//
//   Tunklab is canonical for: name, nickname, type (Prefix/Suffix), category,
//   classRequirement, levelRequirement (aggregate), slots ("Applies To"), and
//   per-slot tier value tables (T1..T8 including the new T8 primordial tier).
//
//   Why Tunklab is primary: PoB-LE's ModItem.json has known holes — `affix`
//   field is often null and `type` is misclassified (e.g. affix 330 Mana
//   Regeneration which PoB-LE calls Suffix but the game treats as Prefix).
//
// Secondary source: POB-LE (Musholic/PathOfBuildingForLastEpoch)
//   Fetched via `npm run update-data` from raw.githubusercontent.com.
//   Provides: statOrderKey (mutual-exclusion grouping — Tunklab does not
//   expose it) and per-tier `level` (Tunklab only has aggregate).
//
// =============================================================================
// TIER INDEXING — READ BEFORE EDITING (PLAN.md §4)
// =============================================================================
// PoB-LE keys are "<affixId>_<tierIndex>" with tierIndex 0..7. Tunklab columns
// are labelled Tier1..Tier8. They line up with a +1 shift:
//
//     PoB-LE tier 0  ==  Tunklab Tier1  ==  Game T1
//     PoB-LE tier 7  ==  Tunklab Tier8  ==  Game T8 (primordial)
//
// Verified empirically 2026-04-08 by scraping affix 330 Mana Regeneration:
//   - ModItem 330_0 = (10-14)% on Belt = Tunklab Tier1 = Game T1
//   - ModItem 330_7 = (94-110)% on Belt = Tunklab Tier8 = Game T8 primordial
//   - Amulet T8 = (110-129)% (per-slot scaling — Amulet rolls higher)
//
// Empirical distribution (1112 total affixes, perfect 1:1 PoB-LE↔Tunklab match):
//
//   - 643 affixes have full T1-T8 progression
//   -  49 affixes are capped at T7 (no primordial roll)
//   - 420 affixes have a single T1 only — special-category specials
//     (altar/idol/sealed-only/etc.)
//
// Beware: PoB-LE `src/Classes/Item.lua:348` contains an off-by-one bug that
// classifies tier index >= 5 as "exalted". With T8 primordial added, that
// bug is now effectively off by TWO tiers — PoB-LE predates primordial.
// DO NOT propagate PoB's indexing mistake here.
// =============================================================================

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(REPO_ROOT, 'data', 'raw');
const PUBLIC_DATA_DIR = path.join(REPO_ROOT, 'public', 'data');

const SCHEMA_VERSION = 1;

// Known equipment slot vocabulary from bases-full.json `type` field. These do
// NOT match the EquipmentSlot TS union verbatim (e.g. "Body Armor" vs "Body")
// — the UI maps them later. This list is only used to warn on values that are
// clearly not an equipment slot so future upstream changes are visible.
const KNOWN_BASE_SLOTS = new Set([
  'Adorned Idol',
  'Amulet',
  'Arctus Lens',
  'Belt',
  'Blessing',
  'Body Armor',
  'Boots',
  'Bow',
  'Dagger',
  'Dysis Lens',
  'Eos Lens',
  'Gloves',
  'Grand Idol',
  'Greater Lens',
  'Helmet',
  'Huge Idol',
  'Humble Idol',
  'Idol Altar',
  'Large Idol',
  'Mesembria Lens',
  'Minor Idol',
  'Off-Hand Catalyst',
  'One-Handed Axe',
  'One-Handed Mace',
  'One-Handed Sword',
  'Ornate Idol',
  'Quiver',
  'Relic',
  'Ring',
  'Sceptre',
  'Shield',
  'Small Idol',
  'Stout Idol',
  'Two-Handed Axe',
  'Two-Handed Mace',
  'Two-Handed Spear',
  'Two-Handed Staff',
  'Two-Handed Sword',
  'Wand',
]);

/**
 * Read and JSON-parse a file. Throws a clear error if it fails.
 * @param {string} filePath
 * @returns {Promise<unknown>}
 */
async function readJson(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read ${filePath}: ${msg}`);
  }
}

/**
 * Strip PoB display markers like {rounding:Integer} and {else:...}.
 * @param {string} text
 * @returns {string}
 */
function stripPobMarkers(text) {
  return text.replace(/\{[^}]+\}/g, '');
}

/**
 * Combine PoB-LE "1" and "2" stat-line fields into a single template string
 * with " / " between, with markers stripped. Used to populate ProcessedAffix
 * `statTemplate`, the source of the stat-name verb for regex generation.
 *
 * @param {string | undefined | null} first
 * @param {string | undefined | null} second
 * @returns {string}
 */
function buildStatTemplate(first, second) {
  const parts = [];
  if (typeof first === 'string' && first.length > 0) parts.push(stripPobMarkers(first));
  if (typeof second === 'string' && second.length > 0) parts.push(stripPobMarkers(second));
  return parts.join(' / ').trim();
}

// ---------------------------------------------------------------------------
// Tunklab cache loader & per-affix parsers
// ---------------------------------------------------------------------------

/**
 * Load every JSON file in `data/raw/tunklab-cache/` into a Map keyed by the
 * stringified affix ID found inside each record's `data.meta.ID` field.
 * Throws if the directory is missing or has fewer than 1000 valid records.
 *
 * @param {string} cacheDir
 * @returns {Promise<Map<string, object>>}
 */
async function loadTunklabCache(cacheDir) {
  let fileNames;
  try {
    fileNames = await readdir(cacheDir);
  } catch {
    throw new Error(
      `Tunklab cache directory not found at ${cacheDir}. ` +
        `Run \`npm run scrape-tunklab\` first.`,
    );
  }
  const map = new Map();
  for (const fname of fileNames) {
    if (!fname.endsWith('.json')) continue;
    const text = await readFile(path.join(cacheDir, fname), 'utf8');
    const record = JSON.parse(text);
    if (record?.ok && record?.data?.meta?.ID) {
      map.set(String(record.data.meta.ID), record);
    }
  }
  if (map.size < 1000) {
    throw new Error(
      `Tunklab cache has only ${map.size} valid records (expected ~1112). ` +
        `Run \`npm run scrape-tunklab\` to refresh.`,
    );
  }
  return map;
}

/**
 * Split Tunklab's "Class requirement" field. Tunklab concatenates multi-class
 * strings with no separator, e.g. "MagePrimalistNon-Specific". We split on
 * lowercase→uppercase transitions, then post-process so that "Non-Specific"
 * (which contains an internal hyphen and capital N) stays joined.
 *
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
function parseClassRequirement(raw) {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Insert split markers at lowercase→uppercase transitions.
  const marked = trimmed.replace(/([a-z])([A-Z])/g, '$1\u0001$2');
  return marked
    .split('\u0001')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse Tunklab's aggregate "Level requirement" field into a number, or null
 * when absent. Tunklab values look like "25" or sometimes embed extra text.
 *
 * @param {string | null | undefined} raw
 * @returns {number | null}
 */
function parseLevelRequirement(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * Canonicalize a Tunklab slot string into the existing `EquipmentSlot`
 * vocabulary already used by the macro system (`1HAxe`, `Body`, `Small`,
 * `Catalyst`, etc. — see `src/types/stash-search.ts` and `EQUIPMENT_SLOT_MACROS`
 * in `src/data/stash-macros.ts`).
 *
 * Tunklab uses TWO different slot vocabularies on a single affix detail page:
 *   - The `Applies To` field (long form):  "One Handed Sword", "Idol 1x2", "Body Armor"
 *   - The Scaled Values table rows (short): "1H Sword",         "Minor Idol", "Body Armor"
 * Plus an upstream typo: `"One Handed Maces"` (plural) for 1H Mace.
 * Plus a long-form-only split where `Small Idol` is broken into faction
 * variants `"Idol 1x1 Eterra"` and `"Idol 1x1 Lagon"`.
 *
 * We canonicalize BOTH Tunklab forms into `EquipmentSlot` so that:
 *   - `affix.slots` is `readonly EquipmentSlot[]` (type-safe in the UI)
 *   - `affix.perSlotTiers` is keyed by `EquipmentSlot`
 *   - the regex generator's `slot` parameter is `EquipmentSlot`
 *   - the UI can reuse `EQUIPMENT_SLOT_MACROS` directly for labels
 *
 * The two `Idol 1x1 *` faction variants both collapse to `'Small'` since
 * Tunklab itself collapses them in the Scaled Values table; faction is
 * informational only and does not affect affix rolls.
 *
 * Unknown strings pass through unchanged and emit a warning so future
 * upstream additions are visible (e.g. a new weapon class in a patch).
 *
 * @type {Readonly<Record<string, string>>}
 */
const TUNKLAB_SLOT_CANONICAL = {
  // Armor — only "Body Armor" needs normalization, the rest are already
  // EquipmentSlot literals.
  'Body Armor': 'Body',
  // Weapons — long-form (Applies To) AND short-form (Scaled Values rows)
  // both canonicalize to the EquipmentSlot macro form.
  'One Handed Axe': '1HAxe',
  '1H Axe': '1HAxe',
  'One Handed Dagger': 'Dagger',
  // 'Dagger' (short form) is already EquipmentSlot literal — passes through.
  'One Handed Maces': '1HMace', // upstream Tunklab typo (plural)
  '1H Mace': '1HMace',
  'One Handed Sceptre': 'Sceptre',
  // 'Sceptre' (short form) is already EquipmentSlot literal — passes through.
  'One Handed Sword': '1HSword',
  '1H Sword': '1HSword',
  'Two Handed Axe': '2HAxe',
  '2H Axe': '2HAxe',
  'Two Handed Mace': '2HMace',
  '2H Mace': '2HMace',
  'Two Handed Spear': 'Spear',
  // 'Spear' (short form) is already EquipmentSlot literal — passes through.
  'Two Handed Staff': 'Staff',
  // 'Staff' (short form) is already EquipmentSlot literal — passes through.
  'Two Handed Sword': '2HSword',
  '2H Sword': '2HSword',
  // Off-hand
  Catalyst: 'Catalyst', // identity, but listed for completeness
  'Off-Hand Catalyst': 'Catalyst',
  // Idols — Applies To uses "Idol NxM" geometry, Scaled Values uses
  // "Small/Minor/Humble/Stout/Ornate/Grand/Huge/Large/Adorned Idol".
  'Idol 1x1 Eterra': 'Small',
  'Idol 1x1 Lagon': 'Small',
  'Small Idol': 'Small',
  'Idol 1x2': 'Minor',
  'Minor Idol': 'Minor',
  'Idol 2x1': 'Humble',
  'Humble Idol': 'Humble',
  'Idol 1x3': 'Stout',
  'Stout Idol': 'Stout',
  'Idol 3x1': 'Ornate',
  'Ornate Idol': 'Ornate',
  'Idol 1x4': 'Grand',
  'Grand Idol': 'Grand',
  'Idol 4x1': 'Huge',
  'Huge Idol': 'Huge',
  'Idol 2x2': 'Large',
  'Large Idol': 'Large',
  'Adorned Idol': 'Adorned',
  'Idol Altar': 'Altar',
  // Identity entries for slot strings that already match EquipmentSlot
  // literals — listed explicitly so the unknown-slot warning fires only for
  // genuinely unrecognized upstream additions.
  Helmet: 'Helmet',
  Belt: 'Belt',
  Boots: 'Boots',
  Gloves: 'Gloves',
  Amulet: 'Amulet',
  Ring: 'Ring',
  Relic: 'Relic',
  Shield: 'Shield',
  Quiver: 'Quiver',
  Bow: 'Bow',
  Wand: 'Wand',
  Dagger: 'Dagger',
  Sceptre: 'Sceptre',
  Spear: 'Spear',
  Staff: 'Staff',
};

/** Set of unknown slot strings already warned about, to avoid log spam. */
const _warnedUnknownSlots = new Set();

/**
 * @param {string} slot
 * @returns {string}
 */
function normalizeTunklabSlot(slot) {
  const mapped = TUNKLAB_SLOT_CANONICAL[slot];
  if (mapped !== undefined) return mapped;
  // Pass-through for slots that already match EquipmentSlot. Warn once for
  // anything that doesn't match either set so upstream additions are visible.
  if (!_warnedUnknownSlots.has(slot)) {
    _warnedUnknownSlots.add(slot);
    console.warn(
      `warn: Tunklab slot "${slot}" is not in the canonical map and may not ` +
        `match EquipmentSlot — passing through verbatim.`,
    );
  }
  return slot;
}

/**
 * Parse a Tunklab tier value cell into one or more numeric ranges. Multi-stat
 * (hybrid) affixes have one cell containing two stat lines separated by `\n`,
 * each with its own range. We return them in cell order so they line up with
 * the " / "-split stat lines in `statTemplate`.
 *
 * Examples:
 *   "+(10% to 14%)"                    → [{ min: 10,  max: 14 }]
 *   "+5%"                               → [{ min: 5,   max: 5  }]
 *   "-(5 to 3)%"                        → [{ min: -5,  max: -3 }]
 *   "+(205 to 243)\n+(40 to 50)"        → [{ min: 205, max: 243 }, { min: 40, max: 50 }]
 *
 * @param {string | null | undefined} cell
 * @returns {Array<{min: number, max: number}>}
 */
function parseTunklabValueRanges(cell) {
  if (typeof cell !== 'string' || cell.length === 0) return [];
  const lines = cell
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    const rangeMatch = line.match(
      /([-+]?)\(\s*([-+]?\d+(?:\.\d+)?)\s*%?\s*to\s*([-+]?\d+(?:\.\d+)?)\s*%?\s*\)/,
    );
    if (rangeMatch) {
      const sign = rangeMatch[1] === '-' ? -1 : 1;
      out.push({
        min: sign * parseFloat(rangeMatch[2]),
        max: sign * parseFloat(rangeMatch[3]),
      });
      continue;
    }
    const singleMatch = line.match(/([-+]?\d+(?:\.\d+)?)/);
    if (singleMatch) {
      const n = parseFloat(singleMatch[1]);
      out.push({ min: n, max: n });
    }
  }
  return out;
}

/**
 * Count "TierN" columns in a Tunklab Scaled Values headers row.
 * @param {readonly string[]} headers
 * @returns {number}
 */
function countTunklabTierColumns(headers) {
  return headers.filter((h) => /^Tier\d+$/.test(h)).length;
}

/**
 * @typedef {Object} RawModItemEntry
 * @property {string | null} [affix]
 * @property {string} [1]
 * @property {string} [2]
 * @property {number} tier
 * @property {number} level
 * @property {number} statOrderKey
 * @property {'Prefix' | 'Suffix'} type
 */

/**
 * Group all ModItem.json entries by affix ID. Returns a Map<string, {tierIndex: entry}>.
 * @param {Record<string, RawModItemEntry>} modItem
 * @returns {Map<string, Map<number, RawModItemEntry>>}
 */
function groupEntriesByAffix(modItem) {
  const byAffix = new Map();
  for (const [key, entry] of Object.entries(modItem)) {
    const parts = key.split('_');
    if (parts.length !== 2) {
      console.warn(`warn: unexpected ModItem key format "${key}" — skipped`);
      continue;
    }
    const [affixId, tierStr] = parts;
    const tierIndex = Number(tierStr);
    if (!Number.isInteger(tierIndex)) {
      console.warn(`warn: non-integer tier in key "${key}" — skipped`);
      continue;
    }
    if (!byAffix.has(affixId)) byAffix.set(affixId, new Map());
    byAffix.get(affixId).set(tierIndex, entry);
  }
  return byAffix;
}

/**
 * Build a ProcessedAffix by JOINing PoB-LE ModItem tier entries (for
 * statOrderKey and per-tier `level`) with the Tunklab cache record (for name,
 * nickname, type, category, slots, per-slot tier values, class requirement,
 * and aggregate level requirement).
 *
 * Tier mapping: ModItem tier index N (0..7) → Game tier (N+1) (1..8). Tunklab
 * "TierN" columns line up the same way (Tunklab Tier1 = ModItem 0 = Game T1).
 *
 * Throws if the Tunklab cache record is missing or malformed for this affix.
 *
 * @param {string} affixId
 * @param {Map<number, RawModItemEntry>} modItemTierMap
 * @param {object} tunklabRecord
 * @returns {object}
 */
function buildProcessedAffix(affixId, modItemTierMap, tunklabRecord) {
  const meta = tunklabRecord?.data?.meta;
  const scaled = tunklabRecord?.data?.scaled;
  if (!meta) {
    throw new Error(`affix ${affixId}: Tunklab record has no meta block`);
  }
  const idFromTunklab = parseInt(meta.ID, 10);
  if (idFromTunklab !== Number(affixId)) {
    throw new Error(
      `affix ${affixId}: Tunklab record ID ${meta.ID} does not match PoB-LE affix ID`,
    );
  }

  // Tunklab is canonical for these fields.
  const name = (meta.Name ?? '').trim();
  const nickname = (meta.Nickname ?? '').trim() || null;
  const type = meta.Type === 'Suffix' ? 'Suffix' : 'Prefix';
  const category = (meta.Category ?? '').trim();
  const classRequirement = parseClassRequirement(meta['Class requirement']);
  const levelRequirement = parseLevelRequirement(meta['Level requirement']);
  // NOTE: we deliberately do NOT use Tunklab's `Applies To` field as the
  // source of `slots`. Tunklab's "Applies To" and the Scaled Values rows
  // are out of sync for idol affixes (they list different idol sub-types
  // for the same affix). The Scaled Values rows are the authoritative
  // source because they bind a slot to actual tier values; we derive
  // `slots` from `Object.keys(perSlotTiers)` after building the per-slot
  // tier tables below.

  // PoB-LE provides statOrderKey + per-tier level (Tunklab only has aggregate)
  // and the canonical stat-name template for regex generation.
  const sortedModItemTiers = [...modItemTierMap.keys()].sort((a, b) => a - b);
  const reference = modItemTierMap.get(sortedModItemTiers[0]);
  const statOrderKey = Number(reference.statOrderKey);
  const statTemplate = buildStatTemplate(reference['1'], reference['2']);

  // Map game tier → required level. ModItem tier index N == Game tier (N+1).
  /** @type {Record<number, number>} */
  const levelByGameTier = {};
  for (const [tierIdx, entry] of modItemTierMap) {
    const gameTier = tierIdx + 1;
    levelByGameTier[gameTier] = Number.isFinite(entry.level) ? Number(entry.level) : 0;
  }

  // Build per-slot tier tables from Tunklab Scaled Values.
  /** @type {Record<string, Array<{tier: number, valueRanges: Array<{min:number,max:number}>, level: number}>>} */
  const perSlotTiers = {};
  let maxTier = 0;

  if (scaled?.headers && Array.isArray(scaled.rows)) {
    const tierCount = countTunklabTierColumns(scaled.headers);
    for (const row of scaled.rows) {
      const slotName = row.slot ? normalizeTunklabSlot(row.slot) : '';
      if (!slotName || tierCount === 0) continue;
      // The scraper kept the leading slot column in row.tiers (since it
      // collected all <td>s); the LAST `tierCount` elements of row.tiers
      // are the actual TierN value cells. Anything before that is the
      // optional "Modifier" column we don't care about.
      const tierValues = row.tiers.slice(row.tiers.length - tierCount);
      const tiers = [];
      for (let i = 0; i < tierValues.length; i++) {
        const cell = tierValues[i];
        const ranges = parseTunklabValueRanges(cell);
        if (ranges.length === 0) continue;
        const gameTier = i + 1;
        tiers.push({
          tier: gameTier,
          valueRanges: ranges,
          level: levelByGameTier[gameTier] ?? 0,
        });
        if (gameTier > maxTier) maxTier = gameTier;
      }
      if (tiers.length > 0) {
        perSlotTiers[slotName] = tiers;
      }
    }
  }

  // Derive `slots` from perSlotTiers keys — single source of truth that
  // guarantees `affix.slots` and `affix.perSlotTiers` are always aligned.
  const slots = Object.keys(perSlotTiers).sort();

  return {
    id: idFromTunklab,
    name,
    nickname,
    type,
    category,
    statOrderKey,
    classRequirement,
    levelRequirement,
    slots,
    statTemplate,
    perSlotTiers,
    maxTier,
  };
}

/**
 * Build the full AffixDb keyed by string affix ID by JOINing PoB-LE ModItem
 * entries with the Tunklab cache. Affixes missing from the Tunklab cache are
 * skipped with a warning (should not happen — verified 1112↔1112 1:1).
 *
 * @param {Record<string, RawModItemEntry>} modItem
 * @param {Map<string, object>} tunklabCache
 * @returns {{affixes: Record<string, object>, stats: {total: number, processed: number, fullEight: number, cappedSeven: number, singleOne: number, other: number}}}
 */
function buildAffixDb(modItem, tunklabCache) {
  const grouped = groupEntriesByAffix(modItem);
  const affixes = {};
  let fullEight = 0;
  let cappedSeven = 0;
  let singleOne = 0;
  let other = 0;

  for (const [affixId, tierMap] of grouped) {
    const tunklabRecord = tunklabCache.get(affixId);
    if (!tunklabRecord) {
      console.warn(`warn: affix ${affixId} has no Tunklab cache record — skipped`);
      continue;
    }
    const processed = buildProcessedAffix(affixId, tierMap, tunklabRecord);
    affixes[affixId] = processed;
    if (processed.maxTier === 8) fullEight++;
    else if (processed.maxTier === 7) cappedSeven++;
    else if (processed.maxTier === 1) singleOne++;
    else other++;
  }

  return {
    affixes,
    stats: {
      total: grouped.size,
      processed: Object.keys(affixes).length,
      fullEight,
      cappedSeven,
      singleOne,
      other,
    },
  };
}

/**
 * @typedef {Object} RawBase
 * @property {string} type
 * @property {number} [baseTypeID]
 * @property {number} [subTypeID]
 * @property {{level?: number}} [req]
 * @property {number} [affixEffectModifier]
 * @property {string[]} [implicits]
 */

/**
 * Build the BaseDb keyed by base display name.
 * @param {Record<string, RawBase>} rawBases
 * @returns {Record<string, object>}
 */
function buildBaseDb(rawBases) {
  const bases = {};
  for (const [name, raw] of Object.entries(rawBases)) {
    const slot = typeof raw.type === 'string' ? raw.type : '';
    if (slot && !KNOWN_BASE_SLOTS.has(slot)) {
      console.warn(
        `warn: base "${name}" has unrecognised slot type "${slot}" — passed through verbatim`,
      );
    }
    const level = raw.req && Number.isFinite(raw.req.level) ? Number(raw.req.level) : 0;
    const subTypeId = Number.isFinite(raw.subTypeID) ? Number(raw.subTypeID) : 0;
    const affixEffectModifier = Number.isFinite(raw.affixEffectModifier)
      ? Number(raw.affixEffectModifier)
      : 0;
    const implicits = Array.isArray(raw.implicits) ? [...raw.implicits] : [];
    bases[name] = {
      name,
      slot,
      subTypeId,
      level,
      implicits,
      affixEffectModifier,
    };
  }
  return bases;
}

/**
 * Stable, alphabetical key sort used for deterministic JSON output.
 * Affix IDs are strings of integers; sort numerically. Base names are
 * strings; sort with localeCompare for stability.
 * @param {Record<string, unknown>} obj
 * @param {'numeric' | 'alpha'} mode
 * @returns {Record<string, unknown>}
 */
function sortKeys(obj, mode) {
  const keys = Object.keys(obj);
  if (mode === 'numeric') {
    keys.sort((a, b) => Number(a) - Number(b));
  } else {
    keys.sort((a, b) => a.localeCompare(b));
  }
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

/**
 * Assertion helper — throws if condition is false.
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

/**
 * Run the spot-check validations required by the merged Tunklab + PoB-LE
 * shape (PLAN.md §4).
 * @param {{affixes: Record<string, object>, stats: {total: number, processed: number, fullEight: number, cappedSeven: number, singleOne: number, other: number}}} built
 */
function validateAffixes(built) {
  const { affixes, stats } = built;

  // Spot-check: affix 330 (Mana Regeneration / Rejuvenating). Verified against
  // Tunklab 2026-04-08:
  //   - Tunklab Name: "Mana Regeneration", Type: Prefix
  //     (PoB-LE wrongly says "Rejuvenating" / "Suffix")
  //   - Belt T1 = (10-14)%, Belt T8 = (94-110)%
  //   - Amulet T8 = (110-129)% (per-slot scaling)
  const a330 = affixes['330'];
  assert(a330, 'affix 330 missing');
  assert(
    a330.name === 'Mana Regeneration',
    `affix 330 name = ${a330.name} (expected "Mana Regeneration")`,
  );
  assert(
    a330.nickname === 'Rejuvenating',
    `affix 330 nickname = ${a330.nickname} (expected "Rejuvenating")`,
  );
  assert(
    a330.type === 'Prefix',
    `affix 330 type = ${a330.type} (Tunklab says Prefix; PoB-LE wrongly says Suffix)`,
  );
  assert(a330.statOrderKey === 330, `affix 330 statOrderKey = ${a330.statOrderKey}`);
  assert(
    Array.isArray(a330.slots) && a330.slots.includes('Belt') && a330.slots.includes('Amulet'),
    `affix 330 slots = ${JSON.stringify(a330.slots)}`,
  );
  assert(a330.maxTier === 8, `affix 330 maxTier = ${a330.maxTier} (expected 8)`);

  const beltTiers = a330.perSlotTiers.Belt;
  assert(beltTiers, 'affix 330 has no Belt perSlotTiers');
  assert(beltTiers.length === 8, `affix 330 Belt tier count = ${beltTiers.length} (expected 8)`);
  const beltT1 = beltTiers[0];
  const beltT8 = beltTiers[7];
  assert(
    beltT1.tier === 1 && beltT1.valueRanges[0].min === 10 && beltT1.valueRanges[0].max === 14,
    `affix 330 Belt T1 = ${JSON.stringify(beltT1)}`,
  );
  assert(
    beltT8.tier === 8 && beltT8.valueRanges[0].min === 94 && beltT8.valueRanges[0].max === 110,
    `affix 330 Belt T8 = ${JSON.stringify(beltT8)}`,
  );
  // Per-tier level joined from PoB-LE.
  assert(typeof beltT1.level === 'number', `affix 330 Belt T1.level missing`);

  const amuletT8 = a330.perSlotTiers.Amulet[a330.perSlotTiers.Amulet.length - 1];
  assert(
    amuletT8.tier === 8 &&
      amuletT8.valueRanges[0].min === 110 &&
      amuletT8.valueRanges[0].max === 129,
    `affix 330 Amulet T8 = ${JSON.stringify(amuletT8)} (expected min=110, max=129)`,
  );

  // Spot-check: affix 0 (Inevitable / Void Penetration) — should also be 8 tiers.
  const a0 = affixes['0'];
  assert(a0, 'affix 0 missing');
  assert(a0.maxTier === 8, `affix 0 maxTier = ${a0.maxTier} (expected 8)`);

  // Aggregate sanity — expecting ~1112 total.
  assert(
    stats.total >= 1000 && stats.total <= 1300,
    `total affix count out of range: ${stats.total}`,
  );
  assert(stats.processed >= 1000, `processed affix count too low: ${stats.processed}`);
  assert(stats.fullEight >= 600, `expected >= 600 affixes with full T1-T8, got ${stats.fullEight}`);
  assert(stats.cappedSeven >= 40, `expected >= 40 affixes capped at T7, got ${stats.cappedSeven}`);
  assert(stats.singleOne >= 300, `expected >= 300 single-T1 affixes, got ${stats.singleOne}`);

  // Per-affix invariants.
  for (const [id, affix] of Object.entries(affixes)) {
    assert(affix.id === Number(id), `affix ${id}: id mismatch (got ${affix.id})`);
    assert(typeof affix.name === 'string' && affix.name.length > 0, `affix ${id}: empty name`);
    assert(
      affix.type === 'Prefix' || affix.type === 'Suffix',
      `affix ${id}: invalid type ${affix.type}`,
    );
    assert(Array.isArray(affix.slots), `affix ${id}: slots not array`);
    assert(typeof affix.perSlotTiers === 'object', `affix ${id}: perSlotTiers not object`);
    assert(
      Number.isInteger(affix.maxTier) && affix.maxTier >= 1 && affix.maxTier <= 8,
      `affix ${id}: maxTier out of range: ${affix.maxTier}`,
    );
    for (const [slot, tiers] of Object.entries(affix.perSlotTiers)) {
      assert(Array.isArray(tiers) && tiers.length > 0, `affix ${id} slot ${slot}: empty tiers`);
      let prev = 0;
      for (const t of tiers) {
        assert(
          Number.isInteger(t.tier) && t.tier >= 1 && t.tier <= 8,
          `affix ${id} slot ${slot}: tier out of range: ${t.tier}`,
        );
        assert(
          t.tier > prev,
          `affix ${id} slot ${slot}: tiers not strictly ascending: ${prev} → ${t.tier}`,
        );
        prev = t.tier;
      }
    }
  }
}

/**
 * Build the `_meta` object to embed in both output files.
 * @param {{fetchedAt?: string, commitHash?: string, tunklab_source?: string}} rawMeta
 * @returns {object}
 */
function buildMeta(rawMeta) {
  return {
    fetchedAt: typeof rawMeta.fetchedAt === 'string' ? rawMeta.fetchedAt : 'unknown',
    commitHash: typeof rawMeta.commitHash === 'string' ? rawMeta.commitHash : 'unknown',
    sources: {
      tunklab:
        typeof rawMeta.tunklab_source === 'string'
          ? rawMeta.tunklab_source
          : 'https://lastepoch.tunklab.com',
      pobLe: 'PoB-LE / Musholic/PathOfBuildingForLastEpoch',
    },
    processedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}

async function main() {
  const modItemPath = path.join(RAW_DIR, 'ModItem.json');
  const basesPath = path.join(RAW_DIR, 'bases-full.json');
  const metaPath = path.join(RAW_DIR, '_meta.json');
  const cacheDir = path.join(RAW_DIR, 'tunklab-cache');

  const modItemText = await readFile(modItemPath, 'utf8');
  console.log(`Reading data/raw/ModItem.json (${modItemText.length} bytes)`);
  const modItemRaw = JSON.parse(modItemText);

  const basesText = await readFile(basesPath, 'utf8');
  console.log(`Reading data/raw/bases-full.json (${basesText.length} bytes)`);
  const basesRaw = JSON.parse(basesText);

  console.log(`Loading Tunklab cache from data/raw/tunklab-cache/`);
  const tunklabCache = await loadTunklabCache(cacheDir);
  console.log(`  ${tunklabCache.size} cache records`);

  const rawMeta = await readJson(metaPath);
  const meta = buildMeta(rawMeta);

  // --- Affixes (JOIN PoB-LE + Tunklab) ---
  const built = buildAffixDb(modItemRaw, tunklabCache);
  validateAffixes(built);
  const affixesSorted = sortKeys(built.affixes, 'numeric');

  // --- Bases ---
  const basesBuilt = buildBaseDb(basesRaw);
  const basesSorted = sortKeys(basesBuilt, 'alpha');

  // --- Write outputs ---
  await mkdir(PUBLIC_DATA_DIR, { recursive: true });

  const affixOutPath = path.join(PUBLIC_DATA_DIR, 'affixes.json');
  const baseOutPath = path.join(PUBLIC_DATA_DIR, 'bases.json');

  const affixPayload = { _meta: meta, affixes: affixesSorted };
  const basePayload = { _meta: meta, bases: basesSorted };

  // Output is minified — no whitespace between tokens. Cuts ~60% of raw bytes
  // (4.8 MB -> 1.3 MB) with no schema change. Brotli compression on the wire
  // is only ~30 KB smaller post-minify, but parse memory and parse time are
  // proportional to the raw size, which matters on weaker devices.
  await writeFile(affixOutPath, `${JSON.stringify(affixPayload)}\n`, 'utf8');
  await writeFile(baseOutPath, `${JSON.stringify(basePayload)}\n`, 'utf8');

  const baseCount = Object.keys(basesSorted).length;
  const affixBytes = (await readFile(affixOutPath)).length;
  const baseBytes = (await readFile(baseOutPath)).length;
  console.log(
    `\u2713 public/data/affixes.json \u2014 ${built.stats.processed} affixes ` +
      `(full T1-T8: ${built.stats.fullEight}, capped at T7: ${built.stats.cappedSeven}, ` +
      `single T1: ${built.stats.singleOne}, other: ${built.stats.other}) ` +
      `\u2014 ${(affixBytes / 1024).toFixed(0)} KB`,
  );
  console.log(
    `\u2713 public/data/bases.json \u2014 ${baseCount} bases \u2014 ${(baseBytes / 1024).toFixed(0)} KB`,
  );
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
