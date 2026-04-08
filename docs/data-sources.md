# Data sources

> **Status:** Current as of 2026-04-08. Decision A (precise per-affix slot and tier mapping via Tunklab) is locked in and empirically verified.
> **Supersedes:** the earlier P1.1 spike note that shipped Decision B (slot-only fallback). See §7 for the history.

---

## 1. Goal

The search-builder UI needs structured, per-affix metadata for every rollable mod in Last Epoch: canonical name, prefix/suffix classification, category, the exact set of slots the affix can roll on, and the rolled value range at every tier (T1 through T8, including the new T8 primordial). PoB-LE gives us the ~1112 affix IDs and numeric tier scaffolding, but its display fields are incomplete and predate the primordial season. This doc describes how we fill that gap by joining PoB-LE with a scraped copy of Tunklab, which side of each join wins on which field, and why we rejected the other candidate sources.

---

## 2. Sources

### 2.1 Tunklab — primary

- **URL:** <https://lastepoch.tunklab.com>
- **Maintained by:** community user "Tunk".
- **Stack:** server-rendered Next.js with Ant Design tables.
- **Coverage:** every rollable affix in Last Epoch, with a detail page per affix slug (e.g. `/affix/increased_mana_regen`). Sitemap enumerates 1112 affix URLs — exact 1:1 match with PoB-LE's distinct affix IDs.
- **Fields used:** `ID`, `Name`, `Nickname`, `Type` (Prefix/Suffix), `Category`, `Applies To` (slot list), `Rarity on Items`, `Modified Stats`, and the per-slot scaled-value table with columns `Tier1..Tier8`.
- **Why a headless browser:** the meta key/value table is in the raw HTML, but the scaled-values table is rendered client-side by Ant Design after JS hydration. `curl` returns a page stub without the Tier6/Tier7/Tier8 columns. We drive a headless Chromium via the globally-installed `playwright-cli` binary from `scripts/scrape-tunklab.mjs` (see §3). A full scrape of all 1112 pages takes roughly ten minutes and is fully resumable — any per-slug cache file that already exists is skipped on re-run.
- **License:** unclear from the site itself. We credit Tunklab and "Tunk" by name and link per §8. If a license statement surfaces later, update README/CONTRIBUTING accordingly.

### 2.2 PoB-LE — secondary join partner

