/**
 * Render a stat-line preview for a specific tier of an affix, split into
 * tokens that the UI can style independently.
 *
 * Context: the AffixSelector row shows each affix's `statTemplate` in a
 * small caption under the affix name, e.g. `(10-14)% increased Mana
 * Regen`. The raw template has PoB-LE's base-range placeholder baked in
 * (the T1 values), which is fine when the user is just browsing — but
 * the moment they tweak the inline tier picker to T5 or T8 the preview
 * should update to reflect the range at the picked tier.
 *
 * This module re-implements the placeholder-substitution logic from
 * `regex-generator.ts` but returns structured tokens instead of a
 * regex, so the UI can color the numeric part independently of the
 * surrounding prose (per the Last Epoch convention: T1-T5 white, T6-T8
 * fuchsia/pink, highlighting the "exalted" tiers).
 *
 * Hybrid affixes (two stat lines separated by ` / ` in the statTemplate)
 * get two independent value substitutions, each from the matching entry
 * in `ProcessedTier.valueRanges`.
 */

import type { ProcessedAffix, ValueRange } from '../types/affix';
import type { EquipmentSlot } from '../types/stash-search';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single piece of a rendered stat line. Text tokens carry prose
 *  ("% increased Mana Regen", the " / " separator between hybrid lines,
 *  etc.) that should stay muted. Value tokens carry the numeric range
 *  for the picked tier and are styled with the tier-color-class. */
export type StatToken =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value'; readonly text: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the token stream for `affix` at the given `slot` and `tier`.
 * When the slot has no data for that tier (or the whole slot is
 * missing), falls back to the raw statTemplate rendered as a single
 * text token — better a stale preview than a blank row.
 */
export function renderTierStatLine(
  affix: ProcessedAffix,
  slot: EquipmentSlot,
  tier: number,
): readonly StatToken[] {
  const slotTiers = affix.perSlotTiers[slot];
  if (slotTiers === undefined) {
    return [{ kind: 'text', text: affix.statTemplate }];
  }
  const tierData = slotTiers.find((t) => t.tier === tier);
  if (tierData === undefined) {
    return [{ kind: 'text', text: affix.statTemplate }];
  }

  const statLines = affix.statTemplate.split(' / ');
  const out: StatToken[] = [];

  statLines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      out.push({ kind: 'text', text: ' / ' });
    }

    // Pick the value range for this stat line. Single-stat affixes have
    // a single range; hybrids have one per line in parallel. If the
    // shape doesn't line up (malformed data, safety net), fall back to
    // the first range so we don't index OOB.
    const range: ValueRange | undefined =
      statLines.length === 1 || tierData.valueRanges.length !== statLines.length
        ? tierData.valueRanges[0]
        : tierData.valueRanges[lineIdx];

    if (range === undefined) {
      out.push({ kind: 'text', text: line });
      return;
    }

    const substituted = substituteRange(line, range);
    out.push(...substituted);
  });

  return out;
}

/**
 * Convenience helper for the component: pick the Tailwind class that
 * colours a stat value based on the tier it represents. T6-T8 are the
 * "exalted" and "primordial" tiers in Last Epoch and use a fuchsia
 * highlight in-game; lower tiers use a plain bright-white contrast
 * against the muted gray prose.
 */
export function tierValueColorClass(tier: number): string {
  if (tier >= 6) return 'text-fuchsia-400 font-semibold';
  return 'text-gray-100 font-medium';
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Match a `(min-max)` or `(min - max)` placeholder (with optional
 *  decimals). Same shape as the one used in regex-generator.ts. */
const PAREN_RANGE_RE = /\(\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*\)/;

/** Match a standalone integer or decimal, used as a fallback when the
 *  statTemplate doesn't carry a `(min-max)` placeholder (T1-only affixes
 *  often just have a bare number like `+5 Health`). */
const FIRST_NUMBER_RE = /\d+(?:\.\d+)?/;

/**
 * Format a ValueRange for display. Collapses degenerate `min === max`
 * to a single integer string; otherwise parenthesizes as `(min-max)`.
 */
function formatRange(range: ValueRange): string {
  if (range.min === range.max) {
    return String(range.min);
  }
  return `(${range.min}-${range.max})`;
}

/**
 * Replace the first `(min-max)` placeholder — or, failing that, the
 * first bare number — in `line` with the formatted value range, and
 * return the result as a `text` / `value` / `text` triple. If neither
 * pattern matches, returns the whole line as a single text token.
 *
 * Empty before/after segments are skipped so the caller doesn't get
 * zero-width tokens cluttering the output.
 */
function substituteRange(line: string, range: ValueRange): readonly StatToken[] {
  const parenMatch = line.match(PAREN_RANGE_RE);
  if (parenMatch !== null && parenMatch.index !== undefined) {
    return buildTriple(
      line.slice(0, parenMatch.index),
      formatRange(range),
      line.slice(parenMatch.index + parenMatch[0].length),
    );
  }

  const numberMatch = line.match(FIRST_NUMBER_RE);
  if (numberMatch !== null && numberMatch.index !== undefined) {
    return buildTriple(
      line.slice(0, numberMatch.index),
      formatRange(range),
      line.slice(numberMatch.index + numberMatch[0].length),
    );
  }

  return [{ kind: 'text', text: line }];
}

function buildTriple(before: string, value: string, after: string): readonly StatToken[] {
  const out: StatToken[] = [];
  if (before.length > 0) out.push({ kind: 'text', text: before });
  out.push({ kind: 'value', text: value });
  if (after.length > 0) out.push({ kind: 'text', text: after });
  return out;
}
