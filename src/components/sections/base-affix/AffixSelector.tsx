import { useMemo, useState } from 'react';
import { useAffixDb } from '../../../data/affix-runtime';
import type { ProcessedAffix, SelectedAffix } from '../../../types/affix';
import type { EquipmentSlot } from '../../../types/stash-search';
import { renderTierStatLine, tierValueColorClass } from '../../../utils/affix-display';
import { compareAffixMatches, scoreAffixMatch } from '../../../utils/affix-search';
import { AffixTierPicker } from './AffixTierPicker';

interface AffixSelectorProps {
  /** Required — the parent BaseAffixSection only mounts this component
   *  after a slot has been chosen (progressive disclosure), so we no
   *  longer carry the `null` placeholder state here. */
  selectedSlot: EquipmentSlot;
  selectedAffixes: readonly SelectedAffix[];
  onAddAffix: (affixId: number, tier: number, exact: boolean) => void;
}

// Headless: no outer card or header. BaseAffixSection provides the card.

export function AffixSelector({ selectedSlot, selectedAffixes, onAddAffix }: AffixSelectorProps) {
  const { data, loading, error } = useAffixDb();
  const [filter, setFilter] = useState('');

  const { prefixes, suffixes } = useMemo(() => {
    if (data === null) {
      return { prefixes: [] as ProcessedAffix[], suffixes: [] as ProcessedAffix[] };
    }

    // Gather everything in the current slot in one pass.
    const slotAffixes = Object.values(data).filter((affix) => affix.slots.includes(selectedSlot));

    const needle = filter.trim().toLowerCase();

    let sorted: ProcessedAffix[];
    if (needle === '') {
      // No filter → alphabetical by name, same as before the ranked-
      // search refactor. Alphabetical is the right default when the
      // user is browsing rather than searching.
      sorted = slotAffixes.slice().sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Filter → include only affixes whose match score is non-zero,
      // then sort by score DESC with name as the tiebreaker. The
      // scoring lives in affix-search.ts — see that module for the
      // tier table and rationale.
      sorted = slotAffixes
        .filter((affix) => scoreAffixMatch(affix, needle) > 0)
        .sort(compareAffixMatches(needle));
    }

    return {
      prefixes: sorted.filter((a) => a.type === 'Prefix'),
      suffixes: sorted.filter((a) => a.type === 'Suffix'),
    };
  }, [data, selectedSlot, filter]);

  // Dedup check is scoped to the current slot: the same affix on a different
  // slot is a separately-valid selection because per-slot value scaling makes
  // its generated regex distinct. See SelectedAffix.slot docstring.
  const selectedIdsOnSlot = useMemo(
    () => new Set(selectedAffixes.filter((sa) => sa.slot === selectedSlot).map((sa) => sa.affixId)),
    [selectedAffixes, selectedSlot],
  );

  if (loading) {
    return <div className="text-sm text-gray-400">Loading affixes…</div>;
  }
  if (error !== null) {
    return <div className="text-sm text-red-400">Error loading affixes: {error.message}</div>;
  }
  if (data === null) {
    return null;
  }

  return (
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
          <h4 className="text-sm font-medium text-gray-300 mb-2">Prefixes ({prefixes.length})</h4>
          {prefixes.length === 0 ? (
            <div className="text-xs text-gray-500 italic">No prefixes match</div>
          ) : (
            <div>
              {prefixes.map((affix) => (
                <AffixRow
                  key={affix.id}
                  affix={affix}
                  selectedSlot={selectedSlot}
                  disabled={selectedIdsOnSlot.has(affix.id)}
                  onAdd={onAddAffix}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Suffixes ({suffixes.length})</h4>
          {suffixes.length === 0 ? (
            <div className="text-xs text-gray-500 italic">No suffixes match</div>
          ) : (
            <div>
              {suffixes.map((affix) => (
                <AffixRow
                  key={affix.id}
                  affix={affix}
                  selectedSlot={selectedSlot}
                  disabled={selectedIdsOnSlot.has(affix.id)}
                  onAdd={onAddAffix}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface AffixRowProps {
  affix: ProcessedAffix;
  /** Slot the parent is filtering by. Needed to resolve per-slot value
   *  ranges in the stat preview, since the same affix can have
   *  different numeric values on different slots. */
  selectedSlot: EquipmentSlot;
  disabled: boolean;
  onAdd: (affixId: number, tier: number, exact: boolean) => void;
}

function AffixRow({ affix, selectedSlot, disabled, onAdd }: AffixRowProps) {
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [exact, setExact] = useState<boolean>(false);

  const handleTierChange = (tier: number, nextExact: boolean): void => {
    setSelectedTier(tier);
    setExact(nextExact);
  };

  const handleAdd = (): void => {
    onAdd(affix.id, selectedTier, exact);
  };

  // Tokenized stat preview that reflects the currently picked tier's
  // actual values on the current slot. Recomputed on every tier change
  // via the row-local selectedTier state so the user sees T5 ranges
  // when they pick T5 instead of the stale PoB T1 placeholder. The
  // value-color tier threshold (T6+) picks up the LE "exalted" color
  // convention — see tierValueColorClass docs.
  const statTokens = renderTierStatLine(affix, selectedSlot, selectedTier);
  const valueColorClass = tierValueColorClass(selectedTier);

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
        <div className="text-xs text-gray-400 truncate">
          {statTokens.map((token, i) =>
            token.kind === 'value' ? (
              <span key={i} className={valueColorClass}>
                {token.text}
              </span>
            ) : (
              <span key={i}>{token.text}</span>
            ),
          )}
        </div>
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
