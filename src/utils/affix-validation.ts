/**
 * Pure validation rules for the selected-affix list.
 *
 * Warnings describe problems that the user may want to fix but are not
 * blockers — the search string is still generated regardless. The key
 * semantic nuance: most validity rules only apply in AND mode. In OR mode
 * ("match items having ANY of these affixes") it is perfectly legitimate
 * to:
 *   - select affixes from the same mutual-exclusion group (statOrderKey)
 *   - select more than 2 prefixes or 2 suffixes for the same slot
 * because no single item has to satisfy all of them simultaneously.
 *
 * Orphan-affix warnings are mode-independent: if the user's URL-hydrated
 * state references an affixId that no longer exists in the database, they
 * need a cleanup path regardless of how the parts are joined.
 *
 * This module is pure and framework-free so it can be tested in isolation
 * and called from any React component via useMemo.
 *
 * See PLAN.md §0.5 Phase 5.2 and the UX validation notes from 2026-04-08.
 */

import type { AffixDb, ProcessedAffix, SelectedAffix } from '../types/affix';
import type { ExpressionOperator } from '../types/stash-search';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WarningSeverity = 'info' | 'warning';

/** A discriminator tag describing what to do when the user clicks the
 *  warning's action button. The BaseAffixSection interprets this and calls
 *  the appropriate state mutation. Keeping the action as a typed tag rather
 *  than a callback means the validation function stays pure. */
export type WarningAction = { readonly kind: 'remove-indices'; readonly label: string };

