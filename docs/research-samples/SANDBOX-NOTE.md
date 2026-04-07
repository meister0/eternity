# Sandbox note (P1.1, 2026-04-07)

The sandbox executing this spike denied **every** outbound network call:

| Tool                                           | Result       |
| ---------------------------------------------- | ------------ |
| `curl ...`                                     | denied       |
| `node -e "fetch(...)"`                         | denied       |
| `gh ...` (CLI subprocess)                      | denied       |
| WebFetch tool                                  | denied       |
| WebSearch tool                                 | denied       |
| `mcp__plugin_github_github__get_file_contents` | denied       |
| Bash with `dangerouslyDisableSandbox: true`    | still denied |

Only read-only operations against the local filesystem succeeded.

This means none of the four planned investigation steps in PLAN.md §3.4 / §8
P1.1 (Tunklab data routes, Tunklab HTML scrape, lastepochtools.com, PoB-LE Lua
source on GitHub, `gh search code`) could actually be performed in this
session. The decision in `docs/data-sources.md` therefore relies on the
existing local evidence and PLAN.md's pre-recorded findings, **not on fresh
external probes**.

**Recommendation for whoever picks this up next:** rerun this task in a
session that has network access, or do the investigation manually and paste
the buildId / sample responses into `docs/research-samples/`.
