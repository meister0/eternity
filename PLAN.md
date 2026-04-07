# PLAN — Base/Affix-aware Search Generator

> **Mission**: extend the existing `eternity` stash search builder so users can pick a slot and base, see all affixes that can roll on it, choose minimum tiers per affix, and get a precise stash search regex that filters items down to that exact roll.
>
> **Status**: planning complete, implementation not yet started. Fork is at `meister0/eternity`, upstream `checkmatez/eternity`. `npm install` + `npm run typecheck` are green. Raw data already snapshotted into `data/raw/` (see §3).

---

## 0. How to resume this in a fresh Claude Code session

1. `cd ~/Projects/eternity`
2. Read this file (`PLAN.md`) end to end.
3. Read `CLAUDE.md` for repo conventions.
4. Run `git status` and `git log --oneline -10` to see what's already done.
5. Recreate the task list from §8 using `TaskCreate` (task IDs are session-local).
6. Start with the parallel-launch group from §9.

**Critical files to read on resume:**

- `src/components/StashSearchBuilder.tsx` — root component, owns search state
- `src/types/stash-search.ts` — existing state types we'll extend
- `src/data/stash-macros.ts` — existing static data, defines `EQUIPMENT_SLOT_MACROS`
- `src/utils/search-parser.ts` — bidirectional string ↔ state parser
- `data/raw/ModItem.json` — affix dump (1.5 MB, already downloaded)
- `data/raw/bases-full.json` — base dump (247 KB, already downloaded)

---

## 1. Goal in plain English

A user lands on the search builder, scrolls to the new section "Affixes by Base", picks **Belt** as the slot, optionally narrows to **Heavy Belt** as the base, sees the full list of prefixes and suffixes that can roll on a Belt, ticks "Mana Regen — minimum T7", and the output box at the bottom of the page now contains:

```
T7 & /(9[4-9]|10\d|110)% increased mana regen/
```

— ready to paste into Last Epoch's stash search. Multiple affixes can be selected, output composes them with `&`. UI shows live tier value ranges so the user understands what each tier means.

---

## 2. Architectural decisions (locked in)

| Decision               | Choice                                                         | Rationale                                                                                                                              |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Data source            | PoB-LE `ModItem.json` + `bases-full.json`                      | Only public structured dump that exists. Verified affix IDs match loot filter `<int>` IDs 1:1 (635/635 from a real TSM filter sample). |
| Data update strategy   | Build-time only via `npm run update-data` + GitHub Action cron | Users get static `public/data/*.json` — zero runtime dependency on third-party sites.                                                  |
| Update frequency       | Weekly cron + manual trigger after each LE patch/league        | LE patches affixes once per league. Weekly catches mid-league hotfixes.                                                                |
| Loot filter XML export | **Removed from scope**                                         | User decision. Reduces output complexity. Existing loot filter tools handle this better.                                               |
| Localization           | RU added in Phase 7.1 after MVP                                | Don't slow down core dev with translation key plumbing. ~2.5h work.                                                                    |
| Hosting                | `meister0.github.io/eternity` (auto-deploy stays)              | User decision. No domain config needed.                                                                                                |
| Affix DB lazy-load     | Dynamic import on first interaction with `BaseAffixSection`    | Processed affix DB is ~150KB. Initial bundle currently ~50KB. Loading it eagerly would hurt initial paint.                             |
| State management       | Extend existing `SearchState` interface                        | Don't introduce a new state lib. Existing pattern is clean.                                                                            |
| Test coverage          | Only `regex-generator.ts` gets unit tests                      | This is the only correctness boundary. Everything else is visual and verifiable in browser.                                            |

---

## 3. Data sources — empirical findings

### 3.1 What's available from PoB-LE

Files in `data/raw/`, fetched from `raw.githubusercontent.com/Musholic/PathOfBuildingForLastEpoch/master/src/Data/`:

| File                  | Source path                           | Size   | Contents                                                                          |
| --------------------- | ------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `ModItem.json`        | `src/Data/ModItem.json`               | 1.5 MB | 5907 entries, 1112 unique affix IDs, tiers 0-7 with `(min-max)` rolled value text |
| `bases-full.json`     | `src/Data/Bases/bases.json`           | 247 KB | 897 bases with `type`, `req.level`, `implicits[]`, `baseTypeID`, `subTypeID`      |
| `bases.json`          | `src/Data/LEToolsImport/bases.json`   | 120 KB | URL-slug → `{baseTypeId, subTypeId}` lookup (PoB internal)                        |
| `affixes-id-map.json` | `src/Data/LEToolsImport/affixes.json` | 20 KB  | URL-slug → integer affix ID lookup (PoB internal)                                 |

### 3.2 ModItem.json schema (the important one)

