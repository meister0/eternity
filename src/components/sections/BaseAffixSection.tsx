import { useCallback, useMemo, useState } from 'react';
import { useAffixDb } from '../../data/affix-runtime';
import type { SelectedAffix } from '../../types/affix';
import type { EquipmentSlot, ExpressionOperator } from '../../types/stash-search';
import { collectConflictedIndices, validateSelectedAffixes } from '../../utils/affix-validation';
import { AffixSelector } from './base-affix/AffixSelector';
import { AffixWarnings } from './base-affix/AffixWarnings';
import { BasePicker } from './base-affix/BasePicker';
import { SelectedAffixList } from './base-affix/SelectedAffixList';
import { SlotPicker } from './base-affix/SlotPicker';

interface BaseAffixSectionProps {
  selectedAffixes: readonly SelectedAffix[];
  /** Current global boolean operator from the parent's SearchState. Drives
   *  mode-aware validation (statOrderKey collisions and prefix/suffix count
   *  limits only fire in `&` mode) and the SelectedAffixList subtitle. */
  globalOperator: ExpressionOperator;
  onSelectedAffixesChange: (next: readonly SelectedAffix[]) => void;
}

export function BaseAffixSection({
  selectedAffixes,
  globalOperator,
  onSelectedAffixesChange,
}: BaseAffixSectionProps) {
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlot | null>(null);
  const [selectedBaseName, setSelectedBaseName] = useState<string | null>(null);

  // Lazy-loaded affix DB feeds the validation pass. Until it resolves,
  // `validateSelectedAffixes` returns [] by design so no warnings flash
  // on the first paint for a URL-hydrated selection.
  const { data: affixDb } = useAffixDb();

  const warnings = useMemo(
    () => validateSelectedAffixes(selectedAffixes, affixDb, globalOperator),
    [selectedAffixes, affixDb, globalOperator],
  );
  const conflictedIndices = useMemo(() => collectConflictedIndices(warnings), [warnings]);

  const handleSlotChange = useCallback((slot: EquipmentSlot) => {
    setSelectedSlot(slot);
    // Note: BasePicker internally resets selectedBaseName on slot transition
    // via its own useEffect. We don't need to reset it here.
  }, []);

  const handleBaseChange = useCallback((name: string | null) => {
    setSelectedBaseName(name);
  }, []);

  const handleAddAffix = useCallback(
    (affixId: number, tier: number, exact: boolean) => {
      // Safety guard — AffixSelector disables its Add button when slot is
      // null, but also refuse here so a hand-crafted call can't produce a
      // SelectedAffix with an invalid slot.
      if (selectedSlot === null) return;
      // Dedup key is (affixId, slot) — the same affix on two different
      // slots is a distinct filter because per-slot value scaling means the
      // generated regex differs. See SelectedAffix.slot docstring.
      if (selectedAffixes.some((sa) => sa.affixId === affixId && sa.slot === selectedSlot)) {
        return;
      }
      onSelectedAffixesChange([
        ...selectedAffixes,
        { affixId, slot: selectedSlot, minTier: tier, exact },
      ]);
    },
    [selectedAffixes, onSelectedAffixesChange, selectedSlot],
  );

  const handleRemoveAffix = useCallback(
    (index: number) => {
      onSelectedAffixesChange(selectedAffixes.filter((_, i) => i !== index));
    },
    [selectedAffixes, onSelectedAffixesChange],
  );

  const handleEditTier = useCallback(
    (index: number, tier: number, exact: boolean) => {
      onSelectedAffixesChange(
        selectedAffixes.map((sa, i) => (i === index ? { ...sa, minTier: tier, exact } : sa)),
      );
    },
    [selectedAffixes, onSelectedAffixesChange],
  );

  /** Bulk-remove handler used by the AffixWarnings "Remove" action button.
   *  The warning carries the indices it's flagging; we filter them out in
   *  one pass rather than walking the index-shift minefield one-by-one. */
  const handleRemoveIndices = useCallback(
    (indices: readonly number[]) => {
      if (indices.length === 0) return;
      const toRemove = new Set(indices);
      onSelectedAffixesChange(selectedAffixes.filter((_, i) => !toRemove.has(i)));
    },
    [selectedAffixes, onSelectedAffixesChange],
  );

  return (
    <div className="mb-6 md:mb-8 space-y-4 md:space-y-6">
      <SlotPicker selectedSlot={selectedSlot} onSlotChange={handleSlotChange} />
      <BasePicker
        selectedSlot={selectedSlot}
        selectedBaseName={selectedBaseName}
        onBaseChange={handleBaseChange}
      />
      <AffixSelector
        selectedSlot={selectedSlot}
        selectedAffixes={selectedAffixes}
        onAddAffix={handleAddAffix}
      />
      <AffixWarnings warnings={warnings} onRemoveIndices={handleRemoveIndices} />
      <SelectedAffixList
        selectedAffixes={selectedAffixes}
        globalOperator={globalOperator}
        conflictedIndices={conflictedIndices}
        onRemove={handleRemoveAffix}
        onEditTier={handleEditTier}
      />
    </div>
  );
}
