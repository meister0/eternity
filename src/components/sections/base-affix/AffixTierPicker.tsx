interface AffixTierPickerProps {
  maxTier: number;
  selectedTier: number;
  exact: boolean;
  onTierChange: (tier: number, exact: boolean) => void;
}

export function AffixTierPicker({
  maxTier,
  selectedTier,
  exact,
  onTierChange,
}: AffixTierPickerProps) {
  if (maxTier === 1) {
    return <span className="text-xs text-gray-500">T1</span>;
  }

  const tiers = Array.from({ length: maxTier }, (_, i) => i + 1);

  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-0.5">
        {tiers.map((tier) => {
          const isSelected = tier === selectedTier;
          return (
            <button
              key={tier}
              type="button"
              onClick={() => onTierChange(tier, exact)}
              className={`px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {tier}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onTierChange(selectedTier, !exact)}
        title={exact ? 'Exactly this tier' : 'This tier or higher'}
        className={`ml-1 px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer transition-colors ${
          exact
            ? 'bg-amber-600 text-white hover:bg-amber-700'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        }`}
      >
        {exact ? '=' : '+'}
      </button>
    </div>
  );
}