```json
"330_7": {
  "affix": "Rejuvenating",
  "1": "{rounding:Integer}(94-110)% increased Mana Regen",
  "level": 0,
  "statOrderKey": 330,
  "statOrder": [330],
  "tier": 7,
  "type": "Suffix"
}
```

| Field                         | Type                 | Notes                                                                                                             |
| ----------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **key**                       | `<affixId>_<tier>`   | Numeric affix ID + tier index. Affix IDs match loot filter `<int>` IDs.                                           |
| `affix`                       | string               | Display name (e.g. "Rejuvenating", "Inevitable")                                                                  |
| `1`, `2`                      | string               | Rolled stat lines. Multi-stat affixes have both. May contain `{rounding:Integer}` markers and `(min-max)` ranges. |
| `level`                       | number               | Required item level (0 = no requirement)                                                                          |
| `statOrderKey`                | number               | Affix family ID. Affixes with same `statOrderKey` are mutually exclusive on the same item.                        |
| `statOrder`                   | number[]             | Always `[statOrderKey]` for single-stat, or list for hybrids.                                                     |
| `tier`                        | number               | 0-7 — see §4 for the indexing decision.                                                                           |
| `type`                        | "Prefix" \| "Suffix" |                                                                                                                   |
| `standardAffixEffectModifier` | number?              | Only on some entries. Internal scaling.                                                                           |

### 3.3 bases-full.json schema

```json
"Refuge Helmet": {
  "type": "Helmet",
  "baseTypeID": 0,
  "subTypeID": 0,
  "req": { "level": 0 },
  "affixEffectModifier": 0,
  "implicits": ["+14 Armor"]
}
```

| Field                     | Type     | Notes                                                                                                                                                                                        |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **key**                   | string   | Base display name                                                                                                                                                                            |
| `type`                    | string   | Slot category: `Helmet`, `Body`, `Belt`, `Boots`, `Gloves`, `Amulet`, `Ring`, `Relic`, `Shield`, `1HSword`, `Bow`, `Idol`, etc. **Same vocabulary as `EquipmentSlot` type in our codebase.** |
| `baseTypeID`, `subTypeID` | number   | Internal IDs                                                                                                                                                                                 |
| `req.level`               | number   | Required character level                                                                                                                                                                     |
| `affixEffectModifier`     | number   | Scaling for affix effects on this base                                                                                                                                                       |
| `implicits`               | string[] | Implicit mods (always rolls)                                                                                                                                                                 |

### 3.4 ⚠️ Critical missing piece: base ↔ affix relationship

**bases-full.json does NOT contain a list of valid affixes per base.** Neither does ModItem.json have a "valid bases" or "valid slots" field per affix. This is the biggest unknown in the project.

**Investigation order (Phase 1 — see §8):**

1. **tunklab.com `_next/data/[buildId]/...`** — Next.js sites usually expose data routes. Tunklab serves Last Epoch affix pages with slot icons. Tunklab returns 200 from US-based fetch but 526 from some user locations — fetching from GitHub Actions should work.
2. **HTML scrape `lastepochtools.com/db/prefixes`** — behind Cloudflare bot challenge (`cf-mitigated: challenge`, 403 to curl). Would need Playwright in a GitHub Action with browser fingerprint.
3. **PoB-LE `Misc.lua` / `ModCache.lua`** — large Lua files. Their planner needs the affix→base relationship internally to apply mods. Worth grepping.
4. **Fallback: slot-only filtering** — if precise base mapping is impractical, group affixes by slot category derived from level field + naming patterns + manual rules. This is enough for ~90% of player workflows because LE affix pools are slot-wide, not base-specific. (E.g., all Belts share the same affix pool — the "base" only differs in implicit and tier value scaling.)

**Decision rule for Phase 1**: 4 hours research budget. If after 4h we don't have a clean automatic mapping, ship MVP with slot-only precision and revisit later.

---

## 4. Tier indexing decision (locked in)

### 4.1 Empirical evidence

Distribution of tier values in `ModItem.json`:

```
Tier 0: 1112 unique IDs   ← every affix has this
Tier 1: 692
Tier 2: 692
Tier 3: 692
Tier 4: 692
Tier 5: 692
Tier 6: 692
Tier 7: 643               ← 49 affixes capped at T6
```

Inference:

- **420 affixes have ONLY tier 0** (1112 - 692 = 420). These are special/legacy mods that PoB-LE has no per-tier breakdown for. Examples: `of Life: +(30-80) Health` — the wide range tells you it's a summary across all tiers, not a real T1 roll.
- **49 affixes have tiers 1-6 but no tier 7**. These are capped affixes (e.g. crafted-only mods, some idol mods).
- **643 affixes have full tier 1-7 progression**.

### 4.2 Verification by value: Inevitable (Void Penetration suffix, affix ID 0)