export interface ValidationWarning {
  /** Stable React key derived from the warning's identity and its affected
   *  indices. Same inputs always produce the same id, so the React reconciler
   *  doesn't churn the warnings UI on unrelated re-renders. */
  readonly id: string;
  readonly severity: WarningSeverity;
  readonly title: string;
  readonly message: string;
  /** Indices into `selectedAffixes` that contributed to this warning. Used
   *  both for the optional action (what to remove) and for visual highlight
   *  of the corresponding chips in SelectedAffixList. */
  readonly affectedIndices: readonly number[];
  readonly action?: WarningAction;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the full list of warnings for the current selected-affix state.
 * Ordering is stable and deterministic:
 *   1. Orphan-affixId info warning (at most one, aggregates all orphans)
 *   2. AND-mode warnings in declaration order:
 *      a. statOrderKey collisions
 *      b. prefix-count-over-limit per slot
 *      c. suffix-count-over-limit per slot
 *
 * Returns an empty array when `affixDb` is null (data still loading) — we
 * cannot validate anything without the DB, and emitting speculative warnings
 * would flash and disappear on first load. The component that consumes this
 * simply renders nothing during that window.
 */
export function validateSelectedAffixes(
  selectedAffixes: readonly SelectedAffix[],
  affixDb: AffixDb | null,
  globalOperator: ExpressionOperator,
): readonly ValidationWarning[] {
  if (affixDb === null) return [];
  if (selectedAffixes.length === 0) return [];

  const warnings: ValidationWarning[] = [];

  // ----- 1. Orphan-affix info (mode-independent) ----------------------
  const orphanIndices: number[] = [];
  for (let i = 0; i < selectedAffixes.length; i++) {
    const sa = selectedAffixes[i];
    if (affixDb[sa.affixId] === undefined) {
      orphanIndices.push(i);
    }
  }
  if (orphanIndices.length > 0) {
    warnings.push({
      id: `orphan:${orphanIndices.join(',')}`,
      severity: 'info',
      title:
        orphanIndices.length === 1
          ? '1 affix is missing from the database'
          : `${orphanIndices.length} affixes are missing from the database`,
      message:
        'Your saved selection references affix IDs that no longer exist in ' +
        'the data. They are hidden from the generated search string but ' +
        'still take up chips. Remove them for a clean state.',
      affectedIndices: orphanIndices,
      action: { kind: 'remove-indices', label: 'Remove' },
    });
  }

  // AND-only rules past this point.
  if (globalOperator !== '&') {
    return warnings;
  }

  // Build (index, affix) pairs for all *resolved* (non-orphan) entries, so
  // the rules below only see real affixes.
  type Entry = {
    readonly index: number;
    readonly sa: SelectedAffix;
    readonly affix: ProcessedAffix;
  };
  const resolved: Entry[] = [];
  for (let i = 0; i < selectedAffixes.length; i++) {
    const sa = selectedAffixes[i];
    const affix = affixDb[sa.affixId];
    if (affix === undefined) continue;
    resolved.push({ index: i, sa, affix });
  }

  // ----- 2a. statOrderKey collisions within the same slot ------------
  // Two affixes sharing the same statOrderKey are in the same mutual-
  // exclusion group and cannot co-exist on a single item. Cross-slot pairs
  // are ignored here — they'd only collide if the user also AND'd two
  // different slot filters, which is a separate (and rarer) mistake.
  const bySlotAndKey = new Map<string, Entry[]>();
  for (const e of resolved) {
    const key = `${e.sa.slot}|${e.affix.statOrderKey}`;
    const bucket = bySlotAndKey.get(key);
    if (bucket === undefined) {
      bySlotAndKey.set(key, [e]);
    } else {
      bucket.push(e);
    }
  }
  for (const bucket of bySlotAndKey.values()) {
    if (bucket.length < 2) continue;
    const indices = bucket.map((e) => e.index);
    const names = bucket.map((e) => e.affix.name);
    const slot = bucket[0].sa.slot;
    warnings.push({
      id: `stat-collision:${slot}:${indices.join(',')}`,
      severity: 'warning',
      title: 'Mutually-exclusive affixes on the same slot',
      message:
        `${formatNameList(names)} roll on the same stat and belong to the ` +
        `same mutual-exclusion group. A single ${slot} item can carry only ` +
        `one of them. Remove all but one, or switch the search operator to ` +
        `OR in the output bar to mean "items with any of these".`,
      affectedIndices: indices,
    });
  }

  // ----- 2b. >2 prefix per slot ---------------------------------------
  // ----- 2c. >2 suffix per slot ---------------------------------------
  // An LE item has at most 2 prefix affixes and 2 suffix affixes. In AND
  // mode, selecting 3+ prefixes (or suffixes) for the same slot asks for
  // items that literally cannot exist. Counting is per-slot because
  // different slots are different items.
  type SlotTypeKey = `${string}|${'Prefix' | 'Suffix'}`;
  const byType = new Map<SlotTypeKey, Entry[]>();
  for (const e of resolved) {
    const k: SlotTypeKey = `${e.sa.slot}|${e.affix.type}`;
    const bucket = byType.get(k);
    if (bucket === undefined) {
      byType.set(k, [e]);
    } else {
      bucket.push(e);
    }
  }
  for (const [key, bucket] of byType.entries()) {
    if (bucket.length <= 2) continue;
    const [slot, type] = key.split('|') as [string, 'Prefix' | 'Suffix'];
    const indices = bucket.map((e) => e.index);
    const label = type === 'Prefix' ? 'prefixes' : 'suffixes';
    warnings.push({
      id: `over-limit:${type}:${slot}:${indices.join(',')}`,
      severity: 'warning',
      title: `${bucket.length} ${label} on ${slot} (AND)`,
      message:
        `An item can have at most 2 ${label}. In AND mode this asks for ` +
        `items that cannot exist. Either switch to OR (output bar) to mean ` +
        `"items with any of these ${label}", or remove ${bucket.length - 2}.`,
      affectedIndices: indices,
    });
  }

  return warnings;
}

/**
 * Union of every `affectedIndices` on a list of warnings. Useful for the
 * ring-highlight pass on SelectedAffixList chips: the chip is highlighted
 * if it appears in *any* warning, regardless of which rule flagged it.
 * Only the 'warning' severity contributes — 'info' warnings (orphan) get
 * their own styling because the chips are already rendered with the
 * "Unknown affix" placeholder.
 */
export function collectConflictedIndices(
  warnings: readonly ValidationWarning[],
): ReadonlySet<number> {
  const out = new Set<number>();
  for (const w of warnings) {
    if (w.severity !== 'warning') continue;
    for (const i of w.affectedIndices) out.add(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format a list of names as "A", "A and B", or "A, B, and C" for display
 *  inside prose warning messages. */
function formatNameList(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `"${names[0]}"`;
  if (names.length === 2) return `"${names[0]}" and "${names[1]}"`;
  const quoted = names.map((n) => `"${n}"`);
  const last = quoted.pop();
  return `${quoted.join(', ')}, and ${last}`;
}
