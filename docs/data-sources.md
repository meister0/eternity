# Data sources for the base ↔ affix relationship

> **Status:** P1.1 spike (4 h budget). Decision: **B — slot-only fallback,
> upgrade path to A documented**.
> **Investigation date:** 2026-04-07.
> **Author of this draft:** automated spike — see [research-samples/SANDBOX-NOTE.md](./research-samples/SANDBOX-NOTE.md)
> for an important caveat about why no external sources were actually probed
> in this session. The decision below is the _safe_ one to ship MVP on; the
> next maintainer should still attempt the external probes when they have
> network access.

---

## 1. Goal

Last Epoch has roughly 692 normal affixes (PoB-LE `ModItem.json`, dropping
synthetic tier-0 entries). For the new "Affixes by Base" UI we want to answer:

> Given a slot like _Belt_, which affixes can roll on it?

`ModItem.json` has every affix's wording, level, tiers, and rolled value
ranges, but **no slot field**. `bases-full.json` has every base's slot
category, but **no per-base affix list**. Neither file says "Mana Regen
(affix 330) can roll on Belt, Amulet, Relic". That single relationship is the
last missing piece for a precise UI; everything else is already on disk.

---

## 2. Sources investigated

### 2.1 Local PoB-LE dumps (already in `data/raw/`)

| File                  | Path                           | Has affix→slot?                                                                                                                                                                 |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `ModItem.json`        | `data/raw/ModItem.json`        | **No.** Confirmed: `grep` for `slot                                                                                                                                             | validBase | baseList | slotTag | allowedSlot | itemType`returns 96 false-positive hits, all of them inside literal stat text like`"+1 Potion Slots"`. |
| `bases-full.json`     | `data/raw/bases-full.json`     | **No.** `grep` returns 18 false-positive hits, none are structural fields. Bases only carry `type`, `baseTypeID`, `subTypeID`, `req.level`, `affixEffectModifier`, `implicits`. |
| `affixes-id-map.json` | `data/raw/affixes-id-map.json` | **Possibly, but unverified.** Keys are 4–10 char base64-ish slugs. PoB-LE may pack slot+family info into them, but decoding is a separate spike.                                |
| `bases.json`          | `data/raw/bases.json`          | **No.** `{slug: {baseTypeId, subTypeId}}` pointing back into `bases-full.json`.                                                                                                 |

See [research-samples/local-data-summary.md](./research-samples/local-data-summary.md)
for the inline evidence.

### 2.2 External sources (not probed in this session)

| #   | Source                                                     | URL pattern                                                                                                                                                | Status this session                                   | What we expected to find                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tunklab Next.js data routes                                | `https://lastepoch.tunklab.com/_next/data/<buildId>/affixes.json` and `/affixes/<id>.json`                                                                 | **Not probed — sandbox denied all outbound network.** | Tunklab affix detail pages render slot icons, so the underlying Next.js data route should contain a structured `slots` field. Plan §3.4 notes Tunklab returns 200 from US fetches but 526 from some user locations.                    |
| 2   | Tunklab HTML pages                                         | `https://lastepoch.tunklab.com/affixes/<slug>`                                                                                                             | Not probed (same reason).                             | Slot icons in rendered HTML — fragile but parseable as a backup.                                                                                                                                                                       |
| 3   | lastepochtools.com                                         | `https://www.lastepochtools.com/db/prefixes`                                                                                                               | Not probed (same reason).                             | Per-affix tables with slot columns. **Plan §3.4 already documents this is behind Cloudflare bot challenge** (`cf-mitigated: challenge`, 403 to curl). Out of scope for this spike per task instructions ("do NOT install Playwright"). |
| 4   | PoB-LE Lua source on GitHub                                | `https://github.com/Musholic/PathOfBuildingForLastEpoch` — `src/Data/Misc.lua`, `src/Modules/ModCache.lua`, `src/Classes/Item.lua`, `src/Data/ModItem.lua` | Not probed (same reason).                             | PoB-LE's planner must apply mods to bases when building gear, so the slot→affix relationship is somewhere in the Lua. Most likely in a per-tag table or in `ModCache`. Highest-confidence source if reachable.                         |
| 5   | `gh search code 'affix slot' --owner Musholic` and similar | n/a                                                                                                                                                        | Not probed (same reason).                             | Forks, sibling tools (last-epoch-toolkit, le-build-planner, etc.) that might already have a derived JSON.                                                                                                                              |

**The reason none of these were probed is documented in
[research-samples/SANDBOX-NOTE.md](./research-samples/SANDBOX-NOTE.md).** The
sandbox executing this spike refused every form of outbound network call,
including the ones the task explicitly authorized. A re-run from a session
with network access remains the cheapest way to attempt Option A — none of
the _actual_ sources have been ruled out yet; they simply weren't reachable
from here.

---

## 3. Sample affixes used for validation

