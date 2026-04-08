import { describe, expect, it } from 'vitest';
import type { ProcessedAffix, ProcessedTier } from '../types/affix';
import { renderTierStatLine, tierValueColorClass } from './affix-display';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tier(t: number, valueRanges: { min: number; max: number }[]): ProcessedTier {
  return { tier: t, valueRanges, level: 0 };
}

/**
 * Minimal ProcessedAffix factory for display tests. Only `statTemplate`
 * and `perSlotTiers` matter to `renderTierStatLine`; everything else is
 * stubbed cheaply.
 */
function makeAffix(
  statTemplate: string,
  perSlotTiers: ProcessedAffix['perSlotTiers'],
): ProcessedAffix {
  return {
    id: 0,
    name: 'Test Affix',
    nickname: null,
    type: 'Prefix',
    category: 'Normal Affix',
    statOrderKey: 0,
    classRequirement: [],
    levelRequirement: null,
    slots: Object.keys(perSlotTiers) as ProcessedAffix['slots'],
    statTemplate,
    perSlotTiers,
    maxTier: 8,
  };
}

// Shortcut: extract the `text` fields from a token stream in order so
// tests can assert "the rendered stat line, reconstructed" without
// caring about the token boundaries.
function flatten(tokens: readonly { text: string }[]): string {
  return tokens.map((t) => t.text).join('');
}

// ---------------------------------------------------------------------------
// renderTierStatLine — single-stat affixes
// ---------------------------------------------------------------------------

describe('renderTierStatLine — single stat', () => {
  const manaRegen = makeAffix('(10-14)% increased Mana Regen', {
    Belt: [
      tier(1, [{ min: 10, max: 14 }]),
      tier(5, [{ min: 41, max: 48 }]),
      tier(8, [{ min: 94, max: 110 }]),
    ],
  });

  it('substitutes the (min-max) placeholder with the T1 range', () => {
    const tokens = renderTierStatLine(manaRegen, 'Belt', 1);
    expect(flatten(tokens)).toBe('(10-14)% increased Mana Regen');
  });

  it('substitutes the placeholder with the T5 range', () => {
    const tokens = renderTierStatLine(manaRegen, 'Belt', 5);
    expect(flatten(tokens)).toBe('(41-48)% increased Mana Regen');
  });

  it('substitutes the placeholder with the T8 (primordial) range', () => {
    const tokens = renderTierStatLine(manaRegen, 'Belt', 8);
    expect(flatten(tokens)).toBe('(94-110)% increased Mana Regen');
  });

  it('tags the substituted range as a "value" token and the rest as "text"', () => {
    const tokens = renderTierStatLine(manaRegen, 'Belt', 5);
    expect(tokens).toEqual([
      { kind: 'value', text: '(41-48)' },
      { kind: 'text', text: '% increased Mana Regen' },
    ]);
  });

  it('collapses min === max to a bare number rather than a degenerate range', () => {
    const flatFive = makeAffix('+(5-5) Health', {
      Belt: [tier(1, [{ min: 5, max: 5 }])],
    });
    const tokens = renderTierStatLine(flatFive, 'Belt', 1);
    expect(flatten(tokens)).toBe('+5 Health');
  });
});

// ---------------------------------------------------------------------------
// renderTierStatLine — hybrid affixes (two stat lines joined by " / ")
// ---------------------------------------------------------------------------

