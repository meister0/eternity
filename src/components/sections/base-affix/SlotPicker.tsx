import { EQUIPMENT_SLOT_MACROS } from '../../../data/stash-macros';
import type { EquipmentSlot } from '../../../types/stash-search';

interface SlotPickerProps {
  selectedSlot: EquipmentSlot | null;
  onSlotChange: (slot: EquipmentSlot) => void;
}

/**
 * Single-select picker for EquipmentSlot. Headless: renders only the
 * grouped slot buttons with no outer card or header. The containing
 * BaseAffixSection provides the card and step label — this component
 * just puts buttons on the page and calls the controlled callback.
 */
export function SlotPicker({ selectedSlot, onSlotChange }: SlotPickerProps) {
  return (
    <div className="space-y-4">
      {EQUIPMENT_SLOT_MACROS.map((group) => (
        <div key={group.label}>
          <label className="block text-xs font-medium text-gray-400 mb-2">{group.label}</label>
          <div className="flex flex-wrap gap-2">
            {group.items.map((item) => {
              const isActive = selectedSlot === item.value;
              return (
                <button
                  key={item.value}
                  onClick={() => onSlotChange(item.value)}
                  className={`px-3 py-2.5 md:py-2 rounded text-xs md:text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-gray-600 text-white hover:bg-gray-700 border border-gray-600'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
