import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useAffixDb } from '../../data/affix-runtime';
import type { SelectedAffix } from '../../types/affix';
import type { EquipmentSlot, ExpressionOperator } from '../../types/stash-search';
import { collectConflictedIndices, validateSelectedAffixes } from '../../utils/affix-validation';
import { SectionContainer, SectionHeader } from '../ui';
import { AffixSelector } from './base-affix/AffixSelector';
import { AffixWarnings } from './base-affix/AffixWarnings';
import { BasePicker } from './base-affix/BasePicker';
import { SelectedAffixList } from './base-affix/SelectedAffixList';
import { SlotPicker } from './base-affix/SlotPicker';

interface BaseAffixSectionProps {
  selectedAffixes: readonly SelectedAffix[];
  /** Current global boolean operator from the parent's SearchState. Drives
   *  mode-aware validation (statOrderKey collisions and prefix/suffix count
   *  limits only fire in `&` mode) and the mode-aware subtitle above the
   *  Selected Affixes step. */
  globalOperator: ExpressionOperator;
  onSelectedAffixesChange: (next: readonly SelectedAffix[]) => void;
}

/**
 * Unified "Base & Affix Filter" card. Composes the four headless sub-
 * components (SlotPicker, BasePicker, AffixSelector, SelectedAffixList)
 * plus the AffixWarnings block into a single SectionContainer with
 * labelled steps and progressive disclosure.
 *
 * UX design (validated against ui-ux-pro-max rules):
 *  - One SectionContainer replaces the previous 4 stacked cards — matches
 *    `field-grouping` (related fields in one visual group) and removes
 *    the nested-card anti-pattern.
 *  - Step labels use uppercase amber-400 at `text-xs` so they sit below
 *    the main header in the type hierarchy without competing with it.
 *  - Progressive disclosure: steps 2 (Base) and 3 (Add Affix) only appear
 *    once a slot is selected. Before that, an inline guidance line
 *    directs the user to the slot picker. Matches `progressive-disclosure`
 *    and `empty-states`.
 *  - The "Selected Affixes" step is decoupled from the slot gate — it's
 *    visible whenever there's anything to review, so a URL-hydrated state
 *    (shared link) shows the user's selection on first paint even if the
 *    slot picker is still null.
 *  - Warnings block sits directly above the Selected Affixes step so the
 *    messages it emits are visually adjacent to the chips they describe.
 */
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
      // Safety guard — AffixSelector is only mounted when slot !== null
      // (progressive disclosure), but also refuse here so a stray call
      // can't produce a SelectedAffix with an invalid slot.
      if (selectedSlot === null) return;
      // Dedup key is (affixId, slot) — the same affix on two different
      // slots is a distinct filter because per-slot value scaling means
      // the generated regex differs. See SelectedAffix.slot docstring.
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

  const showPickingSteps = selectedSlot !== null;
  const showSelected = selectedAffixes.length > 0 || warnings.length > 0;
  const showEmptyHint = !showPickingSteps && !showSelected;

  return (
    <SectionContainer className="mb-6 md:mb-8">
      <SectionHeader>Base &amp; Affix Filter</SectionHeader>

      <div className="space-y-6">
        <Step label="Slot">
          <SlotPicker selectedSlot={selectedSlot} onSlotChange={handleSlotChange} />
        </Step>

        {showPickingSteps && (
          <>
            <Divider />
            <Step label="Base" optional>
              <BasePicker
                selectedSlot={selectedSlot}
                selectedBaseName={selectedBaseName}
                onBaseChange={handleBaseChange}
              />
            </Step>

            <Divider />
            <Step label="Add Affix">
              <AffixSelector
                selectedSlot={selectedSlot}
                selectedAffixes={selectedAffixes}
                onAddAffix={handleAddAffix}
              />
            </Step>
          </>
        )}

        {showEmptyHint && (
          <div className="border-t border-gray-700 pt-4">
            <p className="text-sm italic text-gray-500">
              Pick a slot above to start browsing affixes.
            </p>
          </div>
        )}

        {showSelected && (
          <>
            <Divider />
            {warnings.length > 0 && (
              <AffixWarnings warnings={warnings} onRemoveIndices={handleRemoveIndices} />
            )}
            <Step label="Selected Affixes" subtitle={modeSubtitle(globalOperator)}>
              <SelectedAffixList
                selectedAffixes={selectedAffixes}
                conflictedIndices={conflictedIndices}
                onRemove={handleRemoveAffix}
                onEditTier={handleEditTier}
              />
            </Step>
          </>
        )}
      </div>
    </SectionContainer>
  );
}

// ---------------------------------------------------------------------------
// Local layout helpers
// ---------------------------------------------------------------------------

interface StepProps {
  label: string;
  /** If true, renders a muted "(optional)" suffix next to the label. */
  optional?: boolean;
  /** Secondary line under the label — used for the mode-aware "all must
   *  be present (AND)" / "items matching any of these (OR)" hint above
   *  the Selected Affixes step. */
  subtitle?: string;
  children: ReactNode;
}

/**
 * Labelled sub-section of the Base & Affix card. The label uses the
 * amber-400 accent color consistent with the main section header but at
 * a smaller size so the hierarchy reads: CARD > STEP > CONTENT.
 */
function Step({ label, optional, subtitle, children }: StepProps) {
  return (
    <div>
      <div className="mb-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
          {label}
          {optional && (
            <span className="ml-2 text-xs font-normal normal-case tracking-normal text-gray-500">
              (optional)
            </span>
          )}
        </h4>
        {subtitle !== undefined && (
          <p className="mt-1 text-xs font-normal text-gray-500">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-700" />;
}

/** Short human-readable explanation of what the current globalOperator
 *  means for the user's affix selection. Rendered as the subtitle of the
 *  Selected Affixes step — this is the discoverability hint for the
 *  output-bar operator toggle (which the user might otherwise miss). */
function modeSubtitle(operator: ExpressionOperator): string {
  return operator === '&'
    ? 'all must be present on the item (AND)'
    : 'items matching any of these (OR)';
}
