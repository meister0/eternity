import { describe, expect, it } from 'vitest';
import type { ProcessedAffix } from '../types/affix';
import { compareAffixMatches, SCORE, scoreAffixMatch } from './affix-search';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal ProcessedAffix factory. The scoring function only reads
 * name/nickname/statTemplate, so the rest of the fields are stubbed to
 * the cheapest valid defaults.
 */
function makeAffix(
  overrides: Pick<ProcessedAffix, 'name'> & Partial<ProcessedAffix>,
): ProcessedAffix {
  return {
    id: 0,
    nickname: null,
    type: 'Prefix',
    category: 'Normal Affix',
    statOrderKey: 0,
    classRequirement: [],
    levelRequirement: null,
    slots: [],
    statTemplate: '',
    perSlotTiers: {},
    maxTier: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreAffixMatch
// ---------------------------------------------------------------------------

describe('scoreAffixMatch', () => {
  describe('exact matches', () => {
    it('scores EXACT_NAME (1000) when name equals needle', () => {
      const affix = makeAffix({ name: 'Mana' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.EXACT_NAME);
    });

    it('scores EXACT_NICKNAME (800) when nickname equals needle but name differs', () => {
      const affix = makeAffix({ name: 'Mana Regeneration', nickname: 'Rejuvenating' });
      expect(scoreAffixMatch(affix, 'rejuvenating')).toBe(SCORE.EXACT_NICKNAME);
    });

    it('prefers EXACT_NAME over EXACT_NICKNAME when both would match', () => {
      const affix = makeAffix({ name: 'Mana', nickname: 'mana' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.EXACT_NAME);
    });
  });

  describe('prefix matches', () => {
    it('scores PREFIX_NAME (600) when name starts with needle', () => {
      const affix = makeAffix({ name: 'Mana Regeneration' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.PREFIX_NAME);
    });

    it('scores PREFIX_NICKNAME (500) when nickname starts with needle', () => {
      const affix = makeAffix({
        name: 'Spell Damage and Mana',
        nickname: 'Manafused',
      });
      // Name contains "mana" as a word boundary (after "and ") → that's
      // WORD_NAME (400), nickname starts with "mana" → PREFIX_NICKNAME
      // (500). Higher tier wins.
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.PREFIX_NICKNAME);
    });
  });

  describe('word-boundary matches', () => {
    it('scores WORD_NAME (400) when needle sits at a word boundary mid-name', () => {
      const affix = makeAffix({ name: 'Maximum Mana' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.WORD_NAME);
    });

    it('counts word boundary after punctuation/bracket, not just space', () => {
      const affix = makeAffix({ name: 'Damage (Mana Spent as Ward)' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.WORD_NAME);
    });

    it('counts word boundary after digit', () => {
      const affix = makeAffix({ name: 'Chance On 10Mana Spent' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.WORD_NAME);
    });

    it('scores WORD_NICKNAME (300) when needle is at word boundary in nickname only', () => {
      const affix = makeAffix({ name: 'Unrelated', nickname: 'of Great Mana' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.WORD_NICKNAME);
    });
  });

  describe('substring (mid-word) matches', () => {
    it('scores SUBSTRING_NAME (200) when needle is inside a word in name', () => {
      // "man" appears inside "Shaman" — not at a word boundary.
      const affix = makeAffix({ name: 'Shaman Totem' });
      expect(scoreAffixMatch(affix, 'man')).toBe(SCORE.SUBSTRING_NAME);
    });

    it('scores SUBSTRING_NICKNAME (150) when needle is inside nickname only', () => {
      const affix = makeAffix({ name: 'Unrelated', nickname: 'Inhuman' });
      expect(scoreAffixMatch(affix, 'man')).toBe(SCORE.SUBSTRING_NICKNAME);
    });
  });

  describe('statTemplate matches', () => {
    it('scores WORD_TEMPLATE (100) when needle is at word boundary in template only', () => {
      const affix = makeAffix({
        name: 'Energy Shield',
        statTemplate: '+(12-20) Ward per Second',
      });
      expect(scoreAffixMatch(affix, 'ward')).toBe(SCORE.WORD_TEMPLATE);
    });

    it('scores SUBSTRING_TEMPLATE (50) when needle is mid-word in template only', () => {
      const affix = makeAffix({
        name: 'Unrelated',
        statTemplate: '+15 Awardable Points',
      });
      // "ward" is inside "Awardable" — not at word boundary.
      expect(scoreAffixMatch(affix, 'ward')).toBe(SCORE.SUBSTRING_TEMPLATE);
    });
  });

  describe('no match', () => {
    it('returns 0 when needle appears nowhere', () => {
      const affix = makeAffix({
        name: 'Armor',
        nickname: 'of Defense',
        statTemplate: '(10-12)% increased Armor',
      });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.NO_MATCH);
    });

    it('handles null nickname without crashing', () => {
      const affix = makeAffix({ name: 'Unrelated', nickname: null });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.NO_MATCH);
    });
  });

  describe('case insensitivity', () => {
    it('matches regardless of needle case (caller must lowercase first)', () => {
      const affix = makeAffix({ name: 'Mana Regeneration' });
      // Caller contract: needle is already lowercased.
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.PREFIX_NAME);
    });

    it('matches regardless of field case', () => {
      const affix = makeAffix({ name: 'MANA REGENERATION' });
      expect(scoreAffixMatch(affix, 'mana')).toBe(SCORE.PREFIX_NAME);
    });
  });
});

// ---------------------------------------------------------------------------
// compareAffixMatches — end-to-end ranking against real-shaped fixtures
// ---------------------------------------------------------------------------

describe('compareAffixMatches', () => {
  it('ranks a realistic "mana" search the way a player expects', () => {
    // Names drawn from the actual affixes.json dataset — this is what
    // a user sees when they filter by "mana" on a Belt slot.
    const affixes: ProcessedAffix[] = [
      makeAffix({ id: 34, name: 'Mana', nickname: 'Manafused' }),
      makeAffix({ id: 109, name: 'Mana', nickname: 'Lunar' }),
      makeAffix({ id: 331, name: 'Mana', nickname: 'Azure' }),
      makeAffix({ id: 330, name: 'Mana Regeneration', nickname: 'Rejuvenating' }),
      makeAffix({ id: 129, name: 'Mana And Armor', nickname: 'of the Stronghold' }),
      makeAffix({
        id: 53,
        name: 'Damage Dealt to Mana Before Health',
        nickname: "Mage's",
      }),
      makeAffix({
        id: 214,
        name: 'Chance On 10 Or More Mana Spent To Cast Lightning At A Nearby Enemy',
        nickname: 'Static',
      }),
      makeAffix({
        id: 255,
        name: 'Increased Cold Damage (Doubled If You Have Over 300 Max Mana)',
        nickname: 'of Cryomancy',
      }),
    ];

    const cmp = compareAffixMatches('mana');
    const sorted = [...affixes].sort(cmp);
    const order = sorted.map((a) => a.id);

    // The three exact "Mana" matches must be at the top, in some
    // order among themselves (all tie at score 1000 and share the
    // same name, so tiebreaker is sort stability). Use Set equality
    // — the specific order among the three doesn't matter, only that
    // no other affix sneaks in above them.
    expect(new Set(order.slice(0, 3))).toEqual(new Set([34, 109, 331]));

    // "Mana And Armor" and "Mana Regeneration" both prefix-match on
    // "mana" → tier 600. Alphabetical tiebreaker puts "Mana And Armor"
    // (A) before "Mana Regeneration" (R).
    expect(order[3]).toBe(129);
    expect(order[4]).toBe(330);

    // Everything else is word-boundary (tier 400), alphabetically
    // tiebroken.
    const tail = order.slice(5);
    expect(tail).toContain(53);
    expect(tail).toContain(214);
    expect(tail).toContain(255);

    // The CRITICAL assertion: "Mana Regeneration" (the iconic match)
    // must rank above long descriptive affixes like
    // "Chance On 10 Or More Mana Spent...". This is the regression the
    // user reported.
    expect(order.indexOf(330)).toBeLessThan(order.indexOf(214));
    expect(order.indexOf(330)).toBeLessThan(order.indexOf(53));
    expect(order.indexOf(330)).toBeLessThan(order.indexOf(255));
  });

  it('ranks nickname exact match above name substring match', () => {
    const affixes: ProcessedAffix[] = [
      makeAffix({ id: 1, name: 'Something with Rejuvenating Somewhere' }),
      makeAffix({ id: 2, name: 'Mana Regeneration', nickname: 'Rejuvenating' }),
    ];
    const sorted = [...affixes].sort(compareAffixMatches('rejuvenating'));
    expect(sorted[0].id).toBe(2); // nickname exact (800) > name word boundary (400)
    expect(sorted[1].id).toBe(1);
  });

  it('falls back to alphabetical order when scores tie', () => {
    const affixes: ProcessedAffix[] = [
      makeAffix({ id: 1, name: 'Zebra Mana' }),
      makeAffix({ id: 2, name: 'Mana Zebra' }),
      makeAffix({ id: 3, name: 'Apple Mana' }),
    ];
    const sorted = [...affixes].sort(compareAffixMatches('mana'));
    // Mana Zebra → prefix (600), top.
    // Apple Mana, Zebra Mana → word boundary (400), tiebreak alphabetical.
    expect(sorted.map((a) => a.id)).toEqual([2, 3, 1]);
  });
});
