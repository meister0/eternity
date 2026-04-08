import { useMemo, useState } from 'react';
import { useAffixDb } from '../../../data/affix-runtime';
import type { ProcessedAffix, SelectedAffix } from '../../../types/affix';
import type { EquipmentSlot } from '../../../types/stash-search';
import { SectionContainer, SectionHeader } from '../../ui';
import { AffixTierPicker } from './AffixTierPicker';

interface AffixSelectorProps {
  selectedSlot: EquipmentSlot | null;
  selectedAffixes: readonly SelectedAffix[];
  onAddAffix: (affixId: number, tier: number, exact: boolean) => void;
}

export function AffixSelector({ selectedSlot, selectedAffixes, onAddAffix }: AffixSelectorProps) {
  const { data, loading, error } = useAffixDb();
  const [filter, setFilter] = useState('');

  const { prefixes, suffixes } = useMemo(() => {
    if (data === null || selectedSlot === null) {
      return { prefixes: [] as ProcessedAffix[], suffixes: [] as ProcessedAffix[] };
    }
    const needle = filter.trim().toLowerCase();
    const matches = (affix: ProcessedAffix): boolean => {
      if (needle === '') return true;
      if (affix.name.toLowerCase().includes(needle)) return true;
      if (affix.nickname !== null && affix.nickname.toLowerCase().includes(needle)) {
        return true;
      }
      return false;
    };

    const all = Object.values(data).filter(
      (affix) => affix.slots.includes(selectedSlot) && matches(affix),
    );
    const sortByName = (a: ProcessedAffix, b: ProcessedAffix): number =>
      a.name.localeCompare(b.name);

    return {
      prefixes: all
        .filter((a) => a.type === 'Prefix')
        .slice()
        .sort(sortByName),
      suffixes: all
        .filter((a) => a.type === 'Suffix')
        .slice()
        .sort(sortByName),
    };
  }, [data, selectedSlot, filter]);

  const selectedIds = useMemo(
    () => new Set(selectedAffixes.map((sa) => sa.affixId)),
    [selectedAffixes],
  );

  return (
    <SectionContainer className="mb-6 md:mb-8">
      <SectionHeader>Add Affix</SectionHeader>

      {selectedSlot === null && (
        <div className="text-sm text-gray-500 italic">Pick a slot first</div>
      )}

      {selectedSlot !== null && loading && (
        <div className="text-sm text-gray-400">Loading affixes...</div>
      )}

      {selectedSlot !== null && error !== null && (
        <div className="text-sm text-red-400">Error loading affixes: {error.message}</div>
      )}

      {selectedSlot !== null && !loading && error === null && data !== null && (
        <>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or nickname..."
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 focus:border-amber-400 focus:outline-none mb-3"
          />

          <div className="max-h-96 overflow-y-auto">
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-300 mb-2">
                Prefixes ({prefixes.length})
              </h4>
              {prefixes.length === 0 ? (
                <div className="text-xs text-gray-500 italic">No prefixes match</div>
              ) : (
                <div>
                  {prefixes.map((affix) => (
                    <AffixRow
                      key={affix.id}
                      affix={affix}
                      disabled={selectedIds.has(affix.id)}
                      onAdd={onAddAffix}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-2">
                Suffixes ({suffixes.length})
              </h4>
              {suffixes.length === 0 ? (
                <div className="text-xs text-gray-500 italic">No suffixes match</div>
              ) : (
                <div>
                  {suffixes.map((affix) => (
                    <AffixRow
                      key={affix.id}
                      affix={affix}
                      disabled={selectedIds.has(affix.id)}
                      onAdd={onAddAffix}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </SectionContainer>
  );
}

interface AffixRowProps {
  affix: ProcessedAffix;
  disabled: boolean;
  onAdd: (affixId: number, tier: number, exact: boolean) => void;
}

function AffixRow({ affix, disabled, onAdd }: AffixRowProps) {
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [exact, setExact] = useState<boolean>(false);

  const handleTierChange = (tier: number, nextExact: boolean): void => {
    setSelectedTier(tier);
    setExact(nextExact);
  };

  const handleAdd = (): void => {
    onAdd(affix.id, selectedTier, exact);
  };

  return (
    <div
      className={`flex items-center gap-3 py-2 border-b border-gray-700 ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-100 truncate">
          {affix.name}
          {affix.nickname !== null && (
            <span className="ml-2 text-xs text-gray-400">{affix.nickname}</span>
          )}
        </div>
        <div className="text-xs text-gray-400 truncate">{affix.statTemplate}</div>
      </div>
      <div className="flex-shrink-0">
        <AffixTierPicker
          maxTier={affix.maxTier}
          selectedTier={selectedTier}
          exact={exact}
          onTierChange={handleTierChange}
        />
      </div>
      <button
        type="button"
        onClick={handleAdd}
        disabled={disabled}
        className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-xs font-medium cursor-pointer disabled:cursor-not-allowed disabled:hover:bg-amber-600"
      >
        Add
      </button>
    </div>
  );
}
