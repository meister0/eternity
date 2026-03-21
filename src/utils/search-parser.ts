import { ALL_EQUIPMENT_SLOTS } from '../data/stash-macros';
import type {
  ClassRequirement,
  EquipmentSlot,
  ItemRarity,
  ItemType,
  Operator,
  SearchState,
  SimpleMacro,
} from '../types/stash-search';

/**
 * Parse a search string back into SearchState
 */
export function parseSearchString(searchString: string, fallbackState: SearchState): SearchState {
  if (!searchString.trim()) return fallbackState;

  try {
    const state = { ...fallbackState };
    // Clear regex patterns array to start fresh
    state.regexPatterns = [];

    // Detect which operator is being used
    const hasAnd = searchString.includes('&');
    const hasOr = searchString.includes('|');

    // Determine the primary operator based on which appears first or more frequently
    let primaryOperator: '&' | '|' = '&'; // default
    if (hasOr && !hasAnd) {
      primaryOperator = '|';
    } else if (hasOr && hasAnd) {
      // If both are present, use the one that appears first
      const andIndex = searchString.indexOf('&');
      const orIndex = searchString.indexOf('|');
      primaryOperator = orIndex < andIndex ? '|' : '&';
    }

    state.globalOperator = primaryOperator;

    // Split by the detected operator
    const parts = searchString
      .split(primaryOperator)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      // Item Potential: LP3+, WW20-, PT15, FP50+
      const potentialMatch = part.match(/^(LP|WW|PT|FP)(\d+)([+-]?)$/i);
      if (potentialMatch) {
        const [, macro, value, operator] = potentialMatch;
        const key = macro.toUpperCase() as keyof typeof state.itemPotential;
        if (key in state.itemPotential) {
          state.itemPotential[key] = {
            enabled: true,
            value: parseInt(value),
            operator: (operator || '=') as Operator,
          };
        }
        continue;
      }

      // Simple Item Potential: WT, SwapAttributes, Corrupted, Corruptable, Ruined
      if (/^(WT|SwapAttributes|Corrupted|Corruptable|Ruined)$/i.test(part)) {
        const simpleKeys: Record<string, keyof typeof state.itemPotential> = {
          wt: 'WT',
          swapattributes: 'SwapAttributes',
          corrupted: 'Corrupted',
          corruptable: 'Corruptable',
          ruined: 'Ruined',
        };
        const key = simpleKeys[part.toLowerCase()];
        if (key && key in state.itemPotential) {
          (state.itemPotential[key] as SimpleMacro) = { enabled: true };
        }
        continue;
      }

      // Affix Tiers: T7, 2T6+, 3T5-
      const affixTierMatch = part.match(/^(\d*)T(\d+)([+-]?)$/i);
      if (affixTierMatch) {
        const [, countStr, tierStr, operator] = affixTierMatch;
        const count = countStr ? parseInt(countStr) : 1;
        const tier = parseInt(tierStr);

        state.affixTiers.push({
          tier,
          count,
          operator: (operator || '=') as Operator,
        });
        continue;
      }

      // Affix Counts: prefixes2+, suffixes1-, affixes4
      const affixCountMatch = part.match(
        /^(prefixes|suffixes|affixes|sealed|experimental|personal)(\d+)([+-]?)$/i,
      );
      if (affixCountMatch) {
        const [, type, value, operator] = affixCountMatch;
        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();

        if (capitalizedType in state.affixCounts) {
          state.affixCounts[capitalizedType as keyof typeof state.affixCounts] = {
            enabled: true,
            value: parseInt(value),
            operator: (operator || '=') as Operator,
          };
        }
        continue;
      }

      // Equipment Requirements: Lvl75+, CoF, MG, Trade
      const equipmentMatch = part.match(/^(Lvl)(\d+)([+-]?)$/i);
      if (equipmentMatch) {
        const [, macro, value, operator] = equipmentMatch;
        state.equipmentRequirements.Lvl = {
          enabled: true,
          value: parseInt(value),
          operator: (operator || '=') as Operator,
        };
        continue;
      }

      // Simple Equipment Requirements: CoF, MG, Trade
      if (/^(CoF|MG|Trade)$/i.test(part)) {
        const key = part as keyof typeof state.equipmentRequirements;
        if (key in state.equipmentRequirements) {
          (state.equipmentRequirements[key] as SimpleMacro) = { enabled: true };
        }
        continue;
      }

      // Item Rarity: normal, magic, rare, exalted, unique, legendary, set
      const rarities: ItemRarity[] = [
        'normal',
        'magic',
        'rare',
        'exalted',
        'unique',
        'legendary',
        'set',
      ];
      if (rarities.some((rarity) => rarity === part.toLowerCase())) {
        state.itemRarity = part.toLowerCase() as ItemRarity;
        continue;
      }

      // Class Requirements: Acolyte, Mage, Primalist, Rogue, Sentinel
      const classes: ClassRequirement[] = ['Acolyte', 'Mage', 'Primalist', 'Rogue', 'Sentinel'];
      if (classes.some((cls) => cls.toLowerCase() === part.toLowerCase())) {
        const className = classes.find((cls) => cls.toLowerCase() === part.toLowerCase())!;
        state.classRequirements.add(className);
        continue;
      }

      // Item Types: Set, RealSet, ReforgedSet, Experimentable, WeaverIdol
      const itemTypes: ItemType[] = [
        'Set',
        'RealSet',
        'ReforgedSet',
        'Experimentable',
        'WeaverIdol',
      ];
      if (itemTypes.some((type) => type.toLowerCase() === part.toLowerCase())) {
        const itemType = itemTypes.find((type) => type.toLowerCase() === part.toLowerCase())!;
        state.itemTypes.add(itemType);
        continue;
      }

      // Equipment Slots
      const matchedSlot = ALL_EQUIPMENT_SLOTS.find(
        (slot) => slot.toLowerCase() === part.toLowerCase(),
      );
      if (matchedSlot) {
        state.equipmentSlots.add(matchedSlot as EquipmentSlot);
        continue;
      }

      // Regex patterns: /pattern/
      const regexMatch = part.match(/^\/(.+)\/$/);
      if (regexMatch) {
        state.regexPatterns.push({ pattern: regexMatch[1] });
        continue;
      }

      // Everything else goes to regex patterns (without slashes)
      state.regexPatterns.push({ pattern: part });
    }

    // Ensure at least one regex pattern exists
    if (state.regexPatterns.length === 0) {
      state.regexPatterns = [{ pattern: '' }];
    }

    return state;
  } catch (error) {
    console.error('Failed to parse search string:', error);
    return fallbackState;
  }
}

