#!/usr/bin/env node
// scripts/scrape-tunklab.mjs
//
// Scrapes Tunklab affix detail pages (https://lastepoch.tunklab.com/affix/<slug>)
// for the per-affix metadata that PoB-LE's ModItem.json is missing or has wrong:
// canonical name, type (Prefix/Suffix), nickname, category, slot list, and
// per-slot tier value tables (T1..T8 including T8 primordial).
//
// Why a wrapper instead of importing playwright directly:
//   The user's environment already has the `playwright-cli` global binary, so
//   we don't add a `playwright` npm dep to package.json. Instead this script
//   spawns playwright-cli with a persistent browser session and drives it via
//   `run-code` invocations in batches.
//
// Why batching instead of one giant run-code:
//   `run-code` runs in a sandboxed Node context with NO `require` and NO `fs`,
//   so the function body cannot persist anything to disk. We process N URLs
//   per invocation, return the parsed data via the function return value
//   (captured from playwright-cli stdout under the "### Result" header), and
//   the parent Node process here writes each result to the cache directory.
//
// Output:
//   data/raw/tunklab-cache/<slug>.json    raw scraped per-affix records (gitignored)
//
// Resumability:
//   On every run, URLs whose cache file already exists are skipped, so a
//   crashed/aborted run can be re-invoked without re-fetching pages.
//
// Usage:
//   node scripts/scrape-tunklab.mjs              # full run, ~1112 pages
//   node scripts/scrape-tunklab.mjs --limit=10   # quick test on 10 pages
//   node scripts/scrape-tunklab.mjs --slugs=a,b  # only specific slugs

import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SITEMAP_PATH = path.join(REPO_ROOT, 'data', 'raw', 'tunklab-sitemap.xml');
const CACHE_DIR = path.join(REPO_ROOT, 'data', 'raw', 'tunklab-cache');

const SESSION = 'tunklab';
const BATCH_SIZE = 25;
const MAX_BUFFER = 50 * 1024 * 1024; // 50MB stdout buffer per playwright-cli call

// ---------------------------------------------------------------------------
// playwright-cli driver
// ---------------------------------------------------------------------------

async function pwcli(args) {
  const { stdout, stderr } = await execFileP('playwright-cli', args, {
    maxBuffer: MAX_BUFFER,
  });
  return { stdout, stderr };
}

/**
 * Parse a "### Result" block from playwright-cli stdout.
 * The output of `run-code` looks like:
 *   ### Result
 *   <JSON value>
 *   ### Ran Playwright code
 *   ...
 */
