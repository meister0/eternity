#!/usr/bin/env node
// scripts/process-data.mjs
//
// Transforms data/raw/{ModItem,bases-full}.json into the processed shape
// consumed by the UI: public/data/{affixes,bases}.json.
//
// Output shapes match src/types/affix.ts (AffixDb, BaseDb) exactly.
//
// =============================================================================
// TIER INDEXING — READ BEFORE EDITING (see PLAN.md §4)
// =============================================================================
// PoB-LE's ModItem.json keys are "<affixId>_<tierIndex>" with tierIndex 0..7.
//
// Last Epoch now has 8 in-game tiers. T1..T7 are the pre-primordial tiers; T8
// is the "primordial" top tier added in the prior season. ModItem's tier index
// N maps DIRECTLY to Game tier (N+1) with a simple +1 shift:
//
//     ModItem tier 0 → Game T1
//     ModItem tier 1 → Game T2
//     ...
//     ModItem tier 7 → Game T8 (primordial)
//
// There is NO synthetic baseline and NO entries are dropped. This was verified
// empirically on 2026-04-08 by scraping Tunklab for affix 330 (Mana Regen):
//
//     ModItem `330_0` ("(10-14)% increased Mana Regen")  == Tunklab T1 == Game T1
//     ModItem `330_7` ("(94-110)% increased Mana Regen") == Tunklab T8 == Game T8
//
// Empirical distribution in ModItem.json:
//
//   - 1112 total affixes (every affix has at least a tier-0 entry → Game T1).
//   -  643 affixes have all 8 tiers (ModItem 0..7 → Game T1..T8).
//   -   49 affixes are capped at ModItem tier 6 (Game T7) — no primordial roll.
//   -  420 affixes have ONLY ModItem tier 0 → a single Game T1 entry. These
//     are formerly "summary-only" specials; they're now just single-tier
//     affixes with `tiers.length === 1` and `hasTierBreakdown: true`.
//
// Therefore:
//   - Emit every ModItem entry with its game tier = (ModItem index + 1).
//   - Output `tier` values are always in the inclusive range 1..8.
//   - `hasTierBreakdown` is true for ALL affixes (kept for schema stability).
//   - `summaryText` is dropped entirely — it is no longer needed.
//
// Historical context: an earlier version of this script assumed ModItem tier 0
// was a synthetic baseline and dropped it for affixes that had tier 1+ entries.
// That was wrong — it silently lost Game T1 for all 692 normal affixes.
//
// Beware: PoB-LE `src/Classes/Item.lua:348` contains an off-by-one bug that
// classifies tier index >= 5 as "exalted". Prior to primordial, game exalted
// was T6+ (so PoB was off by one). With the T8 primordial tier added, that
// bug is now effectively off by TWO tiers — PoB-LE predates primordial.
// DO NOT propagate PoB's indexing mistake here.
// =============================================================================

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
function stripMarkers(text) {
  return text.replace(/\{[^}]+\}/g, '');
}

/**
 * Combine "1" and "2" fields into a single display string with " / " between.
 * Applies marker stripping.
 * @param {string | undefined | null} first
 * @param {string | undefined | null} second
 * @returns {string}
 */
function buildDisplayText(first, second) {
  const parts = [];
  if (typeof first === 'string' && first.length > 0) parts.push(stripMarkers(first));
  if (typeof second === 'string' && second.length > 0) parts.push(stripMarkers(second));
  return parts.join(' / ').trim();
}

/**
 * Parse all (min-max) numeric ranges out of a string. Returns them as
 * {min, max} objects in the order they appear.
 * @param {string} source
 * @returns {Array<{min: number, max: number}>}
 */
