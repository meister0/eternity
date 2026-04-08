/**
 * Types for the affix database and selected-affix UI state.
 *
 * Built by `scripts/process-data.mjs` as a JOIN of two upstream sources:
 *  - Tunklab (https://lastepoch.tunklab.com) — primary canonical source for
 *    name, type, nickname, category, slot list, per-slot tier values, class
 *    requirement, and aggregate level requirement. Scraped via
 *    `scripts/scrape-tunklab.mjs` into `data/raw/tunklab-cache/`.
 *  - PoB-LE (Musholic/PathOfBuildingForLastEpoch) — secondary join partner
 *    for `statOrderKey` (mutual-exclusion grouping) and per-tier `level`
 *    requirement (Tunklab only has aggregate). Fetched by
 *    `scripts/update-data.mjs` into `data/raw/`.
 *
 * Tier indexing: game tiers run T1..T8. T8 is the "primordial" top tier
 * added in the prior season — drop-only and dramatically stronger than T7.
 * See PLAN.md §4 for the full tier model and verification trail.
 *
 * Per-slot scaling: a single affix can have different value ranges on
 * different slots. For example, affix 330 Mana Regeneration:
 *   Belt T8   = 94..110%
 *   Amulet T8 = 110..129%
 * The regex generator MUST be told which slot the user is filtering for
 * to produce the correct stash-search regex.
 */

import type { EquipmentSlot } from './stash-search';

export type AffixType = 'Prefix' | 'Suffix';

export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

export interface ProcessedTier {
  /** Game tier 1..8. */
  readonly tier: number;
  /** Tunklab raw display text, e.g. "+(94% to 110%)". */
  readonly displayText: string;
  /** Numeric range parsed from displayText. Hybrid affixes have one entry per stat line. */
  readonly valueRanges: readonly ValueRange[];
  /** Per-tier required item level — from PoB-LE ModItem.json (Tunklab only has aggregate). */
  readonly level: number;
}

/** Map from `EquipmentSlot` to its tier list. The processor canonicalizes
 *  Tunklab's two raw slot vocabularies into the existing `EquipmentSlot`
 *  union before keying this record, so consumers can rely on the keys being
 *  valid `EquipmentSlot` literals. */
export type PerSlotTiers = Readonly<Partial<Record<EquipmentSlot, readonly ProcessedTier[]>>>;

export interface ProcessedAffix {
  readonly id: number;
  /** Canonical name from Tunklab, e.g. "Mana Regeneration". */
  readonly name: string;
  /** Tunklab "Nickname" — short form, e.g. "Rejuvenating". May be null. */
  readonly nickname: string | null;
  /** From Tunklab. PoB-LE's `type` field is unreliable and ignored. */
  readonly type: AffixType;
  /** Tunklab category, e.g. "Normal Affix" / "Set Affix". */
  readonly category: string;
  /** Affix family ID from PoB-LE ModItem.json. Affixes sharing this are
   *  mutually exclusive on one item. */
  readonly statOrderKey: number;
  /** Class restrictions from Tunklab. Empty array = universal. */
  readonly classRequirement: readonly string[];
  /** Aggregate required character level from Tunklab. Null when unspecified. */
  readonly levelRequirement: number | null;
  /** Equipment slots this affix can roll on. Always equal to
   *  `Object.keys(perSlotTiers).sort()` — single source of truth. */
  readonly slots: readonly EquipmentSlot[];
  /** PoB-LE display text template for regex generation, e.g.
   *  "(10-14)% increased Mana Regen". Hybrid affixes are joined with " / ".
   *  PoB markers like {rounding:Integer} are stripped. The numeric placeholder
   *  is in PoB-LE's "(min-max)" form, not Tunklab's "(min% to max%)" form.
   *  Used by the regex generator as the source of the stat-name verb. */
  readonly statTemplate: string;
  /** Tier values per slot. Different slots may have different value ranges
   *  (e.g. affix 330 Mana Regeneration on Belt T8 = 94..110% but on Amulet
   *  T8 = 110..129%). */
  readonly perSlotTiers: PerSlotTiers;
  /** Highest tier present across all slots. Typically 8 (full progression),
   *  7 (capped, no T8 primordial roll), or 1 (single-T1 special-category). */
  readonly maxTier: number;
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
  /** 1..8 */
  readonly minTier: number;
  /** true → only this exact tier. false → this tier or higher. */
  readonly exact: boolean;
}

/** Indexed by affixId. */
export type AffixDb = Readonly<Record<number, ProcessedAffix>>;

/** Indexed by base display name. */
export type BaseDb = Readonly<Record<string, ProcessedBase>>;
