#!/usr/bin/env node
// scripts/update-data.mjs
//
// Downloads upstream PoB-LE data files into data/raw/ and writes a
// snapshot manifest (data/raw/_meta.json) with SHA-256 hashes and the
// upstream commit hash. See PLAN.md §7.3 and §8 P0.1.
//
// ESM only. Node 18+. No external dependencies.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(REPO_ROOT, 'data', 'raw');

const SOURCE_BASE =
  'https://raw.githubusercontent.com/Musholic/PathOfBuildingForLastEpoch/master/src/Data';

const COMMITS_API =
  'https://api.github.com/repos/Musholic/PathOfBuildingForLastEpoch/commits/master';

/**
 * List of files to download. `url` is fetched; bytes are written verbatim to
 * `<RAW_DIR>/<outName>` and accounted for under `outName` in _meta.json.
 */
const FILES = [
  {
    outName: 'ModItem.json',
    url: `${SOURCE_BASE}/ModItem.json`,
  },
  {
    outName: 'bases-full.json',
    url: `${SOURCE_BASE}/Bases/bases.json`,
  },
  {
    outName: 'affixes-id-map.json',
    url: `${SOURCE_BASE}/LEToolsImport/affixes.json`,
  },
];

/**
 * Fetch a URL and return the raw bytes as a Buffer. Throws on non-2xx
 * responses or network failures.
 *
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Compute the hex-encoded SHA-256 of a buffer.
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Best-effort lookup of the latest commit hash on master for the PoB-LE repo.
 * Returns 'unknown' on any failure (the anonymous GitHub API is rate-limited
 * and this metadata is advisory).
 *
 * @returns {Promise<string>}
 */
async function fetchCommitHash() {
  try {
    const response = await fetch(COMMITS_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'eternity-update-data-script',
      },
    });
    if (!response.ok) {
      console.warn(
        `warn: commit hash lookup failed (${response.status} ${response.statusText}); using "unknown"`,
      );
      return 'unknown';
    }
    const payload = await response.json();
    if (payload && typeof payload.sha === 'string' && payload.sha.length > 0) {
      return payload.sha;
    }
    console.warn('warn: commit hash lookup returned no sha; using "unknown"');
    return 'unknown';
  } catch (error) {
    console.warn(
      `warn: commit hash lookup threw (${error instanceof Error ? error.message : String(error)}); using "unknown"`,
    );
    return 'unknown';
  }
}

/**
 * Format a SHA-256 hex string for terminal display.
 *
 * @param {string} hex
 * @returns {string}
 */
function shortSha(hex) {
  return `${hex.slice(0, 12)}\u2026`;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  // Download all files in parallel (they're independent).
  const downloads = await Promise.all(
    FILES.map(async ({ outName, url }) => {
      const buffer = await fetchBuffer(url);
      const outPath = path.join(RAW_DIR, outName);
      await writeFile(outPath, buffer);
      const hash = sha256Hex(buffer);
      console.log(
        `\u2713 ${outName} \u2014 ${buffer.length} bytes \u2014 sha256:${shortSha(hash)}`,
      );
      return { outName, size: buffer.length, sha256: hash };
    }),
  );

  const commitHash = await fetchCommitHash();

  // Sort alphabetically for deterministic output.
  const sorted = [...downloads].sort((a, b) => a.outName.localeCompare(b.outName));
  const files = sorted.reduce((acc, { outName, sha256, size }) => {
    acc[outName] = { sha256, size };
    return acc;
  }, {});

  const meta = {
    fetchedAt: new Date().toISOString(),
    source: SOURCE_BASE,
    commitHash,
    files,
  };

  const metaPath = path.join(RAW_DIR, '_meta.json');
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(
    `\nWrote ${metaPath} (commitHash: ${commitHash === 'unknown' ? 'unknown' : shortSha(commitHash)})`,
  );
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