function parseValueRanges(source) {
  const ranges = [];
  const pattern = /\(([\d.]+)-([\d.]+)\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const min = Number(match[1]);
    const max = Number(match[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      ranges.push({ min, max });
    }
  }
  return ranges;
}

/**
 * Fallback for single-value tiers like "+5% Void Penetration" — pick the first
 * signed number out of the stripped text and emit it as a degenerate range.
 * Returns null if no numeric value is parseable.
 * @param {string} strippedText
 * @returns {{min: number, max: number} | null}
 */
function parseBareNumber(strippedText) {
  const match = strippedText.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return { min: value, max: value };
}

/**
 * Build value ranges for a single ModItem tier entry. Combines "1" and "2"
 * fields so that hybrid affixes whose numeric data lives in "2" still get
 * captured. Falls back to a bare-number extraction when no (min-max) pattern
 * is present. Logs to stderr when even the fallback fails.
 * @param {{[key: string]: unknown}} entry
 * @param {string} affixId
 * @returns {Array<{min: number, max: number}>}
 */
function extractValueRanges(entry, affixId) {
  const firstRaw = typeof entry['1'] === 'string' ? entry['1'] : '';
  const secondRaw = typeof entry['2'] === 'string' ? entry['2'] : '';
  const combinedOriginal = [firstRaw, secondRaw].filter((s) => s.length > 0).join(' / ');

  const ranges = parseValueRanges(combinedOriginal);
  if (ranges.length > 0) return ranges;

  const stripped = stripMarkers(combinedOriginal);
  const bare = parseBareNumber(stripped);
  if (bare !== null) return [bare];

  console.warn(
    `warn: affix ${affixId} tier ${entry.tier} has no parseable numeric value ` +
      `(text: ${JSON.stringify(combinedOriginal)})`,
  );
  return [];
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
 * Build a ProcessedAffix for a single affix ID given all its tier entries.
 * ModItem tier index N (0..7) maps directly to Game tier (N+1) (1..8). No
 * entries are dropped; every collected entry is emitted.
 * @param {string} affixId
 * @param {Map<number, RawModItemEntry>} tierMap
 * @returns {object}
 */
function buildProcessedAffix(affixId, tierMap) {
  const idNum = Number(affixId);
  const sortedTierIndexes = [...tierMap.keys()].sort((a, b) => a - b);

  // Reference entry for stable metadata (name, type, statOrderKey). Use the
  // lowest-index entry — every affix has at least one, and values identical
  // across tiers (affix name/type/statOrderKey never vary per tier).
  const reference = tierMap.get(sortedTierIndexes[0]);
  const name = typeof reference.affix === 'string' ? reference.affix : '';
  const type = reference.type === 'Prefix' ? 'Prefix' : 'Suffix';
  const statOrderKey = Number(reference.statOrderKey);

  const tiers = sortedTierIndexes.map((tierIndex) => {
    const entry = tierMap.get(tierIndex);
    const displayText = buildDisplayText(entry['1'], entry['2']);
    const valueRanges = extractValueRanges(entry, affixId);
    const level = Number.isFinite(entry.level) ? Number(entry.level) : 0;
    return {
      tier: tierIndex + 1, // ModItem index → Game tier (1..8).
      displayText,
      valueRanges,
      level,
    };
  });

  return {
    id: idNum,
    name,
    type,
    statOrderKey,
    hasTierBreakdown: true,
    tiers,
  };
}

/**
 * Build the full AffixDb keyed by string affix ID.
 * @param {Record<string, RawModItemEntry>} modItem
 * @returns {{affixes: Record<string, object>, stats: {total: number, fullEight: number, cappedSeven: number, singleOne: number}}}
 */
function buildAffixDb(modItem) {
  const grouped = groupEntriesByAffix(modItem);
  const affixes = {};
  let fullEight = 0;
  let cappedSeven = 0;
  let singleOne = 0;

  for (const [affixId, tierMap] of grouped) {
    const processed = buildProcessedAffix(affixId, tierMap);
    affixes[affixId] = processed;
    const len = processed.tiers.length;
    if (len === 8) fullEight++;
    else if (len === 7) cappedSeven++;
    else if (len === 1) singleOne++;
  }

  return {
    affixes,
    stats: {
      total: grouped.size,
      fullEight,
      cappedSeven,
      singleOne,
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
 * Run the spot-check validations required by the 8-tier model (PLAN.md §4).
 * @param {{affixes: Record<string, object>, stats: {total: number, fullEight: number, cappedSeven: number, singleOne: number}}} built
 */
function validateAffixes(built) {
  const { affixes, stats } = built;

  // Spot-check: affix 330 (Rejuvenating / Mana Regen). Verified against Tunklab
  // 2026-04-08 — ModItem 330_0 == Game T1 (10-14%), ModItem 330_7 == Game T8 (94-110%).
  const a330 = affixes['330'];
  assert(a330, 'affix 330 missing');
  assert(a330.name === 'Rejuvenating', `affix 330 name = ${a330.name}`);
  assert(a330.type === 'Suffix', `affix 330 type = ${a330.type}`);
  assert(a330.hasTierBreakdown === true, `affix 330 hasTierBreakdown = ${a330.hasTierBreakdown}`);
  assert(a330.tiers.length === 8, `affix 330 tiers.length = ${a330.tiers.length} (expected 8)`);

  const a330T1 = a330.tiers[0];
  assert(a330T1.tier === 1, `affix 330 tiers[0].tier = ${a330T1.tier} (expected 1)`);
  assert(
    a330T1.valueRanges.length === 1 &&
      a330T1.valueRanges[0].min === 10 &&
      a330T1.valueRanges[0].max === 14,
    `affix 330 tier 1 valueRanges = ${JSON.stringify(a330T1.valueRanges)}`,
  );
  assert(
    a330T1.displayText.includes('(10-14)% increased Mana Regen'),
    `affix 330 tier 1 displayText = ${JSON.stringify(a330T1.displayText)}`,
  );

  const a330T8 = a330.tiers[7];
  assert(a330T8.tier === 8, `affix 330 tiers[7].tier = ${a330T8.tier} (expected 8)`);
  assert(
    a330T8.valueRanges.length === 1 &&
      a330T8.valueRanges[0].min === 94 &&
      a330T8.valueRanges[0].max === 110,
    `affix 330 tier 8 valueRanges = ${JSON.stringify(a330T8.valueRanges)}`,
  );
  assert(
    a330T8.displayText.includes('(94-110)% increased Mana Regen'),
    `affix 330 tier 8 displayText = ${JSON.stringify(a330T8.displayText)}`,
  );
  assert(
    !a330T8.displayText.includes('{rounding'),
    `affix 330 tier 8 displayText still contains PoB marker: ${JSON.stringify(a330T8.displayText)}`,
  );

  // Spot-check: affix 0 (Inevitable / Void Penetration).
  const a0 = affixes['0'];
  assert(a0, 'affix 0 missing');
  assert(a0.name === 'Inevitable', `affix 0 name = ${a0.name}`);
  assert(a0.tiers.length === 8, `affix 0 tiers.length = ${a0.tiers.length} (expected 8)`);
  assert(a0.tiers[7].tier === 8, `affix 0 tiers[7].tier = ${a0.tiers[7].tier} (expected 8)`);

  // Count sanity — expecting ~1112 total.
  assert(
    stats.total >= 1000 && stats.total <= 1300,
    `total affix count out of range: ${stats.total}`,
  );
  assert(
    stats.fullEight >= 600,
    `expected >= 600 affixes with full T1-T8 progression, got ${stats.fullEight}`,
  );
  assert(stats.cappedSeven >= 40, `expected >= 40 affixes capped at T7, got ${stats.cappedSeven}`);
  assert(stats.singleOne >= 300, `expected >= 300 single-T1 affixes, got ${stats.singleOne}`);

  // Every affix must have at least one tier, hasTierBreakdown always true,
  // no summaryText field, and all tier indexes in 1..8 and strictly ascending.
  for (const [id, affix] of Object.entries(affixes)) {
    assert(affix.hasTierBreakdown === true, `affix ${id} must have hasTierBreakdown === true`);
    assert(affix.tiers.length >= 1, `affix ${id} has empty tiers array`);
    assert(
      !('summaryText' in affix),
      `affix ${id} still has a summaryText field — should be dropped`,
    );
    let prev = 0;
    for (const t of affix.tiers) {
      assert(
        Number.isInteger(t.tier) && t.tier >= 1 && t.tier <= 8,
        `affix ${id} tier value out of range: ${t.tier}`,
      );
      assert(t.tier > prev, `affix ${id} tiers not strictly ascending: ${prev} → ${t.tier}`);
      prev = t.tier;
    }
  }
}

/**
 * Build the `_meta` object to embed in both output files.
 * @param {{fetchedAt?: string, commitHash?: string}} rawMeta
 * @returns {object}
 */
function buildMeta(rawMeta) {
  return {
    fetchedAt: typeof rawMeta.fetchedAt === 'string' ? rawMeta.fetchedAt : 'unknown',
    commitHash: typeof rawMeta.commitHash === 'string' ? rawMeta.commitHash : 'unknown',
    source: 'PoB-LE / Musholic/PathOfBuildingForLastEpoch',
    processedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}

async function main() {
  const modItemPath = path.join(RAW_DIR, 'ModItem.json');
  const basesPath = path.join(RAW_DIR, 'bases-full.json');
  const metaPath = path.join(RAW_DIR, '_meta.json');

  const modItemText = await readFile(modItemPath, 'utf8');
  console.log(`Reading data/raw/ModItem.json (${modItemText.length} bytes)`);
  const modItemRaw = JSON.parse(modItemText);

  const basesText = await readFile(basesPath, 'utf8');
  console.log(`Reading data/raw/bases-full.json (${basesText.length} bytes)`);
  const basesRaw = JSON.parse(basesText);

  const rawMeta = await readJson(metaPath);

  const meta = buildMeta(rawMeta);

  // --- Affixes ---
  const built = buildAffixDb(modItemRaw);
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

  await writeFile(affixOutPath, `${JSON.stringify(affixPayload, null, 2)}\n`, 'utf8');
  await writeFile(baseOutPath, `${JSON.stringify(basePayload, null, 2)}\n`, 'utf8');

  const baseCount = Object.keys(basesSorted).length;
  console.log(
    `\u2713 public/data/affixes.json \u2014 ${built.stats.total} affixes ` +
      `(full T1-T8: ${built.stats.fullEight}, capped at T7: ${built.stats.cappedSeven}, single T1: ${built.stats.singleOne})`,
  );
  console.log(`\u2713 public/data/bases.json \u2014 ${baseCount} bases`);
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
