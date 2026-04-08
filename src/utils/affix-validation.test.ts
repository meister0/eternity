import { describe, expect, it } from 'vitest';
import type { AffixDb, ProcessedAffix, SelectedAffix } from '../types/affix';
import type { EquipmentSlot } from '../types/stash-search';
import { collectConflictedIndices, validateSelectedAffixes } from './affix-validation';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal ProcessedAffix for tests. Only fields that the validator
 * actually reads are populated meaningfully; the rest are stubbed. Keeps
 * individual test cases readable.
 */
function makeAffix(
  overrides: Pick<ProcessedAffix, 'id' | 'name' | 'type' | 'statOrderKey'> &
    Partial<ProcessedAffix>,
): ProcessedAffix {
  return {
    nickname: null,
    category: 'Normal Affix',
    classRequirement: [],
    levelRequirement: null,
    slots: [],
    statTemplate: '',
    perSlotTiers: {},
    maxTier: 8,
    ...overrides,
  } as ProcessedAffix;
}

function selected(affixId: number, slot: EquipmentSlot, minTier = 1, exact = false): SelectedAffix {
  return { affixId, slot, minTier, exact };
}

function db(...affixes: ProcessedAffix[]): AffixDb {
  const record: Record<number, ProcessedAffix> = {};
  for (const a of affixes) record[a.id] = a;
  return record;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateSelectedAffixes', () => {
  it('returns [] when DB is still loading (null)', () => {
    const warnings = validateSelectedAffixes([selected(1, 'Belt')], null, '&');
    expect(warnings).toEqual([]);
  });

  it('returns [] when no affixes are selected', () => {
    expect(validateSelectedAffixes([], db(), '&')).toEqual([]);
    expect(validateSelectedAffixes([], db(), '|')).toEqual([]);
  });

  it('returns [] for a single affix with no issues', () => {
    const affix = makeAffix({ id: 1, name: 'Mana Regen', type: 'Prefix', statOrderKey: 100 });
    const warnings = validateSelectedAffixes([selected(1, 'Belt')], db(affix), '&');
    expect(warnings).toEqual([]);
  });

  it('flags orphan affixId regardless of mode', () => {
    const affix = makeAffix({ id: 1, name: 'Known', type: 'Prefix', statOrderKey: 100 });
    const state: SelectedAffix[] = [selected(1, 'Belt'), selected(9999, 'Belt')];

    const andWarnings = validateSelectedAffixes(state, db(affix), '&');
    const orWarnings = validateSelectedAffixes(state, db(affix), '|');

    expect(andWarnings).toHaveLength(1);
    expect(andWarnings[0].severity).toBe('info');
    expect(andWarnings[0].affectedIndices).toEqual([1]);
    expect(andWarnings[0].title).toContain('1 affix is missing');
    expect(andWarnings[0].action?.kind).toBe('remove-indices');

    // OR mode must produce the same orphan warning.
    expect(orWarnings).toHaveLength(1);
    expect(orWarnings[0].severity).toBe('info');
    expect(orWarnings[0].affectedIndices).toEqual([1]);
  });

  it('aggregates multiple orphans into one info warning with pluralized title', () => {
    const warnings = validateSelectedAffixes(
      [selected(7000, 'Belt'), selected(7001, 'Amulet'), selected(7002, 'Ring')],
      db(),
      '&',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].title).toContain('3 affixes are missing');
    expect(warnings[0].affectedIndices).toEqual([0, 1, 2]);
  });

  describe('statOrderKey collisions', () => {
    it('flags two affixes sharing statOrderKey on the same slot in AND mode', () => {
      const a = makeAffix({ id: 1, name: 'Mana Regen', type: 'Prefix', statOrderKey: 50 });
      const b = makeAffix({ id: 2, name: 'Rejuvenating', type: 'Prefix', statOrderKey: 50 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Belt')],
        db(a, b),
        '&',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warning');
      expect(warnings[0].title).toContain('Mutually-exclusive');
      expect(warnings[0].affectedIndices).toEqual([0, 1]);
      expect(warnings[0].message).toContain('"Mana Regen" and "Rejuvenating"');
    });

    it('does NOT flag statOrderKey collisions in OR mode', () => {
      const a = makeAffix({ id: 1, name: 'Mana Regen', type: 'Prefix', statOrderKey: 50 });
      const b = makeAffix({ id: 2, name: 'Rejuvenating', type: 'Prefix', statOrderKey: 50 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Belt')],
        db(a, b),
        '|',
      );
      expect(warnings).toEqual([]);
    });

    it('does NOT flag statOrderKey collisions across different slots (cross-slot is a separate concern)', () => {
      const a = makeAffix({ id: 1, name: 'Mana Regen', type: 'Prefix', statOrderKey: 50 });
      const b = makeAffix({ id: 2, name: 'Rejuvenating', type: 'Prefix', statOrderKey: 50 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Amulet')],
        db(a, b),
        '&',
      );
      expect(warnings).toEqual([]);
    });

    it('handles 3+ affixes in the same mutual-exclusion bucket as one aggregate warning', () => {
      // Mix 2 Prefixes + 1 Suffix so the per-type count rule never trips
      // (2 prefixes on Belt is fine; 1 suffix on Belt is fine). This
      // isolates the collision rule and proves it aggregates the whole
      // bucket into a single warning rather than emitting pairwise ones.
      const a = makeAffix({ id: 1, name: 'A', type: 'Prefix', statOrderKey: 50 });
      const b = makeAffix({ id: 2, name: 'B', type: 'Prefix', statOrderKey: 50 });
      const c = makeAffix({ id: 3, name: 'C', type: 'Suffix', statOrderKey: 50 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Belt'), selected(3, 'Belt')],
        db(a, b, c),
        '&',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].title).toContain('Mutually-exclusive');
      expect(warnings[0].affectedIndices).toEqual([0, 1, 2]);
      expect(warnings[0].message).toContain('"A", "B", and "C"');
    });
  });

  describe('prefix/suffix count limits', () => {
    it('flags >2 prefixes on the same slot in AND mode', () => {
      const a = makeAffix({ id: 1, name: 'A', type: 'Prefix', statOrderKey: 10 });
      const b = makeAffix({ id: 2, name: 'B', type: 'Prefix', statOrderKey: 11 });
      const c = makeAffix({ id: 3, name: 'C', type: 'Prefix', statOrderKey: 12 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Belt'), selected(3, 'Belt')],
        db(a, b, c),
        '&',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warning');
      expect(warnings[0].title).toContain('3 prefixes on Belt');
      expect(warnings[0].affectedIndices).toEqual([0, 1, 2]);
    });

    it('flags >2 suffixes on the same slot in AND mode', () => {
      const a = makeAffix({ id: 1, name: 'A', type: 'Suffix', statOrderKey: 10 });
      const b = makeAffix({ id: 2, name: 'B', type: 'Suffix', statOrderKey: 11 });
      const c = makeAffix({ id: 3, name: 'C', type: 'Suffix', statOrderKey: 12 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Belt'), selected(3, 'Belt')],
        db(a, b, c),
        '&',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].title).toContain('3 suffixes on Belt');
    });

    it('does NOT flag >2 prefixes in OR mode', () => {
      const a = makeAffix({ id: 1, name: 'A', type: 'Prefix', statOrderKey: 10 });
      const b = makeAffix({ id: 2, name: 'B', type: 'Prefix', statOrderKey: 11 });
      const c = makeAffix({ id: 3, name: 'C', type: 'Prefix', statOrderKey: 12 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Belt'), selected(3, 'Belt')],
        db(a, b, c),
        '|',
      );
      expect(warnings).toEqual([]);
    });

    it('does NOT flag 2 prefixes — exactly at the limit is fine', () => {
      const a = makeAffix({ id: 1, name: 'A', type: 'Prefix', statOrderKey: 10 });
      const b = makeAffix({ id: 2, name: 'B', type: 'Prefix', statOrderKey: 11 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Belt')],
        db(a, b),
        '&',
      );
      expect(warnings).toEqual([]);
    });

    it('does NOT flag 3 prefixes when they are on different slots', () => {
      const a = makeAffix({ id: 1, name: 'A', type: 'Prefix', statOrderKey: 10 });
      const b = makeAffix({ id: 2, name: 'B', type: 'Prefix', statOrderKey: 11 });
      const c = makeAffix({ id: 3, name: 'C', type: 'Prefix', statOrderKey: 12 });
      const warnings = validateSelectedAffixes(
        [selected(1, 'Belt'), selected(2, 'Amulet'), selected(3, 'Ring')],
        db(a, b, c),
        '&',
      );
      expect(warnings).toEqual([]);
    });
  });

  it('emits multiple warnings when several rules fire simultaneously', () => {
    // 3 prefixes on Belt, two of which share statOrderKey = collision + count warning.
    const a = makeAffix({ id: 1, name: 'A', type: 'Prefix', statOrderKey: 50 });
    const b = makeAffix({ id: 2, name: 'B', type: 'Prefix', statOrderKey: 50 });
    const c = makeAffix({ id: 3, name: 'C', type: 'Prefix', statOrderKey: 99 });
    const warnings = validateSelectedAffixes(
      [selected(1, 'Belt'), selected(2, 'Belt'), selected(3, 'Belt')],
      db(a, b, c),
      '&',
    );
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    const titles = warnings.map((w) => w.title);
    expect(titles.some((t) => t.includes('Mutually-exclusive'))).toBe(true);
    expect(titles.some((t) => t.includes('3 prefixes on Belt'))).toBe(true);
  });

  it('orphan + AND rules can co-exist in the same pass', () => {
    const a = makeAffix({ id: 1, name: 'A', type: 'Prefix', statOrderKey: 50 });
    const b = makeAffix({ id: 2, name: 'B', type: 'Prefix', statOrderKey: 50 });
    const warnings = validateSelectedAffixes(
      [selected(1, 'Belt'), selected(2, 'Belt'), selected(9999, 'Belt')],
      db(a, b),
      '&',
    );
    expect(warnings).toHaveLength(2);
    const [orphan, collision] = warnings;
    expect(orphan.severity).toBe('info');
    expect(orphan.affectedIndices).toEqual([2]);
    expect(collision.severity).toBe('warning');
    expect(collision.affectedIndices).toEqual([0, 1]);
  });
});

describe('collectConflictedIndices', () => {
  it('returns empty set for no warnings', () => {
    expect(collectConflictedIndices([])).toEqual(new Set<number>());
  });

  it('unions all affectedIndices from warning-severity entries', () => {
    const result = collectConflictedIndices([
      {
        id: 'a',
        severity: 'warning',
        title: 'x',
        message: 'x',
        affectedIndices: [0, 1],
      },
      {
        id: 'b',
        severity: 'warning',
        title: 'y',
        message: 'y',
        affectedIndices: [1, 2],
      },
    ]);
    expect(result).toEqual(new Set([0, 1, 2]));
  });

  it('excludes info-severity warnings (orphans render their own state)', () => {
    const result = collectConflictedIndices([
      {
        id: 'o',
        severity: 'info',
        title: 'x',
        message: 'x',
        affectedIndices: [5],
      },
      {
        id: 'w',
        severity: 'warning',
        title: 'y',
        message: 'y',
        affectedIndices: [2],
      },
    ]);
    expect(result).toEqual(new Set([2]));
  });
});
