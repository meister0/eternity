import type {
  ClassRequirement,
  EquipmentSlot,
  ItemRarity,
  ItemType,
  SearchPreset,
} from '../types/stash-search';

// Item potential macro definitions
export const ITEM_POTENTIAL_MACROS = {
  LP: {
    code: 'LP',
    name: 'Legendary Potential',
    description: "Non-Weaver's Will unique items",
    hasValue: true,
    maxValue: 4,
  },
  WW: {
    code: 'WW',
    name: "Weaver's Will",
    description: "Weaver's Will unique or legendary items",
    hasValue: true,
    maxValue: 28,
  },
  FP: {
    code: 'FP',
    name: 'Forging Potential',
    description: 'Available Forging Potential',
    hasValue: true,
    maxValue: 70,
  },
  WT: {
    code: 'WT',
    name: 'Enchantable Idols',
    description: 'Enchantable idols',
    hasValue: false,
  },
  PT: {
    code: 'PT',
    name: 'Potential Tier',
    description: 'Items for unique rerolling in Gauntlet of Strife',
    hasValue: true,
    maxValue: 28,
  },
  SwapAttributes: {
    code: 'SwapAttributes',
    name: 'Swap Attributes',
    description: 'Items affected by Relic of the Observer',
    hasValue: false,
  },
  Corrupted: {
    code: 'Corrupted',
    name: 'Corrupted',
    description: 'Corrupted items',
    hasValue: false,
  },
  Corruptable: {
    code: 'Corruptable',
    name: 'Corruptable',
    description: 'Items that can be corrupted',
    hasValue: false,
  },
  Ruined: {
    code: 'Ruined',
    name: 'Ruined',
    description: 'Ruined items',
    hasValue: false,
  },
} as const;

// Item rarity options
export const ITEM_RARITIES: { value: ItemRarity; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Normal rarity items' },
  { value: 'magic', label: 'Magic', description: 'Magic rarity items' },
  { value: 'rare', label: 'Rare', description: 'Rare rarity items' },
  { value: 'exalted', label: 'Exalted', description: 'Exalted rarity items' },
  { value: 'unique', label: 'Unique', description: 'Unique rarity items' },
  { value: 'legendary', label: 'Legendary', description: 'Legendary rarity items' },
  { value: 'set', label: 'Set', description: 'Set rarity items' },
];

// Class requirements
export const CLASS_REQUIREMENTS: { value: ClassRequirement; label: string }[] = [
  { value: 'Acolyte', label: 'Acolyte' },
  { value: 'Mage', label: 'Mage' },
  { value: 'Primalist', label: 'Primalist' },
  { value: 'Rogue', label: 'Rogue' },
  { value: 'Sentinel', label: 'Sentinel' },
];

// Item types
export const ITEM_TYPES: { value: ItemType; label: string; description: string }[] = [
  { value: 'Set', label: 'Set Bonus', description: 'Items that grant set bonuses' },
  { value: 'RealSet', label: 'Set Item', description: 'Actual set items' },
  { value: 'ReforgedSet', label: 'Reforged Set', description: 'Reforged set items' },
  { value: 'Experimentable', label: 'Experimentable', description: 'Boots, gloves, or belts' },
  { value: 'WeaverIdol', label: 'Weaver Idol', description: 'Weaver idols' },
];

// Equipment slot macros (grouped for UI)
export const EQUIPMENT_SLOT_MACROS: {
  label: string;
  items: { value: EquipmentSlot; label: string }[];
}[] = [
  {
    label: 'Armor',
    items: [
      { value: 'Helmet', label: 'Helmet' },
      { value: 'Body', label: 'Body' },
      { value: 'Belt', label: 'Belt' },
      { value: 'Boots', label: 'Boots' },
      { value: 'Gloves', label: 'Gloves' },
      { value: 'Amulet', label: 'Amulet' },
      { value: 'Ring', label: 'Ring' },
      { value: 'Relic', label: 'Relic' },
    ],
  },
  {
    label: 'Weapons',
    items: [
      { value: '1HAxe', label: '1H Axe' },
      { value: 'Dagger', label: 'Dagger' },
      { value: '1HMace', label: '1H Mace' },
      { value: 'Sceptre', label: 'Sceptre' },
      { value: '1HSword', label: '1H Sword' },
      { value: 'Wand', label: 'Wand' },
      { value: '2HAxe', label: '2H Axe' },
      { value: '2HMace', label: '2H Mace' },
      { value: 'Spear', label: 'Spear' },
      { value: 'Staff', label: 'Staff' },
      { value: '2HSword', label: '2H Sword' },
      { value: 'Bow', label: 'Bow' },
    ],
  },
  {
    label: 'Off Hands',
    items: [
      { value: 'Quiver', label: 'Quiver' },
      { value: 'Shield', label: 'Shield' },
      { value: 'Catalyst', label: 'Catalyst' },
    ],
  },
  {
    label: 'Idols',
    items: [
      { value: 'Idol', label: 'Idol' },
      { value: 'OmenIdol', label: 'Omen Idol' },
      { value: 'Small', label: 'Small' },
      { value: 'Minor', label: 'Minor' },
      { value: 'Humble', label: 'Humble' },
      { value: 'Stout', label: 'Stout' },
      { value: 'Grand', label: 'Grand' },
      { value: 'Large', label: 'Large' },
      { value: 'Ornate', label: 'Ornate' },
      { value: 'Huge', label: 'Huge' },
      { value: 'Adorned', label: 'Adorned' },
      { value: 'Altar', label: 'Altar' },
    ],
  },
];

