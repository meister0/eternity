# Last Epoch Stash Search Guide

## Overview

The stash supports advanced searching for items based on their tooltip contents using three search types:

- **Text search** - Simple text matching
- **Regex** - Pattern matching with regular expressions
- **Macros** - Shorthand codes for item properties
- **Expressions** - Combinations of the above using operators

When searching in the Quick View sidebar, your tabs will be filtered to show only those containing matching items.

## Search Types

### Regex

Wrap your search in `/` to use case-insensitive regular expressions:

- `/1[4-9] attunement/` - finds items with 14-19 attunement
- `/relic/` - finds any item containing "relic"

### Macros

Macros are case-insensitive shortcuts that match item properties. Most follow the pattern:
`Macro[number][+/-]`

- **Exact match**: `LP2` (exactly 2 legendary potential)
- **Greater/equal**: `WW15+` (15 or more Weaver's Will)
- **Less/equal**: `suffixes1-` (1 or fewer suffixes)

### Expressions

Combine searches using operators:

- **OR (`|`)**: `LP3+|WW20+` (high potential uniques OR high Weaver's Will)
- **AND (`&`)**: `T7&/boots/` (T7 affixes AND boots)

## Macro Reference

### Item Potential

- `LP` - Non-Weaver's Will unique items
- `WW` - Weaver's Will unique or legendary items
- `WT` - Enchantable idols
- `FP` - Forgeable equipment
- `PT` - Potential tier (for Gauntlet of Strife rerolling)

### Item Types

- `Set` - Items that grant set bonuses
- `RealSet` - Actual set items
- `ReforgedSet` - Reforged set items
- `Experimentable` - Boots, gloves, or belts
- `WeaverIdol` - Weaver idols

### Item Rarity

- `normal` - Normal rarity items
- `magic` - Magic rarity items
- `rare` - Rare rarity items
- `exalted` - Exalted rarity items
- `unique` - Unique rarity items
- `legendary` - Legendary rarity items
- `set` - Set rarity items

### Class Requirements

- `Acolyte` - Acolyte class items
- `Mage` - Mage class items
- `Primalist` - Primalist class items
- `Rogue` - Rogue class items
- `Sentinel` - Sentinel class items

### Equipment Requirements

- `Lvl` - Required level
- `CoF` - Circle of Fortune tagged items
- `MG` - Merchant's Guild tagged items
- `Trade` - Items that can be traded

### Affix Tiers

- `T` - Items with at least 1 affix of specified tier
- `1T`, `2T`, `3T`, `4T`, `5T` - Items with at least N affixes of specified tier

### Affix Counts

- `Prefixes` - Number of prefix affixes
- `Suffixes` - Number of suffix affixes
- `Affixes` - Total number of affixes
- `Sealed` - Number of sealed affixes
- `Experimental` - Number of experimental affixes
- `Personal` - Number of personal affixes

### Corruption

- `Corrupted` - Corrupted items
- `Corruptable` - Items that can be corrupted
- `Ruined` - Ruined items

### Equipment Slots

**Armor:**

- `Helmet`, `Body`, `Belt`, `Boots`, `Gloves`, `Amulet`, `Ring`, `Relic`

**Weapons:**

- `1HAxe`, `Dagger`, `1HMace`, `Sceptre`, `1HSword`, `Wand`
- `2HAxe`, `2HMace`, `Spear`, `Staff`, `2HSword`, `Bow`

**Off Hands:**

- `Quiver`, `Shield`, `Catalyst`

**Idols:**

- `Idol`, `OmenIdol`
- `Small`, `Minor`, `Humble`, `Stout`, `Grand`, `Large`, `Ornate`, `Huge`, `Adorned`, `Altar`

### Special

- `SwapAttributes` - Items affected by Relic of the Observer

## Examples

### Basic Macro Usage

- `LP0` - Uniques with no legendary potential
- `T6+` or `1T6+` - Any exalted item (at least 1 affix tier 6+)
- `prefixes2` - Items with exactly 2 prefixes

### Affix Tier Combinations

- `2T7` - Double T7 exalted items
- `3T6+&T7` - Triple exalted with at least 1 T7 (matches T7/T7/T7 or T7/T6/T6)

### Complex Expressions

- `WW&PT20+` - Weaver's Will items with 20+ potential tier
- `LP3+|WW20+` - High potential uniques
- `prefixes1&T7` - T7 exalts with an open prefix
- `/crit/&/ring/&LP1+` - LP1+ rings with crit
- `/relic/&/1[4-6] dexterity/&suffixes1-` - Relics with T7 dexterity and open suffix

### Item Type Filtering

- `T7&/boots/` - Boots with at least 1 T7 affix
- `WeaverIdol&/minion/` - Weaver idols with minion affixes
- `unique&Sentinel` - Unique items for Sentinel class
