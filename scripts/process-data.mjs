#!/usr/bin/env node
// scripts/process-data.mjs
//
// Transforms data/raw/{ModItem,bases-full}.json into the processed shape
// consumed by the UI: public/data/{affixes,bases}.json.
//
// Output shapes match src/types/affix.ts (AffixDb, BaseDb) exactly.
//
// =============================================================================
// TIER INDEXING — READ BEFORE EDITING
// =============================================================================
// PoB-LE's ModItem.json keys are "<affixId>_<tierIndex>" with tierIndex 0..7.
// Empirically (see PLAN.md §4):
//
//   - 1112 affixes have a tier-0 entry.
//   -  692 affixes also have tier 1..6 (and 643 of those also have tier 7).
//   -  420 affixes have ONLY tier 0 (no per-tier breakdown — wide summary text).
//
// Value-based cross-checking (PLAN.md §4.2) confirmed that ModItem tier index N
// corresponds to game tier N for N ∈ {1..7}. ModItem tier 0 is a synthetic
// baseline that does NOT map to any in-game tier.
//
// Therefore:
//   - For affixes with at least one tier >= 1, we DROP the tier-0 entry and
//     emit only tiers 1..7 verbatim (no +1 adjustment anywhere).
//   - For the ~420 affixes with only tier 0, we flag them `hasTierBreakdown:
//     false`, emit `tiers: []`, and surface the lone entry as `summaryText`.
//
// Beware: PoB-LE `src/Classes/Item.lua:347-350` contains an off-by-one bug that
// classifies tier index >= 5 as "exalted" (game exalted is T6+). It's a PoB bug
// and not a hint about a different indexing convention. DO NOT add +1 anywhere.
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
 * Drops tier 0 for normal affixes. Emits summaryText for lone-tier-0 affixes.
 * @param {string} affixId
 * @param {Map<number, RawModItemEntry>} tierMap
 * @returns {object}
 */
