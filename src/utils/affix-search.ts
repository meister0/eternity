/**
 * Ranked search scoring for the AffixSelector filter input.
 *
 * The original implementation matched `name`/`nickname` by substring and
 * sorted the results alphabetically. That produced an unhelpful order:
 * searching "mana" surfaced long descriptive affixes like "Chance On 10
 * Or More Mana Spent..." above the short, iconic "Mana Regeneration"
 * because 'C' < 'M' alphabetically. This module replaces that with
 * tier-based relevance scoring so the best matches surface first.
 *
 * Scoring is intentionally simple — no fuzzy/Levenshtein, no TF-IDF, no
 * tokenization beyond "word starts after a non-letter". This is
 * sufficient for a couple hundred matches per slot (1112 affixes total,
 * further slot-filtered) and keeps the behavior predictable for power
 * users who are building searches by hand.
 *
 * Tiers (descending; higher = better):
 *
 *   1000  name === needle                (exact)
 *    800  nickname === needle
 *    600  name starts with needle        (prefix)
 *    500  nickname starts with needle
 *    400  needle at a word boundary in name        (not at start)
 *    300  needle at a word boundary in nickname    (not at start)
 *    200  needle appears anywhere in name
 *    150  needle appears anywhere in nickname
 *    100  needle at a word boundary in statTemplate
 *     50  needle appears anywhere in statTemplate
 *      0  no match (should be filtered out, not ranked)
 *
 * Including statTemplate at the bottom of the hierarchy lets users find
 * affixes by the stat they actually care about ("ward", "pen", "crit")
 * even when the affix's administrative name doesn't contain that word —
 * but ranks those matches below any name/nickname hit so the iconic
 * results always win the top slots.
 *
 * Case-insensitive throughout. Callers should short-circuit the
 * empty-needle "show everything" case before calling this — passing an
 * empty needle here returns 1000 for every affix (all fields contain
 * the empty string), which is nonsense.
 */

import type { ProcessedAffix } from '../types/affix';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Score tiers exposed as named constants so the test file can assert
 *  specific tier membership without duplicating magic numbers. */
export const SCORE = Object.freeze({
  EXACT_NAME: 1000,
  EXACT_NICKNAME: 800,
  PREFIX_NAME: 600,
  PREFIX_NICKNAME: 500,
  WORD_NAME: 400,
  WORD_NICKNAME: 300,
  SUBSTRING_NAME: 200,
  SUBSTRING_NICKNAME: 150,
  WORD_TEMPLATE: 100,
  SUBSTRING_TEMPLATE: 50,
  NO_MATCH: 0,
} as const);

/**
 * Compute the match score for a single affix against a single search
 * needle. The needle is expected to be already-lowercased and trimmed
 * by the caller — this function does not do that itself because most
 * callers score many affixes against the same needle in a loop, so
 * pre-processing once outside the loop is cheaper.
 */
export function scoreAffixMatch(affix: ProcessedAffix, needleLower: string): number {
  const name = affix.name.toLowerCase();
  const nickname = affix.nickname !== null ? affix.nickname.toLowerCase() : null;
  const template = affix.statTemplate.toLowerCase();

  // Tier 1: exact matches.
  if (name === needleLower) return SCORE.EXACT_NAME;
  if (nickname === needleLower) return SCORE.EXACT_NICKNAME;

  // Tier 2: prefix matches.
  if (name.startsWith(needleLower)) return SCORE.PREFIX_NAME;
  if (nickname !== null && nickname.startsWith(needleLower)) return SCORE.PREFIX_NICKNAME;

  // Tier 3: word-boundary matches in name/nickname (not at start — that
  // would have been caught as a prefix above).
  if (hasWordBoundaryMatch(name, needleLower)) return SCORE.WORD_NAME;
  if (nickname !== null && hasWordBoundaryMatch(nickname, needleLower)) {
    return SCORE.WORD_NICKNAME;
  }

  // Tier 4: needle anywhere inside name or nickname (non-word-boundary,
  // e.g. "man" matching the "man" inside "Shaman").
  if (name.includes(needleLower)) return SCORE.SUBSTRING_NAME;
  if (nickname !== null && nickname.includes(needleLower)) return SCORE.SUBSTRING_NICKNAME;

  // Tier 5: stat template matches. This catches searches by the actual
  // stat text ("ward", "pen") when the affix's admin name doesn't
  // contain the word. Ranked below name/nickname so iconic matches
  // always win the top slots.
  if (hasWordBoundaryMatch(template, needleLower)) return SCORE.WORD_TEMPLATE;
  if (template.includes(needleLower)) return SCORE.SUBSTRING_TEMPLATE;

  return SCORE.NO_MATCH;
}

/**
 * Comparator factory for sorting a list of affixes by their match score
 * against a given needle, with alphabetical name as the tiebreaker. The
 * returned function is intended for `Array.prototype.sort`.
 *
 * Usage:
 *   const needle = filter.trim().toLowerCase();
 *   const cmp = compareAffixMatches(needle);
 *   sorted.sort(cmp);
 */
export function compareAffixMatches(
  needleLower: string,
): (a: ProcessedAffix, b: ProcessedAffix) => number {
  return (a, b) => {
    const diff = scoreAffixMatch(b, needleLower) - scoreAffixMatch(a, needleLower);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return true if `needle` appears in `haystack` at the start of a word
 * (i.e. either at position 0, or immediately after a non-letter
 * character such as space, digit, punctuation, or bracket). This is a
 * lightweight ASCII-English word-boundary check — no Unicode word
 * segmentation, no regex engine.
 *
 * Returns true as soon as any qualifying occurrence is found; does not
 * scan the full string once a match is confirmed.
 */
function hasWordBoundaryMatch(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    if (idx === 0 || !isLetter(haystack.charCodeAt(idx - 1))) {
      return true;
    }
    idx = haystack.indexOf(needle, idx + 1);
  }
  return false;
}

/** True if the character code is an ASCII letter a-z or A-Z. */
function isLetter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}
