#!/usr/bin/env node
// scripts/build-affix-slots.mjs
//
// Consumes the raw Tunklab cache produced by `npm run scrape-tunklab` and
// writes a clean structured output:
//
//   public/data/affix-slots.json
//
// Output shape (indexed by string affix ID, sorted numerically):
//
//   {
//     "_meta": { source, builtAt, schemaVersion, totalAffixes, ... },
//     "affixes": {
//       "330": {
//         "id": 330,
//         "name": "Mana Regeneration",         // canonical (Tunklab) name
//         "nickname": "Rejuvenating",          // PoB-LE-style short name
//         "type": "Prefix" | "Suffix",          // Tunklab is authoritative
//         "category": "Normal Affix",
//         "slots": ["Ring", "Relic", "Belt", "Amulet"],
//         "perSlotTiers": {
//           "Belt": [
//             { "tier": 1, "min": 10, "max": 14, "displayText": "+(10% to 14%)" },
//             ...
//             { "tier": 8, "min": 94, "max": 110, "displayText": "+(94% to 110%)" }
//           ],
//           ...
//         }
//       },
//       ...
//     }
//   }
//
// Why this lives separate from public/data/affixes.json:
//   `affixes.json` is built from PoB-LE ModItem.json (the cheap enumeration
//   source). It has 1 set of values per affix, often with wrong type and null
//   names. This file enriches it with Tunklab's authoritative metadata. The
//   UI joins them by affix ID at runtime.
//
// Tier value parsing:
//   Tunklab cell strings look like "+(10% to 14%)", "+5%", "-(5 to 3)%", or
//   hybrid stat lines separated by newlines. We extract the FIRST numeric
//   range we find. Hybrid affixes need a separate handling pass downstream
//   (out of scope here).

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(REPO_ROOT, 'data', 'raw', 'tunklab-cache');
const OUT_PATH = path.join(REPO_ROOT, 'public', 'data', 'affix-slots.json');

const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Tier value parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Tunklab tier cell into a numeric range.
 *
 * Examples:
 *   "+(10% to 14%)"            → { min: 10, max: 14 }
 *   "+5%"                       → { min: 5,  max: 5 }
 *   "-(5 to 3)%"                → { min: -5, max: -3 }
 *   "+(14 to 21)\n+(1 to 2)"    → { min: 14, max: 21 }   // first stat only
 *   "" or "—"                   → null
 */
function parseTierCell(cell) {
  if (!cell || typeof cell !== 'string') return null;
  // Strip leading "+/-" sign — captured as part of the number group below.
  // Try to match a "(<min> to <max>)" pattern first, with optional negation.
  const rangeMatch = cell.match(
    /([-+]?)\(\s*([-+]?\d+(?:\.\d+)?)\s*%?\s*to\s*([-+]?\d+(?:\.\d+)?)\s*%?\s*\)/,
  );
  if (rangeMatch) {
    const sign = rangeMatch[1] === '-' ? -1 : 1;
    return {
      min: sign * parseFloat(rangeMatch[2]),
      max: sign * parseFloat(rangeMatch[3]),
    };
  }
  // Fallback: a single signed number (e.g. "+5%", "-3%").
  const singleMatch = cell.match(/([-+]?\d+(?:\.\d+)?)/);
  if (singleMatch) {
    const n = parseFloat(singleMatch[1]);
    return { min: n, max: n };
  }
  return null;
}

/**
 * Count the number of "TierN" columns in the headers row. Tunklab tables
 * have 8 tier columns for normal affixes, 7 for capped affixes, and 1 for
 * single-T1 specials.
 */
function countTierColumns(headers) {
  return headers.filter((h) => /^Tier\d+$/.test(h)).length;
}

// ---------------------------------------------------------------------------
// Per-affix builder
// ---------------------------------------------------------------------------

/**
 * Convert one cached Tunklab record into the output shape.
 * Returns null if the record is malformed or has no usable data.
 */