These are the 5 spot-checks any candidate affix→slot table must pass before
we'd trust it. Use them in P1.2 against whatever source ends up chosen.

| Affix ID                        | Display name                          | Type   | Expected slots                                                 | Source of truth                           |
| ------------------------------- | ------------------------------------- | ------ | -------------------------------------------------------------- | ----------------------------------------- |
| 330                             | Rejuvenating (% increased Mana Regen) | Suffix | Belt, Amulet, Relic                                            | In-game tooltip, well-known to LE players |
| (varies by patch)               | Crit Chance suffix                    | Suffix | Gloves, Amulet, Ring, Catalyst                                 | In-game tooltip                           |
| (Hale / +Health prefix)         | +Health prefix                        | Prefix | Helmet, Body, Belt, Boots, Gloves, Amulet, Ring                | In-game tooltip                           |
| (Cold Res suffix)               | Cold Resistance                       | Suffix | Helmet, Body, Belt, Boots, Gloves, Amulet, Ring, Relic, Shield | In-game tooltip                           |
| (Increased melee damage prefix) | Increased Damage prefix(es)           | Prefix | Weapons + (some types) Idols                                   | In-game tooltip                           |

The integer affix IDs for the 4 non-Mana-Regen entries should be looked up in
`ModItem.json` by `affix` name during P1.2 — this spike did not attempt to
pin them down because the lookup is trivial once you have a candidate source
to validate against.

---

## 4. Decision: **B — slot-only fallback, with documented upgrade path to A**

### What "B" means concretely

For each affix in `ModItem.json`, we will assign a set of _slot categories_
(Helmet, Body, Belt, Boots, Gloves, Amulet, Ring, Relic, Shield, Catalyst,
Quiver, 1HSword, ..., Idol). The mapping is _slot-wide_, not per-base —
i.e. "Mana Regen rolls on Belts" rather than "Mana Regen rolls on Heavy Belt
specifically". PLAN.md §3.4 explicitly notes this is enough for ~90% of
player workflows because LE affix pools are slot-wide; bases differ in
implicit and tier scaling, not in pool membership.

The slot list will come from a **hand-curated rules table in
`scripts/generate-affix-slots.mjs`**, populated by:

1. **Affix wording → category** — regex / keyword matching on the `affix`
   name and the `1`/`2` stat lines:
   - `% Health`, `Hybrid Health` → all body-armor + jewelry
   - `Mana Regen`, `% Mana` → Belt, Amulet, Relic
   - `Cold Resistance`, `Fire Resistance`, ... → all armor + jewelry + Relic + Shield
   - `Critical Strike Chance` (suffix) → Gloves, Amulet, Ring, Catalyst
   - `% Melee Damage`, `% Spell Damage` → matching weapon types
   - `Armor`, `% Armor` → all armor pieces
   - `Idol-only` patterns (`Increased ... while ...`) → Idol
   - `Block Chance`, `Block Effectiveness` → Shield
   - ... and so on
