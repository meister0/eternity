import { useState } from 'react';
import { useAffixDb } from '../../../data/affix-runtime';
import { EQUIPMENT_SLOT_MACROS } from '../../../data/stash-macros';
import type { ProcessedAffix, SelectedAffix } from '../../../types/affix';
import type { EquipmentSlot, ExpressionOperator } from '../../../types/stash-search';
import { SectionContainer, SectionHeader } from '../../ui';

/** Lookup map from EquipmentSlot literal → human-readable label
 *  (e.g. "1HSword" → "1H Sword"). Built once at module load from the
 *  canonical slot group definition used throughout the UI so every slot
 *  display stays in sync. */
const SLOT_LABEL: Readonly<Record<EquipmentSlot, string>> = Object.freeze(
  EQUIPMENT_SLOT_MACROS.reduce(
    (acc, group) => {
      for (const item of group.items) {
        acc[item.value] = item.label;
      }
      return acc;
    },
    {} as Record<EquipmentSlot, string>,
  ),
);

interface SelectedAffixListProps {
  selectedAffixes: readonly SelectedAffix[];
  /** Current global boolean operator from the parent's SearchState. Drives
   *  the mode-aware subtitle under the section header so the user can see
   *  the semantic meaning of their current selection (AND vs OR). */
  globalOperator: ExpressionOperator;
  /** Indices into `selectedAffixes` that a validation rule flagged as
   *  conflicting with another chip. Highlighted with an amber ring so the
   *  user can visually locate the chips the warning block is talking about.
   *  Orphan ("Unknown affix") chips are NOT in this set — they render their
   *  own italic-muted state already. */
  conflictedIndices: ReadonlySet<number>;
  onRemove: (index: number) => void;
  onEditTier: (index: number, tier: number, exact: boolean) => void;
}

/** Short human-readable explanation of what the current globalOperator
 *  means for the user's affix selection. Rendered under the section
 *  header — this is the discoverability hint for the output-bar toggle
 *  from the UX validation pass (see PLAN.md §0.5 Phase 5.2 notes). */
function modeSubtitle(operator: ExpressionOperator): string {
  return operator === '&'
    ? 'all must be present on the item (AND)'
    : 'items matching any of these (OR)';
}

const MAX_NAME_LENGTH = 30;

function truncateName(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  return `${name.slice(0, MAX_NAME_LENGTH - 1)}\u2026`;
}

function tierLabel(selected: SelectedAffix): string {
  return selected.exact ? `T${selected.minTier}` : `T${selected.minTier}+`;
}

export function SelectedAffixList({
  selectedAffixes,
  globalOperator,
  conflictedIndices,
  onRemove,
  onEditTier,
}: SelectedAffixListProps) {
  const { data, loading, error } = useAffixDb();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const subtitle = modeSubtitle(globalOperator);

  if (error) {
    return (
      <SectionContainer>
        <SectionHeader>Selected Affixes</SectionHeader>
        <p className="text-sm text-red-400">Failed to load affixes: {error.message}</p>
      </SectionContainer>
    );
  }

  if (selectedAffixes.length === 0) {
    return (
      <SectionContainer>
        <SectionHeader>Selected Affixes</SectionHeader>
        <p className="text-sm text-gray-500 italic">No affixes selected yet</p>
      </SectionContainer>
    );
  }

  const isLoading = loading && data === null;

  const handleBumpTier = (
    index: number,
    selected: SelectedAffix,
    affix: ProcessedAffix | null,
    delta: number,
  ) => {
    const max = affix?.maxTier ?? 8;
    const next = Math.min(max, Math.max(1, selected.minTier + delta));
    if (next === selected.minTier) return;
    onEditTier(index, next, selected.exact);
  };

  const handleToggleExact = (index: number, selected: SelectedAffix) => {
    onEditTier(index, selected.minTier, !selected.exact);
  };

  const handleRemove = (index: number) => {
    if (editingIndex === index) setEditingIndex(null);
    onRemove(index);
  };

  return (
    <SectionContainer>
      <SectionHeader>Selected Affixes</SectionHeader>
      <p className="-mt-2 mb-3 text-xs font-normal text-gray-500">{subtitle}</p>
      <div className="flex flex-wrap gap-2">
        {selectedAffixes.map((selected, index) => {
          const isConflicted = conflictedIndices.has(index);
          const affix = data ? (data[selected.affixId] ?? null) : null;
          const isUnknown = !isLoading && data !== null && affix === null;
          const displayName = isLoading
            ? 'Loading\u2026'
            : affix
              ? truncateName(affix.name)
              : `Unknown affix #${selected.affixId}`;
          const dotClass =
            affix?.type === 'Suffix'
              ? 'bg-sky-400'
              : affix?.type === 'Prefix'
                ? 'bg-amber-400'
                : 'bg-gray-500';
          const isEditing = editingIndex === index;

          return (
            <div
              key={`${selected.affixId}-${index}`}
              className={`rounded-full bg-gray-700 px-3 py-1 text-xs flex items-center gap-2 ${
                isConflicted ? 'ring-2 ring-amber-500/70' : ''
              }`}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full ${dotClass}`}
                aria-hidden="true"
              />
              <span
                className={`text-gray-100 ${isUnknown ? 'italic text-gray-400' : ''}`}
                title={affix?.name ?? undefined}
              >
                {displayName}
              </span>
              <span
                className="inline-flex items-center rounded bg-gray-600/70 px-1.5 text-[10px] font-medium text-gray-300"
                title={`Slot: ${SLOT_LABEL[selected.slot] ?? selected.slot}`}
              >
                {SLOT_LABEL[selected.slot] ?? selected.slot}
              </span>
              {isEditing && !isLoading ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleBumpTier(index, selected, affix, -1)}
                    disabled={selected.minTier <= 1}
                    className="px-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    aria-label="Decrease tier"
                  >
                    -
                  </button>
                  <span className="text-gray-100 min-w-[2ch] text-center">
                    {tierLabel(selected)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleBumpTier(index, selected, affix, 1)}
                    disabled={selected.minTier >= (affix?.maxTier ?? 8)}
                    className="px-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    aria-label="Increase tier"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleExact(index, selected)}
                    className={`px-1.5 rounded cursor-pointer ${
                      selected.exact
                        ? 'bg-amber-600 hover:bg-amber-700 text-white'
                        : 'bg-gray-600 hover:bg-gray-500 text-gray-100'
                    }`}
                    aria-pressed={selected.exact}
                  >
                    exact
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingIndex(null)}
                    className="px-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-100 cursor-pointer"
                  >
                    Done
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => !isLoading && setEditingIndex(index)}
                  disabled={isLoading}
                  className="text-gray-300 hover:text-amber-400 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Edit tier"
                >
                  {tierLabel(selected)}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="text-gray-400 hover:text-red-400 cursor-pointer"
                aria-label="Remove affix"
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>
    </SectionContainer>
  );
}
