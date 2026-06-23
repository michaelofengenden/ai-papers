/* One-time / idempotent cleanup: collapse duplicate-id rows in data/papers.json.
   Root cause was a hand-resolved cherry-pick of the bot daily-refresh (commit
   70288e6 "absorb bot refresh post-cherry-pick") that duplicated ~1,429
   finalized rows wholesale in the line-per-paper master. The ingest scripts
   (update.mjs/collect-topics.mjs) dedupe on title/url/arxiv and assign fresh
   ids, so they never create same-id clones — this only repairs the VCS artifact.

   Strategy: keep the first row for each id (preserves the date-sorted order and
   yields a deletions-only diff). All known dupes are byte-identical, so first
   == richest; if a later same-id row is NOT byte-identical, fall back to
   mergeRecords() to keep the richest fields and report it.

   Usage: node scripts/dedupe-ids.mjs [--dry] */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRecords, serializeDb } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'papers.json');
const DRY = process.argv.includes('--dry');

const db = JSON.parse(readFileSync(DATA, 'utf8'));
const before = db.papers.length;

const byId = new Map();      // id -> index in `out`
const out = [];
let identicalDropped = 0, mergedNonIdentical = 0;

for (const p of db.papers) {
  if (!byId.has(p.id)) {
    byId.set(p.id, out.length);
    out.push(p);
    continue;
  }
  const i = byId.get(p.id);
  if (JSON.stringify(out[i]) === JSON.stringify(p)) {
    identicalDropped++;                       // exact clone — just drop it
  } else {
    out[i] = mergeRecords(out[i], p);         // keep the richer record
    out[i].id = p.id;                         // mergeRecords preserves id, belt-and-suspenders
    mergedNonIdentical++;
    console.warn(`non-identical dup for id=${p.id}: "${String(p.title).slice(0, 70)}" — merged`);
  }
}

const removed = before - out.length;
const uniq = new Set(out.map((p) => p.id)).size;
console.log(`rows ${before} -> ${out.length} (removed ${removed}; identical ${identicalDropped}, merged ${mergedNonIdentical})`);
console.log(`unique ids now: ${uniq} (residual dup ids: ${out.length - uniq})`);

if (DRY) { console.log('--dry: no write'); process.exit(0); }
if (removed === 0) { console.log('nothing to do'); process.exit(0); }

copyFileSync(DATA, DATA + '.predupe.bak');    // local safety net alongside the /tmp backup
db.papers = out;                               // serializeDb recomputes count from length; updated preserved
writeFileSync(DATA, serializeDb(db));
console.log(`wrote ${DATA} (backup at ${DATA}.predupe.bak)`);
