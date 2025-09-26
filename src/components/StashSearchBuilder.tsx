import { useEffect, useRef, useState } from 'react';
import { AFFIX_COUNT_MACROS, OPERATOR_OPTIONS } from '../data/stash-macros';
import type { AffixTier, MacroWithValue, Operator, SearchState } from '../types/stash-search';
import {
  clearURLState,
  createInitialState,
  generateShareableLink,
  getStateFromURL,
  updateURL,
} from '../utils/url-state';
import {
  AffixCountsSection,
  AffixTiersSection,
  ClassRequirementsSection,
  CustomSearchSection,
  ItemPotentialSection,
  ItemRaritySection,
  ItemTypesSection,
  OutputSection,
  PresetSection,
} from './sections';

// Helper function to get operator symbol for search string generation
const getOperatorSymbol = (operator: Operator): string => {
  return OPERATOR_OPTIONS.find((op) => op.value === operator)?.symbol ?? '';
};

// Generate search string from current state
const generateSearchString = (currentState: SearchState): string => {
  const parts: string[] = [];

  Object.entries(currentState.itemPotential).forEach(([key, macro]) => {
    if (macro.enabled) {
      if ('value' in macro) {
        const operator = getOperatorSymbol(macro.operator);
        parts.push(`${key}${macro.value}${operator}`);
      } else {
        parts.push(key);
      }
    }
  });

  if (currentState.itemRarity) {
    parts.push(currentState.itemRarity);
  }

  currentState.classRequirements.forEach((cls) => {
    parts.push(cls);
  });

  currentState.itemTypes.forEach((type) => {
    parts.push(type);
  });

  Object.entries(currentState.equipmentRequirements).forEach(([key, macro]) => {
    if (macro.enabled) {
      if ('value' in macro) {
        const operator = getOperatorSymbol(macro.operator);
        parts.push(`${key}${macro.value}${operator}`);
      } else {
        parts.push(key);
      }
    }
  });

  currentState.affixTiers.forEach((affix) => {
    const countPrefix = affix.count > 1 ? affix.count : '';
    const operator = affix.operator === '=' ? '' : affix.operator;
    parts.push(`${countPrefix}T${affix.tier}${operator}`);
  });

  Object.entries(currentState.affixCounts).forEach(([key, macro]) => {
    if (macro.enabled) {
      const operator = getOperatorSymbol(macro.operator);
      const macroName = AFFIX_COUNT_MACROS[key as keyof typeof AFFIX_COUNT_MACROS].code;
      parts.push(`${macroName}${macro.value}${operator}`);
    }
  });

  currentState.regexPatterns.forEach((regex) => {
    if (regex.pattern.trim()) {
      parts.push(`/${regex.pattern}/`);
    }
  });

  return parts.join(currentState.globalOperator);
};

