/**
 * Tests for the slot-aware regex generator.
 *
 * Strategy: we build a concrete RegExp from each generator output and verify
 * match/reject behaviour against sample strings. We deliberately do NOT assert
 * on literal regex source strings (except where per-slot inequality is the
 * whole point of the test), because the generator's internal shape (paren
 * grouping, use of \d vs [0-9], etc.) is an implementation detail.
 *
 * Live affixes.json is loaded once at module scope so the per-slot scaling
 * contract (affix 330: Belt T8 = 94..110, Amulet T8 = 110..129) is exercised
 * against real data rather than fixtures.
 */

import { describe, expect, it } from 'vitest';
import affixesData from '../../public/data/affixes.json' with { type: 'json' };
import type { ProcessedAffix } from '../types/affix';
import type { EquipmentSlot } from '../types/stash-search';
import { affixToRegex, fuseRanges, rangeToRegex } from './regex-generator';

const affixes = (affixesData as { affixes: Record<string, ProcessedAffix> }).affixes;

/**
 * Turn a generator output like "T8&/(9[4-9]|10\\d|110)% increased mana regen/"
 * into a RegExp anchored at both ends, matching against the inner stash-search
 * regex body (the text between the slashes).
 */
function extractBodyRegex(output: string): RegExp {
  const match = output.match(/\/(.*)\/$/);
  if (!match) {
    throw new Error(`extractBodyRegex: no /.../ body found in ${output}`);
  }
  return new RegExp(`^${match[1]}$`);
}

/**
 * Build a RegExp directly from a fragment that is not wrapped in a `T{n}&/.../`
 * envelope (i.e. the raw output of rangeToRegex / fuseRanges).
 */
function anchored(fragment: string): RegExp {
  return new RegExp(`^${fragment}$`);
}

// ---------------------------------------------------------------------------
// Suite 1: rangeToRegex
// ---------------------------------------------------------------------------

