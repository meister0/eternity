import { useState } from 'react';
import { useAffixDb } from '../../../data/affix-runtime';
import type { ProcessedAffix, SelectedAffix } from '../../../types/affix';
import { SectionContainer, SectionHeader } from '../../ui';

interface SelectedAffixListProps {
  selectedAffixes: readonly SelectedAffix[];
  onRemove: (index: number) => void;
  onEditTier: (index: number, tier: number, exact: boolean) => void;
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
  onRemove,
  onEditTier,
}: SelectedAffixListProps) {
  const { data, loading, error } = useAffixDb();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

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
      <div className="flex flex-wrap gap-2">
        {selectedAffixes.map((selected, index) => {
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
              className="rounded-full bg-gray-700 px-3 py-1 text-xs flex items-center gap-2"
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
