# Local data summary (P1.1, captured 2026-04-07)

This is what the existing files in `data/raw/` contain that is _relevant to the
base ↔ affix mapping question_. This file exists so future maintainers can see
the local evidence base without re-reading the multi-MB JSON dumps.

## `data/raw/ModItem.json` (1.5 MB, 5907 entries)

Per-tier affix records keyed `<affixId>_<tier>`. Confirmed fields:
`affix`, `1`, `2`, `level`, `statOrderKey`, `statOrder`, `tier`, `type`
(`"Prefix"` | `"Suffix"`), `standardAffixEffectModifier`.

**Slot/base information present: NONE.**

- `grep -i 'slot|validBase|baseList|slotTag|allowedSlot|itemType'` returns 96
  hits, but every single one is the literal text `"+1 Potion Slots"` etc.
  inside affix wording. There is no structural slot field.
- The only fields that _could_ hint at slot are:
  - `level`: required item level (0..~80). Same level can map to many slots,
    so this is at best a per-affix lower bound, not a slot mapping.
  - `statOrderKey`: affix-family ID. Mutually-exclusive families share it.
    Adjacent IDs are NOT a slot grouping (e.g. ID 0 = Inevitable / Void Pen
    suffix, ID 1 = of Defense / increased Armor prefix — very different slots).

## `data/raw/bases-full.json` (247 KB, 897 bases)

Keyed by base display name. Confirmed fields: `type`, `baseTypeID`, `subTypeID`,
`req.level`, `affixEffectModifier`, `implicits`.

**Affix list per base: NONE.** No `validAffixes`, `affixPool`, or similar field
exists on any base entry.

`type` values observed (this IS the slot vocabulary the UI already uses):
`Helmet`, `Body`, `Belt`, `Boots`, `Gloves`, `Amulet`, `Ring`, `Relic`,
`Shield`, `Quiver`, `Catalyst` (off-hand caster), plus weapon types
(`1HSword`, `2HSword`, `1HAxe`, `2HAxe`, `1HMace`, `2HMace`, `Bow`, `Wand`,
`Sceptre`, `Staff`, `Polearm`, `Dagger`), `Idol`, `Blessing`. (Blessings are
not normal gear and should be filtered out for the affix-by-slot UI.)

## `data/raw/affixes-id-map.json` (20 KB)

`{ "<base64-ish slug>": <integerAffixId> }` — PoB-LE's URL-slug → affix ID
lookup, ~700 entries. Slugs do NOT obviously encode slot info (length varies
4..10, character distribution looks like base64). Could _possibly_ be a packed
encoding of slot+family+id but verifying that takes a separate spike with PoB
source code. Not pursued in this 4h budget.

## `data/raw/bases.json` (120 KB)

`{ "<slug>": { "baseTypeId", "subTypeId" } }` — internal lookup, no slot info
beyond the IDs which already require bases-full.json to interpret.

## What's missing — same conclusion as PLAN.md §3.4

Neither file contains a per-affix list of valid slots or bases. The
relationship `Mana Regen → [Belt, Amulet, Relic]` cannot be derived from local
data alone. An external source (Tunklab data routes, lastepochtools.com, or
a deeper read of the PoB-LE Lua planner code) is required to build a precise
mapping.
