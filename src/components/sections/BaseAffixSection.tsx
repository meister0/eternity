import { useCallback, useState } from 'react';
import type { SelectedAffix } from '../../types/affix';
import type { EquipmentSlot } from '../../types/stash-search';
import { AffixSelector } from './base-affix/AffixSelector';
import { BasePicker } from './base-affix/BasePicker';
import { SelectedAffixList } from './base-affix/SelectedAffixList';
import { SlotPicker } from './base-affix/SlotPicker';

interface BaseAffixSectionProps {
  selectedAffixes: readonly SelectedAffix[];
  onSelectedAffixesChange: (next: readonly SelectedAffix[]) => void;
}

export function BaseAffixSection({
  selectedAffixes,
  onSelectedAffixesChange,
}: BaseAffixSectionProps) {
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlot | null>(null);
  const [selectedBaseName, setSelectedBaseName] = useState<string | null>(null);

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
      // Append only if not already in the list. Dedup by affixId.
      if (selectedAffixes.some((sa) => sa.affixId === affixId)) {
        return;
      }
      onSelectedAffixesChange([...selectedAffixes, { affixId, minTier: tier, exact }]);
    },
    [selectedAffixes, onSelectedAffixesChange],
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
      <SelectedAffixList
        selectedAffixes={selectedAffixes}
        onRemove={handleRemoveAffix}
        onEditTier={handleEditTier}
      />
    </div>
  );
}