function buildAffixRecord(cached) {
  if (!cached || !cached.ok || !cached.data) return null;
  const { meta, scaled } = cached.data;
  if (!meta || !meta.ID) return null;

  const id = parseInt(meta.ID, 10);
  if (!Number.isInteger(id)) return null;

  const slots = (meta['Applies To'] ?? '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const record = {
    id,
    name: meta.Name ?? null,
    nickname: meta.Nickname ?? null,
    type: meta.Type ?? null,
    category: meta.Category ?? null,
    slots,
    perSlotTiers: {},
  };

  if (!scaled || !Array.isArray(scaled.headers) || !Array.isArray(scaled.rows)) {
    return record;
  }

  // The scraper collected the headers row via `thead th` (which includes
  // "Item type" + "Modifier" + Tier1..TierN), and each body row via `td`
  // with the leading slot column STRIPPED into row.slot, leaving row.tiers
  // as [Modifier, Tier1, ..., TierN]. So row.tiers length == headers length - 1
  // and the LAST `tierCount` elements of row.tiers are the actual tier values.
  const tierCount = countTierColumns(scaled.headers);

  for (const row of scaled.rows) {
    const slotName = row.slot;
    if (!slotName || tierCount === 0) continue;
    const tierValues = row.tiers.slice(row.tiers.length - tierCount);
    const tiers = [];
    for (let i = 0; i < tierValues.length; i++) {
      const cell = tierValues[i];
      const range = parseTierCell(cell);
      if (range) {
        tiers.push({
          tier: i + 1, // game tier 1..N
          min: range.min,
          max: range.max,
          displayText: cell,
        });
      }
    }
    if (tiers.length > 0) {
      record.perSlotTiers[slotName] = tiers;
    }
  }

  return record;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function validate(affixes) {
  // Spot-check: affix 330 (Mana Regeneration / Rejuvenating).
  const a330 = affixes['330'];
  assert(a330, 'affix 330 missing');
  assert(a330.name === 'Mana Regeneration', `affix 330 name = ${a330.name}`);
  assert(a330.nickname === 'Rejuvenating', `affix 330 nickname = ${a330.nickname}`);
  assert(a330.type === 'Prefix', `affix 330 type = ${a330.type} (expected Prefix per Tunklab)`);
  assert(
    a330.slots.includes('Belt') && a330.slots.includes('Amulet'),
    `affix 330 slots = ${JSON.stringify(a330.slots)}`,
  );
  const beltTiers = a330.perSlotTiers.Belt;
  assert(beltTiers, 'affix 330 has no Belt perSlotTiers');
  assert(beltTiers.length === 8, `affix 330 Belt tiers length = ${beltTiers.length}`);
  const beltT1 = beltTiers.find((t) => t.tier === 1);
  const beltT8 = beltTiers.find((t) => t.tier === 8);
  assert(
    beltT1 && beltT1.min === 10 && beltT1.max === 14,
    `affix 330 Belt T1 = ${JSON.stringify(beltT1)}`,
  );
  assert(
    beltT8 && beltT8.min === 94 && beltT8.max === 110,
    `affix 330 Belt T8 = ${JSON.stringify(beltT8)}`,
  );

  // Aggregate sanity: at least 600 affixes have non-empty slots.
  const ids = Object.keys(affixes);
  const withSlots = ids.filter((id) => affixes[id].slots.length > 0);
  assert(
    withSlots.length >= 600,
    `expected at least 600 affixes with non-empty slots, got ${withSlots.length}`,
  );
  assert(ids.length >= 1000, `expected at least 1000 total affixes, got ${ids.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json')).sort();
  console.log(`reading ${files.length} cache files from ${CACHE_DIR}`);

  const affixes = {};
  let okCount = 0;
  let errCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const cached = JSON.parse(await readFile(path.join(CACHE_DIR, file), 'utf8'));
    if (!cached.ok) {
      errCount++;
      continue;
    }
    const record = buildAffixRecord(cached);
    if (!record) {
      skippedCount++;
      continue;
    }
    affixes[String(record.id)] = record;
    okCount++;
  }

  // Sort numerically by affix ID for deterministic output.
  const sorted = {};
  for (const id of Object.keys(affixes).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    sorted[id] = affixes[id];
  }

  validate(sorted);

  const payload = {
    _meta: {
      source: 'https://lastepoch.tunklab.com (scraped via playwright-cli)',
      builtAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      totalAffixes: Object.keys(sorted).length,
      okCount,
      errCount,
      skippedCount,
    },
    affixes: sorted,
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  // Slot distribution summary.
  const slotCounts = {};
  for (const a of Object.values(sorted)) {
    for (const slot of a.slots) {
      slotCounts[slot] = (slotCounts[slot] || 0) + 1;
    }
  }

  console.log(`✓ ${OUT_PATH}`);
  console.log(`  ${okCount} affixes ok, ${errCount} errors, ${skippedCount} skipped`);
  console.log(`  slot distribution:`, slotCounts);
}

main().catch((err) => {
  console.error(`error: ${err && err.message ? err.message : String(err)}`);
  process.exitCode = 1;
});
