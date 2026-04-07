/**
 * Regex generator for Last Epoch stash-search affix filters.
 *
 * Pure functions — no IO, no React, no state. Converts a ProcessedAffix
 * (from `../types/affix`) plus a tier selection into a regex fragment
 * compatible with LE's stash search macro language.
 *
 * See PLAN.md §1 for the worked example:
 *   T7 & /(9[4-9]|10\d|110)% increased mana regen/
 */

import type { ProcessedAffix, ProcessedTier, ValueRange } from '../types/affix';

// ---------------------------------------------------------------------------
// Numeric range → regex
// ---------------------------------------------------------------------------

/**
 * Convert a numeric range into a compact regex alternation matching every
 * integer in [min, max] inclusive.
 *
 *   rangeToRegex(94, 110) → "(9[4-9]|10\\d|110)"
 *   rangeToRegex(10, 19)  → "1\\d"
 *   rangeToRegex(5, 5)    → "5"
 */
export function rangeToRegex(min: number, max: number): string {
  if (min > max) {
    throw new Error(`rangeToRegex: min (${min}) must be <= max (${max})`);
  }
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    // Non-integer ranges fall back to a generic numeric pattern; see header.
    return '\\d+(\\.\\d+)?';
  }
  if (min < 0 || max < 0) {
    throw new Error(`rangeToRegex: negative ranges not supported (${min}, ${max})`);
  }
  if (min === max) {
    return String(min);
  }

  const parts = buildRangeParts(min, max);
  if (parts.length === 1) {
    // Single segment: parens only if it contains a character class or alternation.
    return needsOuterParens(parts[0]) ? `(${parts[0]})` : parts[0];
  }
  return `(${parts.join('|')})`;
}

/**
 * Fuse multiple ValueRanges into a single regex alternation covering the
 * union. Used when `minTier` is set with `exact=false`: we union all ranges
 * from minTier through the affix's max tier.
 *
 * Overlapping/contiguous ranges are merged; disjoint ranges become an
 * alternation of their individual sub-regexes.
 */
export function fuseRanges(ranges: readonly ValueRange[]): string {
  if (ranges.length === 0) {
    throw new Error('fuseRanges: at least one range required');
  }

  // Non-integer handling: if ANY range has non-integer bounds, fall back.
  const anyFloat = ranges.some((r) => !Number.isInteger(r.min) || !Number.isInteger(r.max));
  if (anyFloat) {
    return '\\d+(\\.\\d+)?';
  }

  const merged = mergeRanges(ranges);
  if (merged.length === 1) {
    return rangeToRegex(merged[0].min, merged[0].max);
  }

  const alternatives = merged.map((r) => {
    const piece = rangeToRegex(r.min, r.max);
    // Strip redundant outer parens from a single-segment sub-regex so the
    // final alternation stays compact.
    return stripOuterParens(piece);
  });
  return `(${alternatives.join('|')})`;
}

// ---------------------------------------------------------------------------
// Affix → regex fragment
// ---------------------------------------------------------------------------

/**
 * Build a stash-search regex fragment for the given affix at the given tier.
 *
 * Example output for Rejuvenating (affix 330) at T7, exact=true:
 *   "T7&/(9[4-9]|10\\d|110)% increased mana regen/"
 */