describe('renderTierStatLine — hybrid', () => {
  const armorAndMana = makeAffix('(5-12)% increased Armor / (5-12)% increased Mana', {
    Belt: [
      tier(1, [
        { min: 5, max: 12 },
        { min: 5, max: 12 },
      ]),
      tier(5, [
        { min: 30, max: 45 },
        { min: 30, max: 45 },
      ]),
    ],
  });

  it('substitutes both stat lines independently at their matching valueRanges', () => {
    const tokens = renderTierStatLine(armorAndMana, 'Belt', 5);
    expect(flatten(tokens)).toBe('(30-45)% increased Armor / (30-45)% increased Mana');
  });

  it('preserves the " / " separator as a text token between lines', () => {
    const tokens = renderTierStatLine(armorAndMana, 'Belt', 1);
    const separatorTokens = tokens.filter((t) => t.text === ' / ');
    expect(separatorTokens).toHaveLength(1);
    expect(separatorTokens[0].kind).toBe('text');
  });

  it('emits multiple "value" tokens for a hybrid, one per stat line', () => {
    const tokens = renderTierStatLine(armorAndMana, 'Belt', 5);
    const valueTokens = tokens.filter((t) => t.kind === 'value');
    expect(valueTokens).toHaveLength(2);
    expect(valueTokens.every((t) => t.text === '(30-45)')).toBe(true);
  });

  it('falls back to the first valueRange when hybrid shape mismatches stat lines', () => {
    // valueRanges has only one entry but statTemplate has two stat lines
    // — treat it as a degenerate single-range source and reuse it for
    // every line rather than crashing with an OOB read.
    const broken = makeAffix('(1-2)% A / (3-4)% B', {
      Belt: [tier(1, [{ min: 5, max: 5 }])],
    });
    const tokens = renderTierStatLine(broken, 'Belt', 1);
    expect(flatten(tokens)).toBe('5% A / 5% B');
  });
});

// ---------------------------------------------------------------------------
// renderTierStatLine — fallbacks & edge cases
// ---------------------------------------------------------------------------

describe('renderTierStatLine — fallbacks', () => {
  it('renders the raw statTemplate when the slot has no tier data', () => {
    const affix = makeAffix('(10-14)% increased Mana Regen', {
      // Belt is the only slot with tier data — request Amulet instead.
      Belt: [tier(1, [{ min: 10, max: 14 }])],
    });
    const tokens = renderTierStatLine(affix, 'Amulet', 1);
    expect(tokens).toEqual([{ kind: 'text', text: '(10-14)% increased Mana Regen' }]);
  });

  it('renders the raw statTemplate when the slot exists but the requested tier is missing', () => {
    const affix = makeAffix('(10-14)% increased Mana Regen', {
      Belt: [tier(1, [{ min: 10, max: 14 }])],
    });
    const tokens = renderTierStatLine(affix, 'Belt', 8); // no T8 data
    expect(tokens).toEqual([{ kind: 'text', text: '(10-14)% increased Mana Regen' }]);
  });

  it('substitutes a standalone integer when there is no (min-max) placeholder', () => {
    // Some T1-only special affixes just have a bare number in the
    // template, e.g. "+5 Health" rather than "+(5-5) Health". Verify
    // the fallback regex picks it up.
    const bareNumber = makeAffix('+5 Health', {
      Belt: [tier(1, [{ min: 8, max: 12 }])],
    });
    const tokens = renderTierStatLine(bareNumber, 'Belt', 1);
    expect(flatten(tokens)).toBe('+(8-12) Health');
  });

  it('leaves text unchanged when there is no number or placeholder at all', () => {
    const noNumbers = makeAffix('Adds a void skill', {
      Belt: [tier(1, [{ min: 0, max: 0 }])],
    });
    const tokens = renderTierStatLine(noNumbers, 'Belt', 1);
    expect(flatten(tokens)).toBe('Adds a void skill');
    // No value token should be emitted.
    expect(tokens.every((t) => t.kind === 'text')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tierValueColorClass
// ---------------------------------------------------------------------------

describe('tierValueColorClass', () => {
  it('returns the gray-100 class for T1-T5 (normal tiers)', () => {
    for (const t of [1, 2, 3, 4, 5]) {
      expect(tierValueColorClass(t)).toContain('text-gray-100');
    }
  });

  it('returns the fuchsia class for T6-T8 (exalted + primordial)', () => {
    for (const t of [6, 7, 8]) {
      expect(tierValueColorClass(t)).toContain('text-fuchsia-400');
    }
  });

  it('marks exalted tiers with a bolder weight than normal tiers', () => {
    expect(tierValueColorClass(5)).toContain('font-medium');
    expect(tierValueColorClass(6)).toContain('font-semibold');
  });
});