| ModItem index | Value in dump | Game tier (verified by community sources) |
| ------------- | ------------- | ----------------------------------------- |
| `0`           | +4%           | (no game equivalent — synthetic)          |
| `1`           | +5%           | T1 ✓                                      |
| `2`           | +6%           | T2 ✓                                      |
| `3`           | +7%           | T3 ✓                                      |
| `4`           | +(8-9)%       | T4 ✓                                      |
| `5`           | +(11-12)%     | T5 ✓                                      |
| `6`           | +(13-15)%     | T6 ✓                                      |
| `7`           | +(24-30)%     | T7 ✓                                      |

**Conclusion: ModItem tier index N maps to game tier N for N ∈ {1..7}.** ModItem tier 0 is a synthetic/baseline entry that does NOT correspond to a real game tier.

### 4.3 PoB-LE off-by-one wart

`src/Classes/Item.lua:347-350`:

```lua
local tierIndex = tonumber(affix.modId:match("_(%d+)$"))
if tierIndex and tierIndex >= 5 then
    hasExaltedTier = true
end
```

This treats tier index `>= 5` as "exalted". In game, exalted is T6+. Combined with the value-based 1:1 mapping above, this means PoB-LE's planner displays T5 items as EXALTED rarity, which is wrong. **It's a bug in PoB-LE, not a hint about a different indexing convention.** Don't be misled by it.

### 4.4 Our handling

Codified in `src/data-pipeline/process-data.mjs` and `src/types/affix.ts`:

- **For affixes that have tier 1+ entries**: discard tier 0 entirely (it's synthetic).
- **For the 420 affixes that have ONLY tier 0**: flag them with `hasTierBreakdown: false`. Exclude them from the tier-precision UI flow. Make them findable only by name in a separate "no-tier-data" list, with the raw `(min-max)` displayed as-is.
- **UI labels**: "T1" through "T7" — matches game terminology and matches the stash search `T1`-`T7` macros 1:1.
- **No `+1` adjustment anywhere.** ModItem tier 7 → game T7 → UI "T7" → stash macro `T7`.

---

## 5. UX design

### 5.1 Layout

The new section `BaseAffixSection` slots into `StashSearchBuilder.tsx` between the existing `EquipmentSlotsSection` and `CustomSearchSection`. It is a 3-column flexbox on desktop, accordion on mobile.

```
┌────────────────────────────────────────────────────────────────────┐
│  Affixes by Base                                                   │
├──────────────┬──────────────────────────┬──────────────────────────┤
│ SLOT         │ Base: [Heavy Belt   ▾]   │ Selected affixes (3)    │
│ ○ Helmet     │ Implicit: +12 Health     │                         │
│ ○ Body       │ Req level: 22            │ ┌─────────────────────┐ │
│ ● Belt       │ ──────────────────────── │ │ Health        T7+ ×│ │
│ ○ Boots      │ Search: [crit_______]    │ ├─────────────────────┤ │
│ ○ Gloves     │ ──── Prefixes ────       │ │ Mana Regen    T7  ×│ │
│ ○ Amulet     │  Health        [T7▾] +  │ ├─────────────────────┤ │
│ ○ Ring       │  Armor         [T6+] +  │ │ All Resists   T6+ ×│ │
│ ○ Relic      │  Vitality      [T7] ✓   │ └─────────────────────┘ │
│  ► Weapons   │  Mana Regen    [T7] ✓   │                         │
│  ► Off Hand  │ ──── Suffixes ────       │ Generated regex preview:│
│  ► Idols     │  Crit Avoid    [T5+] +  │ ┌─────────────────────┐ │
│              │  Resistances   [T6+] ✓  │ │ T7&/(9[4-9]|10\d|.. │ │
│              │  ...                     │ │ /increased mana reg.│ │
│              │                          │ └─────────────────────┘ │
│              │                          │ [Copy regex]            │
└──────────────┴──────────────────────────┴──────────────────────────┘
```

### 5.2 Interaction model

| Action                      | Result                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Click slot                  | Loads affix list for that slot category. Resets base picker to "Any base".                   |
| Pick base from dropdown     | Shows implicit, narrows affix pool if §3.4 mapping is precise. Otherwise just informational. |
| Type in affix search        | Filters list by substring of affix display name.                                             |
| Hover tier in selector      | Tooltip: `T7: 94-110% increased mana regen`                                                  |
| Click `+` next to affix     | Adds to selected list with current tier.                                                     |
| Click chip in selected list | Edits tier inline.                                                                           |
| Click `×` on chip           | Removes from selection.                                                                      |
| Output regex                | Auto-updates in main `OutputSection` at bottom of page (existing component).                 |

### 5.3 Validation and warnings

Inline warnings appear in the affix selector row when:

- User picks a tier higher than the affix's max (e.g., T7 on a prefix capped at T6) → "Max tier for this affix is T6"
- Two selected affixes have the same `statOrderKey` (mutually exclusive on the same item) → "Conflicts with: [other affix name]"
- More than 2 prefixes selected → "Items have max 2 prefixes"
- More than 2 suffixes selected → "Items have max 2 suffixes"

These prevent generating regex that can never match an item.

### 5.4 Tier value range tooltips (the educational killer feature)

This is the most important UX element. Most players don't know that "T7 mana regen on chest" means a specific 94-110% range. The tooltip teaches them as they browse. Implementation: small popover anchored to the tier picker showing `Tier N: (min-max)% display text`.

### 5.5 Saved builds (localStorage)

Top of section: "Saved searches" dropdown with named entries. Save current selection with a name, load later. Stored under `localStorage["eternity:saved-builds"]` as JSON. This is critical for crafters who farm specific gear repeatedly.

---

## 6. File structure (target)

New files marked with **NEW**. Existing files marked with _modify_.

```
.github/
  workflows/
    update-data.yml                    NEW   weekly cron + auto-PR
data/
  raw/                                 NEW   gitignored except _meta.json
    ModItem.json                       NEW   from PoB-LE
    bases-full.json                    NEW   from PoB-LE
    affixes-id-map.json                NEW   from PoB-LE
    _meta.json                         NEW   {commitHash, fetchedAt, source}
public/
  data/
    affixes.json                       NEW   processed, served as static
    bases.json                         NEW   processed, served as static
    affix-slots.json                   NEW   from Phase 1 research
scripts/
  update-data.mjs                      NEW   curl PoB-LE → data/raw/
  process-data.mjs                     NEW   data/raw → public/data
  research-affix-slots.mjs             NEW   Phase 1 spike (tunklab/scrape)
src/
  types/
    affix.ts                           NEW   ProcessedAffix, ItemBase, SelectedAffix
    stash-search.ts                    _mod_ add selectedAffixes to SearchState
  data/
    affix-runtime.ts                   NEW   lazy loader for affixes.json
    stash-macros.ts                    _mod_ no breaking changes
  utils/
    regex-generator.ts                 NEW   tier range → regex pattern
    affix-base-index.ts                NEW   slot/base → affixes lookup
    search-parser.ts                   _mod_ recognize generated affix regex
    url-state.ts                       _mod_ encode selectedAffixes
  i18n/                                NEW   Phase 7.1 only
    index.ts                           NEW
    en.ts                              NEW
    ru.ts                              NEW
  components/
    StashSearchBuilder.tsx             _mod_ wire BaseAffixSection
    sections/
      index.ts                         _mod_ export BaseAffixSection
      BaseAffixSection.tsx             NEW   3-column wrapper
      base-affix/
        SlotPicker.tsx                 NEW
        BasePicker.tsx                 NEW
        AffixSelector.tsx              NEW
        AffixTierPicker.tsx            NEW   inline T1-T7 picker
        SelectedAffixList.tsx          NEW
        TierTooltip.tsx                NEW
        SavedBuildsBar.tsx             NEW   Phase 5.3
PLAN.md                                NEW   this file
CLAUDE.md                              _mod_ point future Claude at PLAN.md
README.md                              _mod_ feature description (Phase 7)
package.json                           _mod_ add update-data + process-data scripts
```

---

## 7. Update strategy

### 7.1 Local

```bash
npm run update-data    # curl PoB-LE → data/raw/
npm run process-data   # data/raw/ → public/data/
```

`process-data` is idempotent and produces deterministic output (sorted keys). Safe to run on every build.

### 7.2 CI

`.github/workflows/update-data.yml`:

- Trigger: cron `0 6 * * 1` (Mondays 06:00 UTC) + `workflow_dispatch` (manual)
- Steps: checkout → install → `npm run update-data` → `npm run process-data` → diff → if changed, open PR
- PR title: `chore(data): update affix dump from PoB-LE [auto]`
- Use `peter-evans/create-pull-request@v6`

### 7.3 Snapshot integrity

`data/raw/_meta.json` records:

```json
{
  "fetchedAt": "2026-04-07T17:18:00Z",
  "source": "https://raw.githubusercontent.com/Musholic/PathOfBuildingForLastEpoch/master/src/Data",
  "commitHash": "abc123...",
  "files": {
    "ModItem.json": { "sha256": "...", "size": 1505721 },
    "bases-full.json": { "sha256": "...", "size": 246810 }
  }
}
```

`process-data` reads this and embeds the hash into `public/data/affixes.json` so users can verify their build's data version.

---

## 8. Phase breakdown — full task spec

Each task is sized to 30min–2h. Recreate as `TaskCreate` items in a fresh session.

### Phase 0 — Foundation (4 tasks, can run parallel)

#### P0.1 — Data fetch script

**File**: `scripts/update-data.mjs`
**Goal**: Download `ModItem.json`, `bases-full.json`, `affixes-id-map.json` from PoB-LE master branch into `data/raw/`. Compute SHA-256 of each, write `data/raw/_meta.json` with `{fetchedAt, source, commitHash, files: {name: {sha256, size}}}`. Use Node's built-in `fetch` and `crypto`. Add to `package.json` as `"update-data": "node scripts/update-data.mjs"`.
**Acceptance**: running `npm run update-data` produces 4 files in `data/raw/` and an updated `_meta.json`.

#### P0.2 — Process raw JSONs

**File**: `scripts/process-data.mjs`
**Depends on**: P0.3 types
**Goal**: Read `data/raw/ModItem.json` and `data/raw/bases-full.json`. Output:

- `public/data/affixes.json`: `{ affixId: ProcessedAffix }` where `ProcessedAffix` has `id`, `name`, `type` (Prefix|Suffix), `statOrderKey`, `hasTierBreakdown`, `tiers: ProcessedTier[]`. Each `ProcessedTier` has `tier` (1-7), `displayText`, `valueRanges: [{min, max}]`, `level`. Tier 0 is dropped for affixes with tier 1+. For affixes with only tier 0, store the single entry as `tiers: []` and set `hasTierBreakdown: false` with raw text in a `summaryText` field.
- `public/data/bases.json`: `{ baseName: ProcessedBase }` with `name`, `slot`, `subTypeId`, `level`, `implicits[]`, `affixEffectModifier`.
- Strip `{rounding:Integer}` and similar PoB markers from displayText before storing.
- Parse `(min-max)%` patterns into structured `valueRanges`. Keep the original text too for regex generation.
- Sort all keys for deterministic output.

**Acceptance**: `npm run process-data` produces 2 files in `public/data/`. Spot-check: affix 330 tier 7 should have `valueRanges: [{min: 94, max: 110}]` and `displayText: "(94-110)% increased Mana Regen"`.

#### P0.3 — Type definitions

**File**: `src/types/affix.ts`
**Goal**: Pure TypeScript types, no runtime code. Use `interface` for object shapes, `type` for unions per coding-style.md. All arrays `Readonly`. Key types:

```typescript
interface ProcessedAffix {
  id: number;
  name: string;
  type: 'Prefix' | 'Suffix';
  statOrderKey: number;
  hasTierBreakdown: boolean;
  tiers: readonly ProcessedTier[];
  summaryText?: string; // only when hasTierBreakdown=false
}

interface ProcessedTier {
  tier: number; // 1..7
  displayText: string;
  valueRanges: readonly ValueRange[];
  level: number;
}

interface ValueRange {
  min: number;
  max: number;
}

interface ProcessedBase {
  name: string;
  slot: ItemSlot; // reuse existing EquipmentSlot or new union
  subTypeId: number;
  level: number;
  implicits: readonly string[];
  affixEffectModifier: number;
}

interface SelectedAffix {
  affixId: number;
  minTier: number; // 1..7
  exact: boolean; // if true, only this tier; if false, this tier or higher
}
```

**Acceptance**: `npm run typecheck` passes. No runtime imports.

#### P0.4 — GitHub Action for periodic data updates

**File**: `.github/workflows/update-data.yml`
**Depends on**: P0.1, P0.2 done and committed
**Goal**: Cron `0 6 * * 1`, manual `workflow_dispatch`, runs `npm ci && npm run update-data && npm run process-data`, uses `peter-evans/create-pull-request@v6` to open a PR if `data/raw/_meta.json` changed. PR labeled `data-update`.
**Acceptance**: workflow appears in repo Actions tab. Manual trigger works without errors.

#### P0.5 — Tier indexing documentation in code

**Files**: `scripts/process-data.mjs`, `src/types/affix.ts`
**Goal**: Add a top-of-file comment block in `process-data.mjs` explaining the §4 tier mapping decision in 15 lines: ModItem 1-7 → game T1-T7, tier 0 ignored when tier 1+ exists, otherwise stored as `summaryText`. Reference PLAN.md §4 and PoB-LE `Item.lua:348` off-by-one. Future maintainers must understand this.
**Acceptance**: Comment exists. `process-data.mjs` correctly drops tier 0 for normal affixes.

### Phase 1 — Base/affix mapping research (2 tasks, sequential)

#### P1.1 — Investigate base↔affix mapping sources

**Output**: `docs/data-sources.md` (NEW)
**Time budget**: 4 hours hard cap.
**Goal**: Try in order:

1. `https://lastepoch.tunklab.com/_next/data/[buildId]/affixes.json` — find buildId from HTML, probe data routes.
2. Tunklab affix detail pages — scrape for slot icons (HTML).
3. `lastepochtools.com/db/prefixes` via Playwright in a one-off script (skip if browser fingerprinting blocks).
4. Grep `Misc.lua` and `ModCache.lua` from PoB-LE for affix→slot relations.
5. Decide: precise base mapping or fallback to slot-only.

Document findings, sample data, and the decision in `docs/data-sources.md`. **Stop at 4h budget regardless of completeness.**

**Acceptance**: `docs/data-sources.md` exists with at least one viable data source identified, OR an explicit "fall back to slot-only" decision with reasoning.

#### P1.2 — Build affix→slot mapping JSON

**File**: `public/data/affix-slots.json`, generator in `scripts/generate-affix-slots.mjs`
**Depends on**: P1.1
**Goal**: Based on P1.1 findings, produce `{affixId: [slotName, ...]}`. Validate against known affixes (mana regen → Belt/Amulet/Relic; crit chance → Gloves/Amulet/Ring/Catalyst). Embed source attribution in `_meta` field.
**Acceptance**: At least 600 of 692 normal affixes have non-empty slot arrays. Spot-checks pass for 5 hand-picked affixes.

### Phase 2 — Regex generator core (2 tasks)

#### P2.1 — Regex generator

**File**: `src/utils/regex-generator.ts`
**Depends on**: P0.3
**Goal**: Pure functions:

```typescript
function affixToRegex(affix: ProcessedAffix, minTier: number, exact: boolean): string;
function rangeToRegex(min: number, max: number): string;
function fuseRanges(ranges: ValueRange[]): string; // for T6+ which spans T6+T7
```

- `rangeToRegex(94, 110)` → `(9[4-9]|10\d|110)` (handles boundaries cleanly)
- `affixToRegex` builds: range regex + escaped affix wording stripped of `{rounding:Integer}` markers
- For multi-stat affixes (line "1" + "2"), generate alternation
- For `exact=false` and `minTier=6`, fuse T6 and T7 ranges into one alternation

**Acceptance**: P2.2 tests pass.

#### P2.2 — Regex generator tests

**File**: `src/utils/regex-generator.test.ts`
**Depends on**: P2.1
**Goal**: Add `vitest` dev dependency. Add `npm run test` script. Test cases:

- Mana Regen T7 (affix 330): generated regex should match `"100% increased Mana Regen"`, `"94% increased Mana Regen"`, but NOT `"60% increased Mana Regen"` (T6 value).
- Inevitable T7 (affix 0): match `"24% Void Penetration"` to `"30% Void Penetration"`, not `"15%"` (T6).
- Single-value affix (T1-T3): match exact value.
- Range with boundary numbers (e.g. 10-19 → `1\d`).
- Capped affix at T6: requesting T7 should error or fall back.
- Multi-stat affix (Hirish's): regex includes both stat lines.

**Acceptance**: All tests pass. `npm run test` is wired up.

### Phase 3 — UI components (5 tasks, can parallelize after P0 done)

#### P3.1 — SlotPicker

**File**: `src/components/sections/base-affix/SlotPicker.tsx`
**Goal**: Reuse `EQUIPMENT_SLOT_MACROS` grouping (Armor / Weapons / Off Hands / Idols). Single-select. `selectedSlot` state lifted to `BaseAffixSection`. Reuse Tailwind classes from `EquipmentSlotsSection.tsx` for visual consistency. Accessible `role="radiogroup"`.
**Acceptance**: clicking a slot fires `onSlotChange(slot)` callback. Visual highlight on selected.

#### P3.2 — BasePicker

**File**: `src/components/sections/base-affix/BasePicker.tsx`
**Depends on**: P0.2 (needs `bases.json`)
**Goal**: Combobox of bases filtered by `selectedSlot`. Each option displays base name, req level, and short implicit summary. Default option "Any base on this slot". Selecting a specific base shows its implicits in a small panel below the picker.
**Acceptance**: For slot=Belt, dropdown lists all belts from `bases.json` with `type: "Belt"`. Implicits visible on selection.

#### P3.3 — AffixSelector

**File**: `src/components/sections/base-affix/AffixSelector.tsx`
**Depends on**: P0.2, P1.2 (slot mapping), P3.5 (parent state)
**Goal**: Two-column list (Prefixes | Suffixes) of all affixes valid on current slot. Search input filters by name (debounced 200ms). Each row shows affix name and inline `AffixTierPicker`. Click to add to selection. Hover for tier value range tooltip. Virtualize if list > 100 items (use `react-virtual` only if needed — first try without).
**Acceptance**: For slot=Belt, see all belt-valid prefixes and suffixes. Search "regen" filters to mana regen entries. Adding fires `onAddAffix(affixId, tier)`.

#### P3.4 — SelectedAffixList

**File**: `src/components/sections/base-affix/SelectedAffixList.tsx`
**Goal**: Vertical list of selected affixes as chips. Each chip: `[type-color] AffixName T{tier}{+|=} ×`. Click chip to edit tier. Click × to remove. Empty state: "Pick affixes from the list to start filtering". Color-code prefix vs suffix.
**Acceptance**: Adding/removing affixes updates the list. Tier edit works inline.

#### P3.5 — BaseAffixSection wrapper

**File**: `src/components/sections/BaseAffixSection.tsx`
**Depends on**: P3.1-P3.4
**Goal**: 3-column flexbox on `md+`, accordion on mobile. Owns `selectedSlot`, `selectedBase`, `searchQuery` local state. Receives `selectedAffixes` and setter callbacks via props from parent. Use `SectionContainer` and `SectionHeader` from `components/ui/`.
**Acceptance**: Section renders, all 4 child components mount, callbacks wired.

### Phase 4 — State integration (3 tasks)

#### P4.1 — Extend SearchState

**File**: `src/types/stash-search.ts`, `src/utils/url-state.ts`
**Goal**: Add `selectedAffixes: SelectedAffix[]` to `SearchState`. Update `createInitialState()`. Update `clearURLState()`. URL encoding: serialize as compact `a=330:7+,0:7=` format (affixId:tier{+|=}, comma-separated).
**Acceptance**: Initial state has empty array. URL state round-trips.

#### P4.2 — Wire BaseAffixSection into StashSearchBuilder

**File**: `src/components/StashSearchBuilder.tsx`
**Depends on**: P3.5, P4.1, P2.1
**Goal**:

- Import `BaseAffixSection` and add to layout (between `EquipmentSlotsSection` and `CustomSearchSection`).
- In `generateSearchString()`, after the existing parts, iterate `state.selectedAffixes`, look up the affix in the loaded DB, call `affixToRegex()`, push result to `parts`.
- Add `addSelectedAffix`, `removeSelectedAffix`, `updateSelectedAffix` callbacks.
- Handle async DB load: BaseAffixSection shows loading skeleton until ready.

**Acceptance**: Selecting an affix in the new section updates the output regex at the bottom of the page.

#### P4.3 — Lazy-load affix DB

**File**: `src/data/affix-runtime.ts`
**Goal**: Module-scope cache. `loadAffixDb(): Promise<AffixDb>` does dynamic `import('/data/affixes.json', { with: { type: 'json' } })` (or `fetch` if Astro's static handling needs it). Cache the result. Public API: `useAffixDb()` React hook returning `{ data, loading, error }`. `BaseAffixSection` uses this hook on mount, shows skeleton while loading.
**Acceptance**: Network tab shows `affixes.json` loading only after BaseAffixSection mounts. Initial bundle stays close to current ~50KB.

### Phase 5 — UX polish (3 tasks)

#### P5.1 — Tier value range tooltips

**File**: `src/components/sections/base-affix/TierTooltip.tsx` + integration in `AffixTierPicker`
**Goal**: On hover/focus of a tier in `AffixTierPicker`, show popover: `"T{n}: {displayText}"`. Use Floating UI or pure CSS positioning. Touch-friendly: tap to show on mobile.
**Acceptance**: Hovering T7 on mana regen shows `"T7: (94-110)% increased Mana Regen"`.

#### P5.2 — Validation warnings

**File**: integration in `AffixSelector` and `SelectedAffixList`
**Goal**:

- If `minTier > affix.tiers.length`: inline error in row.
- If two selected affixes share `statOrderKey`: warning chip.
- If selected prefixes > 2 or suffixes > 2: top-of-section banner.
  **Acceptance**: Each warning case visible and dismissable.

#### P5.3 — Saved builds in localStorage

**File**: `src/components/sections/base-affix/SavedBuildsBar.tsx`, `src/utils/saved-builds.ts`
**Goal**: Top of `BaseAffixSection`: row with "Save current as..." input + "Saved:" dropdown of named entries. Click to load. Stored under `localStorage["eternity:saved-builds"]` as `{name: SearchState}`. Max 20 entries, FIFO.
**Acceptance**: Save → reload page → load → state restored.

### Phase 7 — Documentation (1 task — note: Phase 6 was loot-filter export, removed)

#### P7 — Docs

**Files**: `README.md`, `CONTRIBUTING.md` (new), `CLAUDE.md` (modify)
**Goal**:

- README: add feature description, screenshot placeholder, link to PLAN.md.
- CONTRIBUTING.md: explain `npm run update-data` workflow, GitHub Action schedule, where data comes from, attribution to PoB-LE (MIT).
- CLAUDE.md: add a "Data Pipeline" section pointing future Claude sessions at this PLAN.md and the data flow.

**Acceptance**: All three files updated. Attribution to PoB-LE present.

### Phase 7.1 — RU localization (post-MVP)

#### P7.1 — RU localization

**Files**: `src/i18n/{index.ts, en.ts, ru.ts}`, `src/contexts/LangContext.tsx`, modifications to all section components
**Depends on**: P3-P5 done (avoid plumbing translation keys mid-development)
**Goal**:

- Lightweight custom translator (no external library): `t(key)` lookup against dict.
- React Context with `lang: 'en' | 'ru'`, `setLang`, persist to localStorage.
- `<EN | RU>` switcher in header.
- Set `<html lang>` on change.
- Extract ~50 hardcoded UI strings into `en.ts` dict.
- Translate to RU.
- **Do NOT translate game-text affix descriptions** (must match in-game English tooltip for stash search to work). Only translate UI chrome.

**Acceptance**: Switcher works, full RU translation for UI, affix descriptions remain English.

---

## 9. Parallel execution strategy

### Wave 1 (start immediately, 4 parallel)

These have no inter-dependencies and can be dispatched to 4 separate worktrees or sequentially same-session:

- **P0.1** Data fetch script
- **P0.3** Type definitions
- **P0.5** Tier indexing doc (small, can fold into P0.2 if convenient)
- **P1.1** Research spike (longest, start in background)

### Wave 2 (after P0.1 + P0.3 done)

- **P0.2** Process raw JSONs (needs types from P0.3)
- **P2.1** Regex generator (needs types from P0.3, no data dep)
- **P0.4** GitHub Action (needs P0.1)

### Wave 3 (after P0.2 + P2.1 done)

- **P2.2** Regex generator tests (needs P2.1)
- **P3.1** SlotPicker (uses existing data, no deps on P0.2)
- **P3.4** SelectedAffixList (no data deps)
- **P1.2** Affix→slot mapping (needs P1.1)

### Wave 4 (after P3.1, P3.4, P0.2, P1.2 done)

- **P3.2** BasePicker (needs P0.2)
- **P3.3** AffixSelector (needs P0.2 + P1.2)
- **P3.5** BaseAffixSection wrapper (needs P3.1-P3.4)
- **P4.1** SearchState extension (no deps)
- **P4.3** Lazy-load DB (no deps on UI)

### Wave 5 (after Wave 4 done)

- **P4.2** Wire into StashSearchBuilder
- **P5.1** Tier tooltips (UI ready)
- **P5.2** Validation
- **P5.3** Saved builds

### Wave 6

- **P7** Docs
- **P7.1** RU localization

### Critical path

Longest sequential chain (worst case if no parallelism):
P0.3 → P0.2 → P3.3 → P3.5 → P4.2 → P5.x → P7.1

With aggressive parallelism: ~3 waves of work, since most UI components in P3 are independent and can develop in parallel worktrees.

---

## 10. Open questions / decisions for next session

1. **Test framework**: vitest is the natural fit (Astro project, modern). Confirm before adding.
2. **Floating UI vs CSS popover**: for tier tooltips. Start with CSS, escalate to Floating UI only if positioning gets ugly.
3. **Virtualization for long affix lists**: defer until profiling shows it's needed. ~700 items shouldn't need it.
4. **`statOrderKey` mutual exclusion** in UI: do we hide conflicting affixes after one is selected, or just warn? **Default decision: warn, don't hide** (user might want to swap). Revisit if it causes confusion.
5. **URL state size**: with selected affixes, URL can grow. No fix planned for v1; if it crosses 2KB we add Base64 compression.
6. **Idol slot handling**: idols have a different affix pool and only 2 affix slots. The UI should adapt the prefix/suffix limit warning. Not blocking but document during P3.3.

---

## 11. Glossary

- **Affix**: A prefix or suffix mod on an item. Has tiers T1-T7.
- **Tier (T1-T7)**: Affix strength level. T1-T5 craftable, T6-T7 drop-only ("exalted").
- **Exalted item**: Item with at least one T6 or T7 affix.
- **`statOrderKey`**: Affix family ID. Affixes with the same key are mutually exclusive on one item (e.g., two different mana regen variants).
- **Implicit**: A mod that's always present on a base, not a rolled affix.
- **Slot category**: `Helmet`, `Body`, `Belt`, etc. — what equipment slot the item goes in.
- **Base / item base**: A specific item type within a slot (e.g., "Heavy Belt" within Belt slot). Has its own implicit and tier value scaling.
- **Loot filter**: LE's XML-based item highlighting system. Has structured affix-ID + tier conditions. Out of scope for this project but our affix IDs are compatible with it.
- **Stash search**: LE's text-based search for items in stash tabs. Supports macros, regex, and expressions. The output of this project.
- **PoB-LE**: Path of Building for Last Epoch — open source build planner forked from PoB. Our data source.
- **`{rounding:Integer}`**: Marker in PoB-LE display text indicating the value should be rounded to integer for display. Strip before showing to user.

---

## 12. Attribution

This project depends on data from [PathOfBuildingForLastEpoch](https://github.com/Musholic/PathOfBuildingForLastEpoch) (MIT license), which itself imports data from [Last Epoch Tools](https://www.lastepochtools.com/). Both must be credited in README.md and CONTRIBUTING.md when Phase 7 ships.

Last Epoch is a game by Eleventh Hour Games. This project is a community fan tool and not affiliated with EHG.