/**
 * Validate if a search string can be parsed without errors
 */
export function validateSearchString(searchString: string): boolean {
  try {
    // Create a dummy state to test parsing
    const dummyState: SearchState = {
      selectedPreset: null,
      itemPotential: {
        LP: { enabled: false, value: 0, operator: '+' },
        WW: { enabled: false, value: 0, operator: '+' },
        PT: { enabled: false, value: 20, operator: '+' },
        WT: { enabled: false },
        FP: { enabled: false, value: 0, operator: '+' },
        SwapAttributes: { enabled: false },
        Corrupted: { enabled: false },
        Corruptable: { enabled: false },
        Ruined: { enabled: false },
      },
      itemRarity: null,
      classRequirements: new Set(),
      itemTypes: new Set(),
      equipmentSlots: new Set(),
      equipmentRequirements: {
        Lvl: { enabled: false, value: 1, operator: '=' },
        CoF: { enabled: false },
        MG: { enabled: false },
        Trade: { enabled: false },
      },
      affixTiers: [],
      affixCounts: {
        Prefixes: { enabled: false, value: 0, operator: '=' },
        Suffixes: { enabled: false, value: 0, operator: '=' },
        Affixes: { enabled: false, value: 0, operator: '=' },
        Sealed: { enabled: false, value: 0, operator: '=' },
        Experimental: { enabled: false, value: 0, operator: '=' },
        Personal: { enabled: false, value: 0, operator: '=' },
      },
      regexPatterns: [{ pattern: '' }],
      globalOperator: '&',
      expressionOperators: [],
    };

    parseSearchString(searchString, dummyState);
    return true;
  } catch (error) {
    return false;
  }
}