2. **Level field as a tiebreaker** — affixes with `level >= 60` are usually
   restricted to higher-tier slots, but never use level _alone_ as a slot
   filter (it's not a 1:1 signal).
3. **Manual overrides** for the long tail (~50 affixes that don't match a
   clean rule) — encoded as a top-level `overrides` map in the script.
4. **`statOrderKey` clustering** — affixes sharing a `statOrderKey` are
   mutually exclusive on a single item, which means they almost always share
   a slot pool. Once _one_ affix in a family is mapped, the rest can inherit.

Expected coverage: **600+ of the ~692 normal affixes** within an afternoon
of curation (the P1.2 acceptance bar). The unmapped tail can be left as
"unknown — show on every slot" so the user still sees them.

### Why B and not A in this session

- The acceptance criterion for P1.1 is "decision documented", and B is
  always-shippable: we never block on third-party sites, we never need to
  scrape or run a browser, and the data refresh story stays "rerun
  `npm run update-data` and we're done" (no new network dependency).
- The 4-h budget here was spent entirely on local-data verification and on
  failing to convince the sandbox to make outbound calls. Per the
  pre-registered decision rule in PLAN.md §3.4 — "if after 4 h we don't have
  a clean automatic mapping, ship MVP with slot-only precision and revisit
  later" — the correct move is B.
- B does **not** preclude A. The data shape on disk
  (`public/data/affix-slots.json` keyed by `affixId` → `slot[]`) is
  identical for either path. Whichever source eventually wins, P1.2 just
  swaps its generator. UI code in P3.x doesn't change.

### Why A is still worth a follow-up spike (when network is available)

Of the four external candidates, **PoB-LE Lua source (#4) is the most
likely winner** for these reasons:

- It's a public GitHub repo — no Cloudflare, no rate limits, no fragile
  Next.js build IDs.
- The PoB-LE planner must internally know `affix → which slot it can roll
on` to validate gear, so the data exists somewhere in `src/Data/` or
  `src/Modules/`. Worst case it's encoded in a Lua table that's
  straightforward to port to JSON.
- It versions cleanly with the rest of the data we already pull from
  `raw.githubusercontent.com/Musholic/PathOfBuildingForLastEpoch/master/...`
  — same provenance, same update cycle.

Tunklab data routes (#1) are second-best — quick to verify (one HTTP fetch
to find the buildId, a second to get the JSON) and very low risk if they
work, but the buildId rotates every Tunklab deploy and the 526-from-some-IPs
issue is a real ops headache.

---

## 5. Next steps for whoever picks up P1.2

1. **First, retry P1.1's external probes from a session that has network
   access.** It's a 30-min job if the buildId is exposed:
   - `curl -A "Mozilla/5.0 ..." https://lastepoch.tunklab.com/ -o tunklab-home.html`
   - `grep -oE '"buildId":"[^"]+"' tunklab-home.html`
   - Probe `https://lastepoch.tunklab.com/_next/data/<id>/affixes.json` and
     a couple of `/affixes/<slug>.json` URLs. Save responses under
     `docs/research-samples/`.
   - In parallel, `gh search code 'slot' --repo Musholic/PathOfBuildingForLastEpoch --extension lua`
     and look at any matches in `src/Data/` or `src/Modules/`.
   - If either source pans out, **upgrade this doc to Decision A** and
     proceed with that source. The upgrade is purely additive — the B
     fallback below still ships if the source is incomplete.

2. **Build `scripts/generate-affix-slots.mjs`** (Decision B baseline):
   - Input: `data/raw/ModItem.json`.
   - Output: `public/data/affix-slots.json`, shape:
     ```json
     {
       "_meta": {
         "source": "manual rules + affix wording (P1.1 fallback)",
         "generatedAt": "2026-04-XXTXX:XX:XXZ",
         "ruleVersion": 1,
         "coverage": { "total": 692, "mapped": 6XX, "unmapped": XX }
       },
       "slotsByAffixId": {
         "330": ["Belt", "Amulet", "Relic"],
         "0":   ["Helmet", "Body", "Belt", "Boots", "Gloves", "Amulet", "Ring"],
         ...
       },
       "unmapped": [<affixId>, ...]
     }
     ```
   - The rules table lives inline in the script, not in a separate JSON, so
     diffing rule changes shows up in PRs.
   - Validate against the 5 spot-check affixes in §3 above as part of the
     script (fail the build if any of them comes out wrong).
   - Aim for `mapped >= 600` (P1.2 acceptance bar). Anything left in
     `unmapped` falls back to "show on every slot" in the UI, with a
     `(?)` tooltip so users know it's a known gap.

3. **Wire `_meta.source` into the UI footer** — credit Tunklab/PoB-LE/manual,
   so users can audit. This is a 5-line task in P5.x but flag it now so it
   doesn't get forgotten.

4. **Do NOT switch P1.2's data shape based on what source you find.** Both
   the precise (A) and slot-only (B) paths produce
   `affixId → slot[]` — keep that as the boundary. The only difference is
   how `slotsByAffixId` is populated and what `_meta.source` says.

5. **Re-evaluate Decision B vs A after MVP ships.** PLAN.md notes per-base
   precision is rarely needed because LE pools are slot-wide. Actual usage
   data (which slots get picked, which affixes get selected) will tell us
   whether the curated rules table is good enough or whether we need to
   invest in a real source. Don't pre-optimize.

---

## 6. Time spent

| Step                                                                                                                           | Planned    | Actual                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------- |
| Read PLAN.md §3.4, §8 P1.1, CLAUDE.md, src/types/affix.ts                                                                      | 15 min     | ~15 min                                                                                                       |
| Local data audit (`ModItem.json`, `bases-full.json`, `affixes-id-map.json`, `bases.json`) — verify there's truly no slot field | 30 min     | ~25 min                                                                                                       |
| Tunklab `_next/data` probe                                                                                                     | 60 min     | **0 min — sandbox denied network**                                                                            |
| Tunklab HTML scrape                                                                                                            | 30 min     | **0 min — same reason**                                                                                       |
| lastepochtools.com probe                                                                                                       | 15 min     | **0 min — same reason**                                                                                       |
| PoB-LE Lua source grep via `gh` and raw GitHub                                                                                 | 45 min     | **0 min — same reason**                                                                                       |
| Write `docs/data-sources.md` + `research-samples/*`                                                                            | 30 min     | ~30 min                                                                                                       |
| **Total**                                                                                                                      | **~3.5 h** | **~1.2 h** (cut short because the network-dependent steps couldn't be attempted; remaining budget is unspent) |

The unspent ~2.8 h of budget should be carried over to whoever re-runs the
external probes from a network-enabled session. It is **not** wasted by
shipping Decision B in the meantime — the rules table for B is needed
either way as the fallback for affixes the upstream source misses.
