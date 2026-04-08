import { useEffect, useMemo, useRef, useState } from 'react';
import { useBaseDb } from '../../../data/base-runtime';
import type { ProcessedBase } from '../../../types/affix';
import type { EquipmentSlot } from '../../../types/stash-search';

interface BasePickerProps {
  selectedSlot: EquipmentSlot | null;
  selectedBaseName: string | null;
  onBaseChange: (baseName: string | null) => void;
}

// Headless: no outer card or header. BaseAffixSection provides the card.

const INPUT_CLASS =
  'w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 ' +
  'focus:border-amber-400 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed';

export function BasePicker({ selectedSlot, selectedBaseName, onBaseChange }: BasePickerProps) {
  const { data: baseDb, loading, error } = useBaseDb();

  const [query, setQuery] = useState<string>(selectedBaseName ?? '');
  const [open, setOpen] = useState<boolean>(false);

  // Reset on slot transitions only — not on initial mount, so that a parent
  // hydrating both `selectedSlot` and `selectedBaseName` from URL state isn't
  // immediately clobbered. We track the previous slot in a ref so we can
  // distinguish "first render" from "user picked a different slot".
  const prevSlotRef = useRef<EquipmentSlot | null>(selectedSlot);
  useEffect(() => {
    if (prevSlotRef.current === selectedSlot) {
      return;
    }
    prevSlotRef.current = selectedSlot;
    setQuery('');
    setOpen(false);
    onBaseChange(null);
  }, [selectedSlot, onBaseChange]);

  // Keep the input text in sync if the parent changes the selected base name
  // out from under us (e.g. via a preset apply or URL hydration).
  useEffect(() => {
    if (selectedBaseName !== null) {
      setQuery(selectedBaseName);
    }
  }, [selectedBaseName]);

  const slotBases = useMemo<readonly ProcessedBase[]>(() => {
    if (baseDb === null || selectedSlot === null) {
      return [];
    }
    return Object.values(baseDb)
      .filter((b) => b.slot === selectedSlot)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [baseDb, selectedSlot]);

  const filteredBases = useMemo<readonly ProcessedBase[]>(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) {
      return slotBases;
    }
    return slotBases.filter((b) => b.name.toLowerCase().includes(trimmed));
  }, [slotBases, query]);

  const handleSelect = (base: ProcessedBase) => {
    onBaseChange(base.name);
    setQuery(base.name);
    setOpen(false);
  };

  const handleClear = () => {
    onBaseChange(null);
    setQuery('');
    setOpen(false);
  };

  const showDropdown = open && selectedSlot !== null && !loading && error === null;
  const inputDisabled = selectedSlot === null;

  let placeholder: string;
  if (selectedSlot === null) {
    placeholder = 'Pick a slot first';
  } else if (loading) {
    placeholder = 'Loading bases…';
  } else {
    placeholder = 'Type to filter bases';
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          disabled={inputDisabled}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (!inputDisabled) setOpen(true);
          }}
          onBlur={() => {
            // Delay so click events on dropdown items can fire first.
            window.setTimeout(() => setOpen(false), 120);
          }}
          className={INPUT_CLASS}
        />
        {selectedBaseName !== null && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear selected base"
            className="text-gray-400 hover:text-gray-100 px-2 py-1 rounded hover:bg-gray-700 cursor-pointer"
          >
            ×
          </button>
        )}
      </div>

      {error !== null && (
        <p className="mt-2 text-sm text-red-400">Failed to load bases: {error.message}</p>
      )}

      {showDropdown && (
        <ul
          className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-gray-800 border border-gray-600 rounded-b shadow-lg"
          role="listbox"
        >
          {filteredBases.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No matching bases</li>
          ) : (
            filteredBases.map((base) => {
              const isSelected = base.name === selectedBaseName;
              return (
                <li
                  key={base.name}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    // Prevent the input's onBlur from firing before the click.
                    e.preventDefault();
                    handleSelect(base);
                  }}
                  className={`px-3 py-2 text-sm cursor-pointer ${
                    isSelected ? 'bg-amber-600 text-white' : 'text-gray-100 hover:bg-gray-700'
                  }`}
                >
                  {base.name}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
