import { describe, expect, it, vi } from 'vitest';
import type { SelectedAffix } from '../types/affix';
import { decodeSelectedAffixes, encodeSelectedAffixes } from './url-state';

describe('url-state selected-affix encoding', () => {
  it('encodes a single SelectedAffix as <id>:<slot>:<tier><=|+>', () => {
    const affixes: SelectedAffix[] = [{ affixId: 330, slot: 'Belt', minTier: 8, exact: true }];
    expect(encodeSelectedAffixes(affixes)).toBe('330:Belt:8=');
  });

  it('uses "+" suffix for inclusive (exact=false)', () => {
    const affixes: SelectedAffix[] = [{ affixId: 330, slot: 'Belt', minTier: 6, exact: false }];
    expect(encodeSelectedAffixes(affixes)).toBe('330:Belt:6+');
  });

  it('encodes multiple entries with comma separator', () => {
    const affixes: SelectedAffix[] = [
      { affixId: 330, slot: 'Belt', minTier: 8, exact: true },
      { affixId: 330, slot: 'Amulet', minTier: 7, exact: false },
    ];
    expect(encodeSelectedAffixes(affixes)).toBe('330:Belt:8=,330:Amulet:7+');
  });

  it('round-trips through encode → decode preserving identity', () => {
    const original: SelectedAffix[] = [
      { affixId: 0, slot: '1HSword', minTier: 1, exact: true },
      { affixId: 330, slot: 'Belt', minTier: 8, exact: false },
      { affixId: 42, slot: 'Altar', minTier: 1, exact: false },
    ];
    const encoded = encodeSelectedAffixes(original);
    const decoded = decodeSelectedAffixes(encoded);
    expect(decoded).toEqual(original);
  });

  it('decodes compound slot names like "1HSword" correctly', () => {
    const decoded = decodeSelectedAffixes('42:1HSword:5+');
    expect(decoded).toEqual([{ affixId: 42, slot: '1HSword', minTier: 5, exact: false }]);
  });

  it('returns [] for null / undefined / empty input', () => {
    expect(decodeSelectedAffixes(null)).toEqual([]);
    expect(decodeSelectedAffixes(undefined)).toEqual([]);
    expect(decodeSelectedAffixes('')).toEqual([]);
  });

  it('rejects old-format tokens lacking a slot segment', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Old format was "<id>:<tier><suffix>" — should be discarded, not upgraded.
    expect(decodeSelectedAffixes('330:8=')).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects tokens whose slot string is not an EquipmentSlot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeSelectedAffixes('330:NotASlot:8=')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown slot'));
    warn.mockRestore();
  });

  it('rejects tokens with out-of-range tier', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeSelectedAffixes('330:Belt:9=')).toEqual([]); // T9 doesn't exist
    expect(decodeSelectedAffixes('330:Belt:0=')).toEqual([]); // T0 doesn't exist
    warn.mockRestore();
  });

  it('drops malformed tokens but preserves adjacent valid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoded = decodeSelectedAffixes('330:Belt:8=,garbage,42:Amulet:5+');
    expect(decoded).toEqual([
      { affixId: 330, slot: 'Belt', minTier: 8, exact: true },
      { affixId: 42, slot: 'Amulet', minTier: 5, exact: false },
    ]);
    warn.mockRestore();
  });
});