export const StashSearchBuilder = () => {
  const [state, setState] = useState<SearchState>(() => getStateFromURL());
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const updateTimeoutRef = useRef<number | undefined>(undefined);

  const searchString = generateSearchString(state);

  // Debounced URL update when search string changes
  useEffect(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = window.setTimeout(() => {
      updateURL(searchString);
    }, 500);

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [searchString]);

  const updateMacroWithValue = (
    category: keyof SearchState,
    key: string,
    field: keyof MacroWithValue,
    value: boolean | number | Operator,
  ) => {
    setState((prevState) => ({
      ...prevState,
      [category]: {
        ...(prevState[category] as Record<string, any>),
        [key]: {
          ...(prevState[category] as Record<string, any>)[key],
          [field]: value,
        },
      },
    }));
  };

  const toggleSetItem = <T,>(category: 'classRequirements' | 'itemTypes', item: T) => {
    setState((prevState) => {
      const newSet = new Set(prevState[category]) as Set<T>;
      if (newSet.has(item)) {
        newSet.delete(item);
      } else {
        newSet.add(item);
      }
      return {
        ...prevState,
        [category]: newSet as any,
      };
    });
  };

  const addAffixTier = () => {
    setState((prevState) => ({
      ...prevState,
      affixTiers: [...prevState.affixTiers, { tier: 6, count: 1, operator: '+' as Operator }],
    }));
  };

  const updateAffixTier = (index: number, field: keyof AffixTier, value: number | Operator) => {
    setState((prevState) => ({
      ...prevState,
      affixTiers: prevState.affixTiers.map((affix, i) =>
        i === index ? { ...affix, [field]: value } : affix,
      ),
    }));
  };

  const removeAffixTier = (index: number) => {
    setState((prevState) => ({
      ...prevState,
      affixTiers: prevState.affixTiers.filter((_, i) => i !== index),
    }));
  };

  const addRegexPattern = (pattern: string = '') => {
    setState((prevState) => ({
      ...prevState,
      regexPatterns: [...prevState.regexPatterns, { pattern }],
    }));
  };

  const updateRegexPattern = (index: number, pattern: string) => {
    setState((prevState) => ({
      ...prevState,
      regexPatterns: prevState.regexPatterns.map((regex, i) => (i === index ? { pattern } : regex)),
    }));
  };

  // Remove regex pattern (ensure at least one remains)
  const removeRegexPattern = (index: number) => {
    setState((prevState) => ({
      ...prevState,
      regexPatterns:
        prevState.regexPatterns.length > 1
          ? prevState.regexPatterns.filter((_, i) => i !== index)
          : [{ pattern: '' }],
    }));
  };

  // Toggle common pattern (add if not present, remove if present)
  const toggleCommonPattern = (pattern: string) => {
    setState((prevState) => {
      const existingIndex = prevState.regexPatterns.findIndex((p) => p.pattern === pattern);
      if (existingIndex >= 0) {
        return {
          ...prevState,
          regexPatterns:
            prevState.regexPatterns.length > 1
              ? prevState.regexPatterns.filter((_, i) => i !== existingIndex)
              : [{ pattern: '' }],
        };
      } else {
        const lastIndex = prevState.regexPatterns.length - 1;
        const lastPattern = prevState.regexPatterns[lastIndex];

        if (lastPattern && lastPattern.pattern === '') {
          return {
            ...prevState,
            regexPatterns: [
              ...prevState.regexPatterns.slice(0, lastIndex),
              { pattern },
              lastPattern,
            ],
          };
        } else {
          return {
            ...prevState,
            regexPatterns: [...prevState.regexPatterns, { pattern }],
          };
        }
      }
    });
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(searchString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const shareState = async () => {
    try {
      const shareableLink = generateShareableLink(searchString);
      await navigator.clipboard.writeText(shareableLink);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch (err) {
      console.error('Failed to copy shareable link:', err);
    }
  };

  const toggleGlobalOperator = () => {
    setState((prevState) => ({
      ...prevState,
      globalOperator: prevState.globalOperator === '&' ? '|' : '&',
    }));
  };

  const clearAll = () => {
    setState(createInitialState());
    clearURLState();
  };

  return (
    <>
      <div className="max-w-7xl mx-auto p-4 md:p-6 bg-gray-900 text-gray-100 pb-24 md:pb-20">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-amber-400 mb-2">
            Last Epoch Stash Search Builder
          </h1>
          <p className="text-gray-300 text-sm md:text-base">
            Configure filters below, then copy the generated search string and paste into your stash
            search
          </p>
        </div>

        <PresetSection currentSearchString={searchString} onPresetSelect={setState} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8 mb-6 md:mb-8">
          {/* Column 1 */}
          <div className="space-y-4 md:space-y-6">
            <ItemPotentialSection
              itemPotential={state.itemPotential}
              updateMacroWithValue={updateMacroWithValue}
            />
            <ItemTypesSection itemTypes={state.itemTypes} toggleSetItem={toggleSetItem} />
          </div>

          {/* Column 2 */}
          <div className="space-y-4 md:space-y-6">
            <AffixTiersSection
              affixTiers={state.affixTiers}
              addAffixTier={addAffixTier}
              updateAffixTier={updateAffixTier}
              removeAffixTier={removeAffixTier}
            />
            <ItemRaritySection
              itemRarity={state.itemRarity}
              onRarityChange={(rarity) => setState((prev) => ({ ...prev, itemRarity: rarity }))}
            />
          </div>

          {/* Column 3 */}
          <div className="space-y-4 md:space-y-6">
            <AffixCountsSection
              affixCounts={state.affixCounts}
              updateMacroWithValue={updateMacroWithValue}
            />
            <ClassRequirementsSection
              classRequirements={state.classRequirements}
              toggleSetItem={toggleSetItem}
            />
          </div>
        </div>

        <CustomSearchSection
          regexPatterns={state.regexPatterns}
          addRegexPattern={addRegexPattern}
          updateRegexPattern={updateRegexPattern}
          removeRegexPattern={removeRegexPattern}
          toggleCommonPattern={toggleCommonPattern}
        />
      </div>

      {/* Bottom sticky output section */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700 shadow-2xl">
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          <OutputSection
            searchString={searchString}
            globalOperator={state.globalOperator}
            copied={copied}
            shared={shared}
            onCopy={copyToClipboard}
            onShare={shareState}
            onClear={clearAll}
            onToggleOperator={toggleGlobalOperator}
          />
        </div>
      </div>
    </>
  );
};