- **URL:** <https://github.com/Musholic/PathOfBuildingForLastEpoch> (MIT licensed)
- **Fetched from:** `raw.githubusercontent.com/Musholic/PathOfBuildingForLastEpoch/master/src/Data/`
- **Files used:** `ModItem.json`, `Bases/bases.json`, `LEToolsImport/affixes.json`, plus a commit-SHA pin captured in `data/raw/_meta.json`.
- **Fields we trust from PoB-LE:**
  - **`statOrderKey`** — integer affix-family ID used to detect mutually exclusive affixes on one item (the source of the UI's "conflicts with X" warning). Tunklab does not expose this.
  - **Per-tier `level`** — the required item level for each individual tier. Tunklab only publishes an aggregate level requirement per affix.
  - **Cheap enumeration** — the 1112 distinct affix IDs and their numeric tier scaffolding come essentially for free from a single HTTP fetch, so we use PoB-LE as the outer loop and Tunklab as the enrichment lookup.
- **Fields we deliberately drop from PoB-LE:**
  - `affix` (display name) — frequently `null` or an internal slug.
  - `type` (Prefix/Suffix) — contains known misclassifications. The canonical counter-example is affix `330` Mana Regeneration, which PoB-LE tags as `Suffix` but is actually a `Prefix` in-game and on Tunklab. We have independently verified several more such mismatches.
  - Per-tier value ranges — PoB-LE exposes a single "default" set per affix with no per-slot variation. Tunklab carries a full per-slot table and differs meaningfully (e.g. Mana Regen T8 is 94-110% on Belt/Relic/Ring but 110-129% on Amulet).
  - Tier count — PoB-LE predates the T8 primordial tier and caps at what is now called T7 in-game.

### 2.3 lastepochtools.com — investigated and rejected

`https://www.lastepochtools.com/db/prefixes` has comparable coverage but is protected by Cloudflare. Anonymous requests return HTTP 403 with `cf-mitigated: challenge`, and the page cannot be retrieved without browser fingerprinting, residential proxies, or a paid scraping service. None of this is worth building now that Tunklab gives us everything we need without a bot challenge. We will revisit only if Tunklab disappears or stops tracking new affixes.

---

## 3. Pipeline

```
Weekly cron / manual trigger
     │
     ▼
┌─────────────────────────┐
│ npm run update-data     │  fetches upstream canonical snapshots
│                         │    → data/raw/ModItem.json
│                         │    → data/raw/bases-full.json
│                         │    → data/raw/affixes-id-map.json
│                         │    → data/raw/tunklab-sitemap.xml
│                         │    → data/raw/_meta.json  (hashes + PoB-LE commit SHA)
└─────────────────────────┘
     │
     ▼
┌─────────────────────────┐
│ npm run scrape-tunklab  │  headless-browser crawl via playwright-cli
│                         │    → data/raw/tunklab-cache/<slug>.json  (1112 files)
│                         │    resumable; skips already-cached slugs
│                         │    ~10 minutes for a full cold run
│                         │    the cache directory is gitignored
└─────────────────────────┘
     │
     ▼
┌─────────────────────────┐
│ npm run process-data    │  PoB-LE ⋈ Tunklab, flattens, validates
│                         │    → public/data/affixes.json
│                         │    → public/data/bases.json
└─────────────────────────┘
     │
     ▼
   git diff → if changed, peter-evans/create-pull-request opens auto-PR
```

Relevant scripts:

| Script                       | Role                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/update-data.mjs`    | Fetches PoB-LE files and the Tunklab sitemap, hashes everything, writes `_meta.json`.                                     |
| `scripts/scrape-tunklab.mjs` | Reads the sitemap, drives `playwright-cli` in batches of 25, writes one JSON per affix slug to `data/raw/tunklab-cache/`. |
| `scripts/process-data.mjs`   | Joins PoB-LE ModItem entries with Tunklab cache entries by affix ID, produces the public JSON artefacts the UI loads.     |

`scripts/build-affix-slots.mjs` currently exists as a standalone cache consumer; it is being folded into `process-data.mjs` as part of the schema migration (task G) and will be removed.

---

## 4. Coverage

From the ModItem.json tier distribution (verified 2026-04-08):

| Cohort                       | Count | Notes                                                                        |
| ---------------------------- | ----- | ---------------------------------------------------------------------------- |
| **Total distinct affix IDs** | 1112  | Exact 1:1 match between PoB-LE ModItem.json and the Tunklab sitemap.         |
| Full T1..T8 progression      | 643   | Standard craftable → exalted → primordial progression.                       |
| T1..T7 only (capped)         | 49    | No primordial roll exists for these.                                         |
| Single-T1 entries            | 420   | Special-category affixes — altar, idol-only, sealed-only, unique rolls, etc. |

The 420 single-tier entries are no longer treated as "broken / summary-only" the way the original P1.1 spike assumed. They are first-class affixes with exactly one tier; the UI renders them with a fixed-T1 label instead of a tier picker.

---

## 5. Why Tunklab is the primary source

- **Canonical names.** PoB-LE frequently has `null` or an internal slug in the `affix` field; Tunklab always has the in-game display name plus a separate nickname (e.g. `Name: "Mana Regeneration"`, `Nickname: "Rejuvenating"`).
- **Correct Prefix/Suffix classification.** PoB-LE has known misclassifications. Affix `330` Mana Regeneration is the reference case: PoB-LE says `Suffix`, Tunklab (and the in-game UI) says `Prefix`. We have encountered more such mismatches during scraping.
- **Per-slot tier value variations.** A single affix often rolls at different values depending on slot. PoB-LE only stores one "default" set; Tunklab's scaled-values table has one row per slot. For affix `330`, Belt/Relic/Ring share one scale but Amulet is 10-20% stronger at every tier.
- **T8 primordial tier.** Tunklab already renders the new top tier; PoB-LE is frozen at its pre-primordial state and would falsely cap every affix one tier early if we trusted its tier count.
- **Extra fields.** `Category` (Normal Affix / Idol Affix / Altar / etc.), class requirement, and the natural-language `Modified Stats` description all come from Tunklab.

## 6. Why PoB-LE is still needed

- **`statOrderKey`** — drives the "these two affixes are mutually exclusive on one item" warning in the UI. Tunklab does not expose family IDs.
- **Per-tier `level` requirement** — Tunklab shows one aggregate level per affix; PoB-LE breaks it down per tier, which is needed for "minimum item level" filtering.
- **Cheap enumeration** — the 1112 affix IDs and their numeric tier scaffolding are available from a single HTTP fetch, which makes PoB-LE a natural outer loop for the join.

The join rule in `process-data.mjs` is therefore: start from PoB-LE ModItem entries, key by numeric affix ID, and let Tunklab overwrite `name`, `nickname`, `type`, `category`, `slots`, and the per-slot tier value table. PoB-LE keeps ownership of `statOrderKey` and per-tier `level`.

---

## 7. History

The first investigation of this question was the P1.1 research spike on 2026-04-07. That session was running in a sandbox that denied all outbound network, so none of Tunklab, lastepochtools.com, or the PoB-LE Lua source could actually be probed — the spike fell back to **Decision B (slot-only fallback)** as its "always shippable" choice and documented an upgrade path.

The re-investigation on 2026-04-08 was run from a session with real network access. Two things changed:

1. Tunklab turned out to be trivially reachable and has a complete sitemap of 1112 affix pages. The only wrinkle was that `curl` alone cannot see the Tier6/Tier7/Tier8 columns (client-side rendered), which was resolved by routing the scrape through the globally-installed `playwright-cli` binary rather than adding a `playwright` npm dep.
2. Spot-checking affix `330` Mana Regeneration exposed the **T8 primordial tier** as a concrete seven-entry → eight-entry shift, and independently confirmed the **PoB-LE Prefix/Suffix misclassification**. Belt T1 = 10-14%, Belt T8 = 94-110%, Amulet T8 = 110-129%. These values do not line up with PoB-LE's assumptions, so precise mapping became both possible and mandatory.

The slot-only fallback from 2026-04-07 has been retired; Decision A is now the shipped path. The `docs/research-samples/` directory is preserved as an artefact of the original spike — do not delete or edit those files, they are the historical record of why we changed course.

---

## 8. Attribution

- **Tunklab** — <https://lastepoch.tunklab.com>, maintained by community user "Tunk". Provides canonical affix metadata and tier values. Credit the author and URL; re-check the license statement the next time the site is scraped.
- **PathOfBuildingForLastEpoch** — <https://github.com/Musholic/PathOfBuildingForLastEpoch>, MIT-licensed, maintained by Musholic. Provides the affix enumeration, `statOrderKey`, and per-tier level requirements.
- **Last Epoch** — a game by Eleventh Hour Games. This project is a community fan tool and not affiliated with EHG.

Both Tunklab and PoB-LE **must** be credited in `README.md` and `CONTRIBUTING.md` as part of Phase 7 (see `PLAN.md` §12). The existing README/CONTRIBUTING predate the Tunklab dependency and currently only mention PoB-LE; updating them is tracked separately.