function buildProcessedAffix(affixId, tierMap) {
  const idNum = Number(affixId);
  const sortedTierIndexes = [...tierMap.keys()].sort((a, b) => a - b);

  const hasHigherTier = sortedTierIndexes.some((t) => t >= 1);

  // Pick a reference entry for stable metadata (name, type, statOrderKey).
  // Prefer the lowest real tier over tier 0 where possible.
  const referenceTierIndex = hasHigherTier
    ? sortedTierIndexes.find((t) => t >= 1)
    : sortedTierIndexes[0];
  const reference = tierMap.get(referenceTierIndex);

  const name = typeof reference.affix === 'string' ? reference.affix : '';
  const type = reference.type === 'Prefix' ? 'Prefix' : 'Suffix';
  const statOrderKey = Number(reference.statOrderKey);

  if (!hasHigherTier) {
    // Lone tier 0 — summary-only affix.
    const entry = tierMap.get(0);
    const summaryText = buildDisplayText(entry['1'], entry['2']);
    return {
      id: idNum,
      name,
      type,
      statOrderKey,
      hasTierBreakdown: false,
      tiers: [],
      summaryText,
    };
  }

  // Normal affix — drop tier 0, emit tiers 1..N in ascending order.
  const tiers = sortedTierIndexes
    .filter((t) => t >= 1)
    .map((tierIndex) => {
      const entry = tierMap.get(tierIndex);
      const displayText = buildDisplayText(entry['1'], entry['2']);
      const valueRanges = extractValueRanges(entry, affixId);
      const level = Number.isFinite(entry.level) ? Number(entry.level) : 0;
      return {
        tier: tierIndex,
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
 * @returns {{affixes: Record<string, object>, stats: {total: number, withBreakdown: number, summaryOnly: number}}}
 */
function buildAffixDb(modItem) {
  const grouped = groupEntriesByAffix(modItem);
  const affixes = {};
  let withBreakdown = 0;
  let summaryOnly = 0;

  for (const [affixId, tierMap] of grouped) {
    const processed = buildProcessedAffix(affixId, tierMap);
    affixes[affixId] = processed;
    if (processed.hasTierBreakdown) withBreakdown++;
    else summaryOnly++;
  }

  return {
    affixes,
    stats: {
      total: grouped.size,
      withBreakdown,
      summaryOnly,
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
 * Run the spot-check validations required by PLAN.md §8 P0.2.
 * @param {{affixes: Record<string, object>, stats: {total: number, withBreakdown: number, summaryOnly: number}}} built
 */
function validateAffixes(built) {
  const { affixes, stats } = built;

  // Spot-check: affix 330 (Rejuvenating / Mana Regen).
  const a330 = affixes['330'];
  assert(a330, 'affix 330 missing');
  assert(a330.name === 'Rejuvenating', `affix 330 name = ${a330.name}`);
  assert(a330.type === 'Suffix', `affix 330 type = ${a330.type}`);
  assert(a330.hasTierBreakdown === true, `affix 330 hasTierBreakdown = ${a330.hasTierBreakdown}`);
  assert(a330.tiers.length >= 7, `affix 330 tiers.length = ${a330.tiers.length}`);
  const a330T7 = a330.tiers.find((t) => t.tier === 7);
  assert(a330T7, 'affix 330 has no tier 7');
  assert(
    a330T7.valueRanges.length === 1 &&
      a330T7.valueRanges[0].min === 94 &&
      a330T7.valueRanges[0].max === 110,
    `affix 330 tier 7 valueRanges = ${JSON.stringify(a330T7.valueRanges)}`,
  );
  assert(
    a330T7.displayText.includes('(94-110)% increased Mana Regen'),
    `affix 330 tier 7 displayText = ${JSON.stringify(a330T7.displayText)}`,
  );
  assert(
    !a330T7.displayText.includes('{rounding'),
    `affix 330 tier 7 displayText still contains PoB marker: ${JSON.stringify(a330T7.displayText)}`,
  );

  // Spot-check: affix 0 (Inevitable / Void Penetration).
  const a0 = affixes['0'];
  assert(a0, 'affix 0 missing');
  assert(a0.name === 'Inevitable', `affix 0 name = ${a0.name}`);
  assert(a0.tiers.length === 7, `affix 0 tiers.length = ${a0.tiers.length}`);
  const a0T7 = a0.tiers.find((t) => t.tier === 7);
  assert(a0T7, 'affix 0 has no tier 7');
  assert(
    a0T7.displayText.includes('Void Penetration'),
    `affix 0 tier 7 displayText = ${JSON.stringify(a0T7.displayText)}`,
  );

  // Count sanity.
  assert(
    stats.total >= 1000 && stats.total <= 1300,
    `total affix count out of range: ${stats.total}`,
  );
  assert(
    stats.withBreakdown >= 600,
    `expected >= 600 affixes with tier breakdown, got ${stats.withBreakdown}`,
  );
  assert(
    stats.summaryOnly >= 300,
    `expected >= 300 summary-only affixes, got ${stats.summaryOnly}`,
  );

  // All breakdown affixes must have at least one tier entry.
  for (const [id, affix] of Object.entries(affixes)) {
    if (affix.hasTierBreakdown) {
      assert(affix.tiers.length >= 1, `affix ${id} flagged hasTierBreakdown but tiers.length = 0`);
    } else {
      assert(
        affix.tiers.length === 0,
        `affix ${id} flagged !hasTierBreakdown but tiers.length = ${affix.tiers.length}`,
      );
      assert(
        typeof affix.summaryText === 'string',
        `affix ${id} flagged !hasTierBreakdown but summaryText missing`,
      );
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
      `(${built.stats.withBreakdown} with tier breakdown, ${built.stats.summaryOnly} summary-only)`,
  );
  console.log(`\u2713 public/data/bases.json \u2014 ${baseCount} bases`);
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
