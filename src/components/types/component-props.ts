import type {
  AffixTier,
  ExpressionOperator,
  ItemRarity,
  MacroWithValue,
  Operator,
  SearchState,
} from '../../types/stash-search';

// Base props for sections that modify state
export interface BaseSectionProps {
  state: SearchState;
  updateState: (updater: (prevState: SearchState) => SearchState) => void;
}

// Props for macro with value updates
export interface MacroUpdateProps {
  updateMacroWithValue: (
    category: keyof SearchState,
    key: string,
    field: keyof MacroWithValue,
    value: boolean | number | Operator,
  ) => void;
}

// Props for simple macro updates
export interface SimpleMacroUpdateProps {
  updateSimpleMacro: (category: keyof SearchState, key: string, enabled: boolean) => void;
}

// Props for set item toggles
export interface SetToggleProps {
  toggleSetItem: <T>(
    category: 'classRequirements' | 'itemTypes' | 'equipmentSlots',
    item: T,
  ) => void;
}

// Props for affix tier management
export interface AffixTierProps {
  affixTiers: AffixTier[];
  addAffixTier: () => void;
  updateAffixTier: (index: number, field: keyof AffixTier, value: number | Operator) => void;
  removeAffixTier: (index: number) => void;
}

// Combined props for different section types
export interface ItemPotentialSectionProps extends MacroUpdateProps {
  itemPotential: SearchState['itemPotential'];
}

export interface ItemRaritySectionProps {
  itemRarity: ItemRarity | null;
  onRarityChange: (rarity: ItemRarity | null) => void;
}

export interface ClassRequirementsSectionProps extends SetToggleProps {
  classRequirements: SearchState['classRequirements'];
}

export interface ItemTypesSectionProps extends SetToggleProps {
  itemTypes: SearchState['itemTypes'];
}

export interface EquipmentSlotsSectionProps extends SetToggleProps {
  equipmentSlots: SearchState['equipmentSlots'];
}

export interface EquipmentRequirementsSectionProps extends MacroUpdateProps {
  equipmentRequirements: SearchState['equipmentRequirements'];
}

export interface AffixCountsSectionProps extends MacroUpdateProps {
  affixCounts: SearchState['affixCounts'];
}

export interface CustomSearchSectionProps {
  regexPatterns: SearchState['regexPatterns'];
  addRegexPattern: (pattern?: string) => void;
  updateRegexPattern: (index: number, pattern: string) => void;
  removeRegexPattern: (index: number) => void;
  toggleCommonPattern: (pattern: string) => void;
}

export interface OutputSectionProps {
  searchString: string;
  globalOperator: ExpressionOperator;
  copied: boolean;
  shared: boolean;
  onCopy: () => void;
  onShare: () => void;
  onClear: () => void;
  onToggleOperator: () => void;
}

export interface PresetSectionProps {
  selectedPreset: string | null;
}