// All equipment slot values (flat list for parsing)
export const ALL_EQUIPMENT_SLOTS: EquipmentSlot[] = EQUIPMENT_SLOT_MACROS.flatMap((group) =>
  group.items.map((item) => item.value),
);

// Equipment requirement macros
export const EQUIPMENT_MACROS = {
  Lvl: {
    code: 'Lvl',
    name: 'Level',
    description: 'Required level',
    hasValue: true,
    defaultValue: 1,
  },
  CoF: {
    code: 'CoF',
    name: 'Circle of Fortune',
    description: 'Circle of Fortune tagged items',
    hasValue: false,
  },
  MG: {
    code: 'MG',
    name: "Merchant's Guild",
    description: "Merchant's Guild tagged items",
    hasValue: false,
  },
  Trade: {
    code: 'Trade',
    name: 'Tradeable',
    description: 'Items that can be traded',
    hasValue: false,
  },
} as const;

// Affix count macros
export const AFFIX_COUNT_MACROS = {
  Prefixes: {
    code: 'prefixes',
    name: 'Prefixes',
    description: 'Number of prefix affixes',
    maxValue: 2,
  },
  Suffixes: {
    code: 'suffixes',
    name: 'Suffixes',
    description: 'Number of suffix affixes',
    maxValue: 2,
  },
  Affixes: {
    code: 'affixes',
    name: 'Total Affixes',
    description: 'Total number of affixes',
    maxValue: 4,
  },
  Sealed: {
    code: 'sealed',
    name: 'Sealed Affixes',
    description: 'Number of sealed affixes',
    maxValue: 2,
  },
  Experimental: {
    code: 'experimental',
    name: 'Experimental Affixes',
    description: 'Number of experimental affixes',
    maxValue: 1,
  },
  Personal: {
    code: 'personal',
    name: 'Personal Affixes',
    description: 'Number of personal affixes',
    maxValue: 1,
  },
} as const;

// Common search presets
export const SEARCH_PRESETS: SearchPreset[] = [
  {
    name: 'Double T6+',
    description: 'At least 2 T6+ affixes',
    link: '/eternity/search?q=2T6%2B',
  },
  {
    name: 'High Potential Uniques',
    description: 'LP3+ or WW20+ items',
    link: '/eternity/search?q=LP3%2B%7CWW20%2B',
  },
  {
    name: 'Open Prefix T7 Exalts',
    description: 'T7 exalted items with open prefix slots',
    link: '/eternity/search?q=T7%2B%26prefixes1-',
  },
  {
    name: 'Craftable boots with 25+% MS',
    description: 'Craftable boots with 25+% movement speed',
    link: '/eternity/search?q=FP1%2B%26%2Fboots%2F%26%2F2%5B5-9%5D%7C%5B3-9%5D%5B0-9%5D+increased+movement%2F',
  },
];

// Common regex patterns (equipment slots now have dedicated macros)
export const REGEX_PATTERNS = [
  {
    name: 'Crit Items',
    pattern: 'crit',
    description: 'Items containing "crit"',
  },
  {
    name: 'Dexterity 11-14',
    pattern: '1[1-4] dexterity',
    description: 'Items with 11-14 dexterity',
  },
];

// Tier options for affix tier selectors
export const TIER_OPTIONS = Array.from({ length: 7 }, (_, i) => ({
  value: i + 1,
  label: `T${i + 1}`,
}));

// Count options for affix tier count selectors
export const COUNT_OPTIONS = Array.from({ length: 5 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1} Affix${i > 0 ? 'es' : ''}`,
}));

// Operator options
export const OPERATOR_OPTIONS = [
  { value: '=' as const, label: 'Exact', symbol: '' },
  { value: '+' as const, label: 'At least', symbol: '+' },
  { value: '-' as const, label: 'At most', symbol: '-' },
];
