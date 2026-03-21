// Operator types for macro values
export type Operator = '=' | '+' | '-';

// Macro with numeric value and operator
export interface MacroWithValue {
  enabled: boolean;
  value: number;
  operator: Operator;
}

// Simple boolean macro
export interface SimpleMacro {
  enabled: boolean;
}

// Item potential macros
export interface ItemPotential {
  LP: MacroWithValue;
  WW: MacroWithValue;
  PT: MacroWithValue;
  WT: SimpleMacro;
  FP: MacroWithValue;
  SwapAttributes: SimpleMacro;
  Corrupted: SimpleMacro;
  Corruptable: SimpleMacro;
  Ruined: SimpleMacro;
}

// Item rarity options
export type ItemRarity =
  | 'normal'
  | 'magic'
  | 'rare'
  | 'exalted'
  | 'unique'
  | 'legendary'
  | 'set'
  | null;

// Class requirement options
export type ClassRequirement = 'Acolyte' | 'Mage' | 'Primalist' | 'Rogue' | 'Sentinel';

// Item type options
export type ItemType = 'Set' | 'RealSet' | 'ReforgedSet' | 'Experimentable' | 'WeaverIdol';

// Equipment slot options
export type EquipmentSlot =
  // Armor
  | 'Helmet'
  | 'Body'
  | 'Belt'
  | 'Boots'
  | 'Gloves'
  | 'Amulet'
  | 'Ring'
  | 'Relic'
  // Weapons
  | '1HAxe'
  | 'Dagger'
  | '1HMace'
  | 'Sceptre'
  | '1HSword'
  | 'Wand'
  | '2HAxe'
  | '2HMace'
  | 'Spear'
  | 'Staff'
  | '2HSword'
  | 'Bow'
  // Off Hands
  | 'Quiver'
  | 'Shield'
  | 'Catalyst'
  // Idols
  | 'Idol'
  | 'OmenIdol'
  | 'Small'
  | 'Minor'
  | 'Humble'
  | 'Stout'
  | 'Grand'
  | 'Large'
  | 'Ornate'
  | 'Huge'
  | 'Adorned'
  | 'Altar';

// Equipment requirements
export interface EquipmentRequirements {
  Lvl: MacroWithValue;
  CoF: SimpleMacro;
  MG: SimpleMacro;
  Trade: SimpleMacro;
}

// Affix tier configuration
export interface AffixTier {
  tier: number; // 1-7
  count: number; // 1-5 for 1T-5T format
  operator: Operator;
}

// Affix count configuration
export interface AffixCounts {
  Prefixes: MacroWithValue;
  Suffixes: MacroWithValue;
  Affixes: MacroWithValue;
  Sealed: MacroWithValue;
  Experimental: MacroWithValue;
  Personal: MacroWithValue;
}

// Expression operator
export type ExpressionOperator = '&' | '|';

// Regex pattern configuration
export interface RegexPattern {
  pattern: string;
}

// Complete search state
export interface SearchState {
  // Quick preset selection
  selectedPreset: string | null;

  // Main macro categories
  itemPotential: ItemPotential;
  itemRarity: ItemRarity;
  classRequirements: Set<ClassRequirement>;
  itemTypes: Set<ItemType>;
  equipmentSlots: Set<EquipmentSlot>;
  equipmentRequirements: EquipmentRequirements;

  // Affix configuration
  affixTiers: AffixTier[];
  affixCounts: AffixCounts;

  // Custom inputs
  regexPatterns: RegexPattern[];

  // Expression building
  globalOperator: ExpressionOperator;
  expressionOperators: ExpressionOperator[];
}

// Preset search configuration
export interface SearchPreset {
  name: string;
  description: string;
  link: string;
}

// Filter chip for visual expression building
export interface FilterChip {
  id: string;
  display: string;
  searchPart: string;
  category: string;
}