function parseResult(stdout) {
  const start = stdout.indexOf('### Result');
  if (start === -1) {
    throw new Error('playwright-cli stdout missing "### Result" header:\n' + stdout.slice(0, 500));
  }
  const after = stdout.slice(start + '### Result'.length);
  const end = after.indexOf('### Ran Playwright code');
  const block = (end === -1 ? after : after.slice(0, end)).trim();
  if (!block) {
    throw new Error('playwright-cli "### Result" block was empty');
  }
  try {
    return JSON.parse(block);
  } catch (err) {
    throw new Error(
      `failed to parse "### Result" JSON: ${err.message}\nblock head: ${block.slice(0, 500)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tunklab page extraction (runs inside playwright-cli sandbox)
// ---------------------------------------------------------------------------
//
// Returned as a JS function source — embedded into the run-code argument with
// the URL list spliced in. Function signature: `async (page) => { ... }`.
//
// Inside the sandbox we have `page` (Playwright Page object) and standard
// JS, but NOT require/fs. We `await page.goto(...)` then `page.evaluate(...)`
// (which runs in the BROWSER context) to walk the rendered DOM.
function buildBatchScript(urls) {
  // Stringify the URL list as a JS array literal so it embeds cleanly into
  // the function body. JSON.stringify keeps quoting safe.
  const urlListLiteral = JSON.stringify(urls);

  return `async (page) => {
    const URLS = ${urlListLiteral};
    const results = [];
    for (const url of URLS) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Wait until the Ant Design table has hydrated and the Tier8 column
        // (or Tier7 for capped affixes) appears in the DOM. Cap at 5s.
        await page.waitForFunction(
          () => {
            const text = document.body.innerText || '';
            return text.includes('Tier1');
          },
          { timeout: 5000 },
        ).catch(() => {});
        // Extract structured data from the rendered DOM.
        const data = await page.evaluate(() => {
          const tables = Array.from(document.querySelectorAll('table'));
          // Tunklab has two tables: meta key/value, then scaled values.
          const meta = {};
          if (tables[0]) {
            for (const tr of tables[0].querySelectorAll('tr')) {
              const cells = tr.querySelectorAll('td, th');
              if (cells.length === 2) {
                const key = (cells[0].innerText || '').trim();
                // For Modified Stats, replace <br> visual breaks with " / "
                const valNode = cells[1];
                let val = (valNode.innerText || '').trim();
                if (key) meta[key] = val;
              }
            }
          }
          // Scaled values table: header row has "Item type" then Tier1..TierN.
          let scaled = null;
          if (tables[1]) {
            const headerCells = Array.from(
              tables[1].querySelectorAll('thead th'),
            ).map((c) => (c.innerText || '').trim());
            const rows = [];
            for (const tr of tables[1].querySelectorAll('tbody tr')) {
              const tds = Array.from(tr.querySelectorAll('td')).map((c) =>
                (c.innerText || '').trim(),
              );
              if (tds.length >= 2) {
                rows.push({
                  slot: tds[0],
                  tiers: tds.slice(1),
                });
              }
            }
            scaled = { headers: headerCells, rows };
          }
          return { meta, scaled };
        });
        results.push({ url, ok: true, data });
      } catch (err) {
        results.push({
          url,
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      }
    }
    return results;
  }`;
}

// ---------------------------------------------------------------------------
// URL list management
// ---------------------------------------------------------------------------

async function loadAffixUrls() {
  const xml = await readFile(SITEMAP_PATH, 'utf8');
  const urls = [];
  const re = /<loc>(https:\/\/lastepoch\.tunklab\.com\/affix\/[^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1]);
  return urls;
}

function slugFromUrl(url) {
  return url.replace(/^.*\/affix\//, '');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function filterUncached(urls) {
  const uncached = [];
  for (const url of urls) {
    const cachePath = path.join(CACHE_DIR, slugFromUrl(url) + '.json');
    if (!(await fileExists(cachePath))) uncached.push(url);
  }
  return uncached;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { limit: null, slugs: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--limit=')) args.limit = parseInt(a.slice('--limit='.length), 10);
    else if (a.startsWith('--slugs=')) args.slugs = a.slice('--slugs='.length).split(',');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(CACHE_DIR, { recursive: true });

  let urls = await loadAffixUrls();
  console.log(`sitemap: ${urls.length} affix URLs`);

  if (args.slugs) {
    const set = new Set(args.slugs);
    urls = urls.filter((u) => set.has(slugFromUrl(u)));
    console.log(`filtered to ${urls.length} URLs by --slugs`);
  }

  urls = await filterUncached(urls);
  console.log(`uncached: ${urls.length} URLs`);

  if (args.limit !== null) {
    urls = urls.slice(0, args.limit);
    console.log(`limited to first ${urls.length} URLs by --limit`);
  }

  if (urls.length === 0) {
    console.log('nothing to scrape (all cached). exiting.');
    return;
  }

  // Open persistent browser session.
  console.log(`\nopening browser session "${SESSION}"…`);
  await pwcli(['-s', SESSION, 'open', '--browser=chrome']);

  let totalOk = 0;
  let totalErr = 0;
  const t0 = Date.now();

  try {
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);
      const batchN = Math.floor(i / BATCH_SIZE) + 1;
      const batchTotal = Math.ceil(urls.length / BATCH_SIZE);
      const batchT0 = Date.now();
      console.log(
        `\nbatch ${batchN}/${batchTotal} — ${batch.length} URLs (${i + 1}..${i + batch.length} of ${urls.length})`,
      );

      const script = buildBatchScript(batch);
      const { stdout } = await pwcli(['-s', SESSION, 'run-code', script]);
      const results = parseResult(stdout);

      if (!Array.isArray(results)) {
        throw new Error(
          `expected array result from batch, got ${typeof results}: ${JSON.stringify(results).slice(0, 200)}`,
        );
      }

      let batchOk = 0;
      let batchErr = 0;
      for (const r of results) {
        const slug = slugFromUrl(r.url);
        const cachePath = path.join(CACHE_DIR, slug + '.json');
        await writeFile(cachePath, JSON.stringify(r, null, 2) + '\n');
        if (r.ok) batchOk++;
        else batchErr++;
      }
      totalOk += batchOk;
      totalErr += batchErr;
      const batchDt = ((Date.now() - batchT0) / 1000).toFixed(1);
      console.log(`  ✓ ${batchOk} ok, ✗ ${batchErr} err, ${batchDt}s`);
    }
  } finally {
    console.log(`\nclosing browser session…`);
    await pwcli(['-s', SESSION, 'close']).catch((err) => {
      console.error('warning: close failed:', err.message);
    });
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\ndone — ${totalOk} ok, ${totalErr} err, ${dt}s, cache: ${CACHE_DIR}`);
}

main().catch((err) => {
  console.error(`error: ${err && err.message ? err.message : String(err)}`);
  process.exitCode = 1;
});