describe('rangeToRegex', () => {
  it('matches the 94..110 range (affix 330 Belt T8)', () => {
    const re = anchored(rangeToRegex(94, 110));
    expect(re.test('94')).toBe(true);
    expect(re.test('100')).toBe(true);
    expect(re.test('110')).toBe(true);
    expect(re.test('93')).toBe(false);
    expect(re.test('111')).toBe(false);
  });

  it('matches a single-value range 5..5', () => {
    const re = anchored(rangeToRegex(5, 5));
    expect(re.test('5')).toBe(true);
    expect(re.test('4')).toBe(false);
    expect(re.test('6')).toBe(false);
  });

  it('matches a full-decade range 10..19', () => {
    const re = anchored(rangeToRegex(10, 19));
    expect(re.test('10')).toBe(true);
    expect(re.test('15')).toBe(true);
    expect(re.test('19')).toBe(true);
    expect(re.test('9')).toBe(false);
    expect(re.test('20')).toBe(false);
  });

  it('matches the 94..129 range (spans two decades)', () => {
    const re = anchored(rangeToRegex(94, 129));
    expect(re.test('94')).toBe(true);
    expect(re.test('110')).toBe(true);
    expect(re.test('129')).toBe(true);
    expect(re.test('93')).toBe(false);
    expect(re.test('130')).toBe(false);
  });

  it('matches the degenerate 0..0 range', () => {
    const re = anchored(rangeToRegex(0, 0));
    expect(re.test('0')).toBe(true);
    expect(re.test('1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: fuseRanges
// ---------------------------------------------------------------------------

describe('fuseRanges', () => {
  it('fuses two disjoint ranges into an alternation', () => {
    const re = anchored(
      fuseRanges([
        { min: 50, max: 60 },
        { min: 94, max: 110 },
      ]),
    );
    expect(re.test('50')).toBe(true);
    expect(re.test('60')).toBe(true);
    expect(re.test('94')).toBe(true);
    expect(re.test('100')).toBe(true);
    expect(re.test('110')).toBe(true);
    // The gap between 60 and 94 should NOT match.
    expect(re.test('70')).toBe(false);
    expect(re.test('49')).toBe(false);
    expect(re.test('111')).toBe(false);
  });

  it('is equivalent to rangeToRegex for a single range', () => {
    const fused = fuseRanges([{ min: 10, max: 14 }]);
    const direct = rangeToRegex(10, 14);
    const reFused = anchored(fused);
    const reDirect = anchored(direct);
    for (const v of ['10', '11', '12', '13', '14']) {
      expect(reFused.test(v)).toBe(true);
      expect(reDirect.test(v)).toBe(true);
    }
    for (const v of ['9', '15']) {
      expect(reFused.test(v)).toBe(false);
      expect(reDirect.test(v)).toBe(false);
    }
  });

  it('merges overlapping ranges into a single span 10..18', () => {
    const re = anchored(
      fuseRanges([
        { min: 10, max: 14 },
        { min: 13, max: 18 },
      ]),
    );
    for (let v = 10; v <= 18; v += 1) {
      expect(re.test(String(v))).toBe(true);
    }
    expect(re.test('9')).toBe(false);
    expect(re.test('19')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: affixToRegex against live affixes.json
// ---------------------------------------------------------------------------

describe('affixToRegex (live affixes.json)', () => {
  const a330 = affixes['330'];
  const a825 = affixes['825'];

  it('loads the live affix 330 (Mana Regeneration) and 825 (hybrid)', () => {
    expect(a330).toBeDefined();
    expect(a330.name).toBe('Mana Regeneration');
    expect(a330.type).toBe('Prefix');
    expect(a330.slots).toEqual(expect.arrayContaining(['Amulet', 'Belt', 'Relic', 'Ring']));
    expect(a825).toBeDefined();
    expect(a825.slots).toEqual(expect.arrayContaining(['Ring']));
  });

  it('affix 330 Belt T8 exact matches only the Belt range', () => {
    const out = affixToRegex(a330, 'Belt', 8, true);
    expect(out.startsWith('T8&/')).toBe(true);
    const re = extractBodyRegex(out);
    expect(re.test('100% increased mana regen')).toBe(true);
    expect(re.test('94% increased mana regen')).toBe(true);
    expect(re.test('110% increased mana regen')).toBe(true);
    expect(re.test('93% increased mana regen')).toBe(false);
    expect(re.test('60% increased mana regen')).toBe(false);
    expect(re.test('111% increased mana regen')).toBe(false);
  });

  it('affix 330 Amulet T8 exact matches only the Amulet range', () => {
    const out = affixToRegex(a330, 'Amulet', 8, true);
    expect(out.startsWith('T8&/')).toBe(true);
    const re = extractBodyRegex(out);
    expect(re.test('110% increased mana regen')).toBe(true);
    expect(re.test('129% increased mana regen')).toBe(true);
    // Belt T8 starts at 94, Amulet T8 starts at 110 — 94 is below Amulet's floor.
    expect(re.test('94% increased mana regen')).toBe(false);
    expect(re.test('130% increased mana regen')).toBe(false);
  });

  it('affix 330 Belt T8 and Amulet T8 regex strings are NOT equal (per-slot scaling)', () => {
    const belt = affixToRegex(a330, 'Belt', 8, true);
    const amulet = affixToRegex(a330, 'Amulet', 8, true);
    expect(belt).not.toBe(amulet);
  });

  it('affix 330 Belt T7+ inclusive matches both T7 and T8 values, rejects T6', () => {
    const out = affixToRegex(a330, 'Belt', 7, false);
    expect(out.startsWith('T7+&/')).toBe(true);
    const re = extractBodyRegex(out);
    // Belt T7 = 50..60, Belt T8 = 94..110.
    expect(re.test('55% increased mana regen')).toBe(true); // T7
    expect(re.test('100% increased mana regen')).toBe(true); // T8
    expect(re.test('45% increased mana regen')).toBe(false); // T6 = 40..49
  });

  it('affix 330 Belt T1 exact matches "12% ..." and rejects "15% ..."', () => {
    const out = affixToRegex(a330, 'Belt', 1, true);
    expect(out.startsWith('T1&/')).toBe(true);
    const re = extractBodyRegex(out);
    // Belt T1 = 10..14, Belt T2 = 15..19.
    expect(re.test('12% increased mana regen')).toBe(true);
    expect(re.test('15% increased mana regen')).toBe(false);
  });

  it('affix 825 hybrid Ring T8 contains alternation and matches both stat lines', () => {
    const out = affixToRegex(a825, 'Ring', 8, true);
    expect(out.startsWith('T8&/')).toBe(true);
    // Hybrid affixes split on " / " and are emitted as "(line1|line2)".
    // Check the raw output (not the extracted body) because '|' may appear
    // inside value alternations too — the presence test is sufficient for
    // the hybrid contract.
    expect(out.includes('|')).toBe(true);

    const re = extractBodyRegex(out);
    // Pull live T8 ranges for the two stat lines so the assertion matches the
    // actual data even if the numbers change in future data updates.
    const ringTiers = a825.perSlotTiers.Ring!;
    const t8 = ringTiers.find((t) => t.tier === 8)!;
    const [healthRange, regenRange] = t8.valueRanges;

    // Pick the midpoint of each range to keep the assertion stable regardless
    // of exact endpoint handling.
    const healthMid = Math.floor((healthRange.min + healthRange.max) / 2);
    const regenMid = Math.floor((regenRange.min + regenRange.max) / 2);

    // The statTemplate for 825 is "+(14-21) Health / +(1-2) Health Regen",
    // which is lowercased to "+X health" / "+X health regen" by the generator.
    expect(re.test(`+${healthMid} health`)).toBe(true);
    expect(re.test(`+${regenMid} health regen`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: error cases
// ---------------------------------------------------------------------------

describe('affixToRegex error cases', () => {
  const a330 = affixes['330'];

  it('throws when the slot is not in affix.slots', () => {
    // Helmet is a real EquipmentSlot but Mana Regeneration does not roll on it.
    expect(() => affixToRegex(a330, 'Helmet' as EquipmentSlot, 8, true)).toThrow(
      /does not roll on slot.*Helmet/,
    );
  });

  it('throws when minTier exceeds the valid 1..8 range (too high)', () => {
    expect(() => affixToRegex(a330, 'Belt', 9, true)).toThrow(/1\.\.8/);
  });

  it('throws when minTier is below the valid 1..8 range (zero)', () => {
    expect(() => affixToRegex(a330, 'Belt', 0, true)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: capped affix (maxTier === 7)
// ---------------------------------------------------------------------------

describe('capped affix (maxTier === 7)', () => {
  const cappedAffix = Object.values(affixes).find((a) => a.maxTier === 7);

  it('finds at least one capped affix in the database', () => {
    expect(cappedAffix).toBeDefined();
  });

  it('succeeds at T7 exact on its first slot', () => {
    expect(cappedAffix).toBeDefined();
    const slot = cappedAffix!.slots[0];
    expect(() => affixToRegex(cappedAffix!, slot, 7, true)).not.toThrow();
  });

  it('throws at T8 exact on its first slot (slot max is T7)', () => {
    expect(cappedAffix).toBeDefined();
    const slot = cappedAffix!.slots[0];
    expect(() => affixToRegex(cappedAffix!, slot, 8, true)).toThrow(/max tier T7/);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: single-T1 affix (maxTier === 1)
// ---------------------------------------------------------------------------

describe('single-T1 affix (maxTier === 1)', () => {
  const specialAffix = Object.values(affixes).find((a) => a.maxTier === 1);

  it('finds at least one single-T1 affix in the database', () => {
    expect(specialAffix).toBeDefined();
  });

  it('returns a "T1&" fragment at T1 exact on its first slot', () => {
    expect(specialAffix).toBeDefined();
    const slot = specialAffix!.slots[0];
    const out = affixToRegex(specialAffix!, slot, 1, true);
    expect(out.startsWith('T1&')).toBe(true);
  });
});