export function affixToRegex(affix: ProcessedAffix, minTier: number, exact: boolean): string {
  if (!affix.hasTierBreakdown) {
    throw new Error(
      `affixToRegex: affix "${affix.name}" (id=${affix.id}) has no tier breakdown ` +
        `and cannot be expressed with tier precision.`,
    );
  }
  if (!Number.isInteger(minTier) || minTier < 1 || minTier > 7) {
    throw new Error(`affixToRegex: minTier must be an integer in 1..7, got ${minTier}`);
  }

  const affixMaxTier = affix.tiers.reduce((acc, t) => (t.tier > acc ? t.tier : acc), 0);
  if (minTier > affixMaxTier) {
    throw new Error(
      `affixToRegex: affix "${affix.name}" (id=${affix.id}) has max tier T${affixMaxTier}, ` +
        `cannot select T${minTier}.`,
    );
  }

  const pickedTiers: readonly ProcessedTier[] = exact
    ? affix.tiers.filter((t) => t.tier === minTier)
    : affix.tiers.filter((t) => t.tier >= minTier);

  if (pickedTiers.length === 0) {
    throw new Error(
      `affixToRegex: no tiers matched for affix "${affix.name}" at T${minTier} (exact=${exact}).`,
    );
  }

  // Canonical wording comes from the lowest picked tier (wording is stable
  // across tiers; only the numbers change).
  const canonicalTier = pickedTiers.reduce(
    (acc, t) => (t.tier < acc.tier ? t : acc),
    pickedTiers[0],
  );

  // Hybrid (multi-stat) affixes: split on " / " and emit one fragment per line.
  const statLines = canonicalTier.displayText.split(' / ');

  const statRegex =
    statLines.length > 1
      ? `(${statLines
          .map((line, idx) => buildStatLineRegex(line, pickedTiers, idx, statLines.length))
          .join('|')})`
      : buildStatLineRegex(canonicalTier.displayText, pickedTiers, 0, 1);

  const prefix = exact ? `T${minTier}` : `T${minTier}+`;
  return `${prefix}&/${statRegex}/`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type IntRange = { readonly min: number; readonly max: number };

/**
 * Build the regex for a single stat line, substituting the numeric portion
 * with the fused value-regex for the picked tiers.
 *
 * `lineIndex` lets us pick the matching ValueRange entry for hybrid affixes
 * (ProcessedTier.valueRanges is parallel to the " / "-split stat lines).
 */
function buildStatLineRegex(
  statLine: string,
  pickedTiers: readonly ProcessedTier[],
  lineIndex: number,
  totalLines: number,
): string {
  const valueRegex = buildValueRegexForLine(pickedTiers, lineIndex, totalLines);
  const lowered = statLine.toLowerCase();

  // Case 1: the display text has a literal "(min-max)" placeholder where the
  // number goes — split on it and substitute.
  const parenRangeRe = /\(\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\)/;
  const parenMatch = lowered.match(parenRangeRe);
  if (parenMatch && parenMatch.index !== undefined) {
    const before = lowered.slice(0, parenMatch.index);
    const after = lowered.slice(parenMatch.index + parenMatch[0].length);
    return escapeLiteral(before) + valueRegex + escapeLiteral(after);
  }

  // Case 2: no "(min-max)" but a standalone number exists (e.g. "+5 health"
  // on a T1-only affix). Replace the first integer sequence.
  const firstNumRe = /\d+(?:\.\d+)?/;
  const numMatch = lowered.match(firstNumRe);
  if (numMatch && numMatch.index !== undefined) {
    const before = lowered.slice(0, numMatch.index);
    const after = lowered.slice(numMatch.index + numMatch[0].length);
    return escapeLiteral(before) + valueRegex + escapeLiteral(after);
  }

  // Case 3: no number at all — just escape the whole text.
  return escapeLiteral(lowered);
}

/**
 * Collect the ValueRanges for a specific stat line across all picked tiers,
 * and fuse them.
 */
function buildValueRegexForLine(
  pickedTiers: readonly ProcessedTier[],
  lineIndex: number,
  totalLines: number,
): string {
  const collected: ValueRange[] = [];
  for (const t of pickedTiers) {
    // Single-stat: one range per tier, use it.
    // Hybrid: expect valueRanges to be parallel to stat lines. If the shape
    // doesn't match, fall back to using every range on every line.
    if (totalLines === 1 || t.valueRanges.length !== totalLines) {
      for (const r of t.valueRanges) {
        collected.push({ min: r.min, max: r.max });
      }
    } else {
      const r = t.valueRanges[lineIndex];
      collected.push({ min: r.min, max: r.max });
    }
  }
  if (collected.length === 0) {
    // No ranges recorded — fall back to a generic numeric placeholder.
    return '\\d+';
  }
  return fuseRanges(collected);
}

/**
 * Escape regex metacharacters in a literal text fragment.
 * `+`, `(`, `)`, `[`, `]`, `.`, `?`, `*`, `\`, `|`, `{`, `}`, `^`, `$`, `/`.
 */
function escapeLiteral(text: string): string {
  return text.replace(/[+()[\].?*\\|{}^$/]/g, (ch) => `\\${ch}`);
}

/**
 * Merge overlapping/contiguous ValueRanges into a sorted, disjoint list.
 * Does not mutate the input.
 */
function mergeRanges(ranges: readonly ValueRange[]): readonly IntRange[] {
  const sorted: IntRange[] = ranges
    .map((r) => ({ min: r.min, max: r.max }))
    .sort((a, b) => a.min - b.min);

  const out: IntRange[] = [];
  for (const r of sorted) {
    const prev = out.length > 0 ? out[out.length - 1] : null;
    if (prev !== null && r.min <= prev.max + 1) {
      out[out.length - 1] = {
        min: prev.min,
        max: r.max > prev.max ? r.max : prev.max,
      };
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * Does this sub-regex need outer parens when used standalone?
 * Single literals and single character classes do not.
 */
function needsOuterParens(part: string): boolean {
  return part.includes('|');
}

/**
 * Strip outer parens iff they wrap the entire string and are balanced.
 * Used to keep fused alternations compact.
 */
function stripOuterParens(part: string): string {
  if (part.length < 2 || part[0] !== '(' || part[part.length - 1] !== ')') {
    return part;
  }
  // Verify the leading '(' matches the trailing ')'.
  let depth = 0;
  for (let i = 0; i < part.length; i += 1) {
    if (part[i] === '\\') {
      i += 1;
      continue;
    }
    if (part[i] === '(') depth += 1;
    else if (part[i] === ')') {
      depth -= 1;
      if (depth === 0 && i !== part.length - 1) return part;
    }
  }
  return part.slice(1, -1);
}

// ---------------------------------------------------------------------------
// rangeToRegex internals — numeric range → list of regex segments
// ---------------------------------------------------------------------------

/**
 * Decompose [min, max] (non-negative integers, min < max) into a list of
 * regex segments that together match every integer in the range exactly.
 *
 * Strategy:
 *  1. If min and max have different digit counts, split at
 *     10^(digits(max)-1) - 1 and recurse on each half.
 *  2. Same digit count: walk `start` from min upward, each step emitting
 *     the largest sub-range [start, end] whose shape collapses to a single
 *     segment `prefix + [a-b]` or `prefix + \d{k}`. Moves `start = end + 1`.
 */
function buildRangeParts(min: number, max: number): string[] {
  const minDigits = String(min).length;
  const maxDigits = String(max).length;
  if (minDigits !== maxDigits) {
    // Split at 99, 999, 9999 ... and recurse.
    const boundary = Math.pow(10, minDigits) - 1;
    const lower = buildRangeParts(min, boundary);
    const upper = buildRangeParts(boundary + 1, max);
    return [...lower, ...upper];
  }

  const parts: string[] = [];
  let start = min;
  while (start <= max) {
    const end = largestCleanEnd(start, max);
    parts.push(segmentToRegex(start, end));
    start = end + 1;
  }
  return parts;
}

/**
 * Given `start`, find the largest `end` in [start, max] such that
 * [start, end] shares a common prefix with only the trailing portion varying,
 * AND that trailing portion is either `[a-b]` (single digit) or `\d{k}`
 * (full sweep of k trailing digits).
 */
function largestCleanEnd(start: number, max: number): number {
  const digits = String(start).length;
  // Try the biggest k first (most compact): trailing k digits are [0..9].
  // For that, start must end with k zeros AND start + 10^k - 1 <= max.
  for (let k = digits; k >= 1; k -= 1) {
    const pow = Math.pow(10, k);
    if (start % pow !== 0) continue; // start must sit on a 10^k boundary
    const candidate = start + pow - 1;
    if (candidate <= max) return candidate;
  }
  // No full \d{k} sweep fits — emit a single-digit range [startLast..?].
  // The "prefix" is start without its last digit; the end shares that prefix
  // and its last digit is min(9, maxLastDigitOfMaxWithSamePrefix).
  const prefixNum = Math.floor(start / 10);
  const prefixMax = prefixNum * 10 + 9; // largest number sharing this prefix
  const end = Math.min(max, prefixMax);
  return end;
}

/**
 * Format a `[start, end]` segment that `largestCleanEnd` produced as a
 * single regex chunk.
 */
function segmentToRegex(start: number, end: number): string {
  if (start === end) return String(start);

  const startStr = String(start);
  const endStr = String(end);
  // Common prefix length.
  let p = 0;
  while (p < startStr.length && startStr[p] === endStr[p]) p += 1;
  const prefix = startStr.slice(0, p);
  const startTail = startStr.slice(p);
  const endTail = endStr.slice(p);

  // Two shapes are possible here by construction:
  //   (a) startTail = "0...0", endTail = "9...9" (length k) → prefix + \d{k}
  //   (b) length 1 each → prefix + [startTail-endTail]
  const allZeros = /^0+$/.test(startTail);
  const allNines = /^9+$/.test(endTail);
  if (allZeros && allNines && startTail.length === endTail.length) {
    const k = startTail.length;
    if (k === 1) return `${prefix}\\d`;
    return `${prefix}\\d{${k}}`;
  }
  if (startTail.length === 1 && endTail.length === 1) {
    return `${prefix}[${startTail}-${endTail}]`;
  }
  // Shouldn't happen by construction, but as a defensive fallback emit an
  // alternation of literals.
  const literals: string[] = [];
  for (let n = start; n <= end; n += 1) literals.push(String(n));
  return literals.join('|');
}
