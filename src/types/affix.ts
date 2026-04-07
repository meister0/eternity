/**
 * Types for the affix database and selected-affix UI state.
 * Built from PoB-LE ModItem.json.
 *
 * Tier indexing: ModItem 1-7 → game T1-T7. ModItem tier 0 is synthetic
 * and dropped — see PLAN.md §4.
 */

import type { EquipmentSlot } from './stash-search';

export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

export interface ProcessedTier {
  /** Game tier 1..7. ModItem tier 0 is dropped — see §4. */
  readonly tier: number;
  /** Display text with PoB markers like {rounding:Integer} stripped. */
  readonly displayText: string;
  readonly valueRanges: readonly ValueRange[];
  readonly level: number;
}

export type AffixType = 'Prefix' | 'Suffix';

export interface ProcessedAffix {
  readonly id: number;
  readonly name: string;
  readonly type: AffixType;
  /** Affix family ID — affixes sharing this are mutually exclusive on one item. */
  readonly statOrderKey: number;
  /** False for the ~420 affixes with only ModItem tier 0 (no per-tier breakdown). */
  readonly hasTierBreakdown: boolean;
  readonly tiers: readonly ProcessedTier[];
  /** Set when hasTierBreakdown=false: the raw text from the lone tier 0 entry. */
  readonly summaryText?: string;
}

export interface ProcessedBase {
  readonly name: string;
  readonly slot: EquipmentSlot;
  readonly subTypeId: number;
  readonly level: number;
  readonly implicits: readonly string[];
  readonly affixEffectModifier: number;
}

export interface SelectedAffix {
  readonly affixId: number;
  /** 1..7 */
  readonly minTier: number;
  /** true → only this exact tier. false → this tier or higher. */
  readonly exact: boolean;
}

/** Indexed by affixId. */
export type AffixDb = Readonly<Record<number, ProcessedAffix>>;

/** Indexed by base display name. */
export type BaseDb = Readonly<Record<string, ProcessedBase>>;
