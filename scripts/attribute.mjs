#!/usr/bin/env node
/* Institution attribution from the PDF first page.

   "Where is this paper actually from?" — answered the reliable way: download the
   arXiv PDF, read its first page with pdftotext, isolate the affiliation block
   (everything before the abstract), and run lib.mjs's classifyAffiliation over
   it (author email domains first, then curated/known institution names). The
   result canonically tags each paper with `inst` (institution display name),
   `instKind` (lab | startup | academia | company | other) and a corrected
   colour `org` key. When the first page yields no affiliation, nothing is set
   and the UI falls back to listing the first authors.

   This deliberately NEVER looks at the abstract: abstracts name other labs'
   models ("DeepSeek-R1", "Llama") and contain common words ("fair comparison"),
   which is exactly what mislabeled the corpus before.

   Usage:
     node scripts/attribute.mjs --limit 1500            # backfill, write papers.json
     node scripts/attribute.mjs --only labeled --dry    # process current labels, no write
     node scripts/attribute.mjs --rederive --limit 500  # re-classify from cached text
*/
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { classifyAffiliation, serializeDb } from './lib.mjs';

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'data', 'papers.json');
const CACHE = join(ROOT, 'data', 'affil-cache'); // first-page text cache (gitignored)
const MAILTO = 'michaelofengend@gmail.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeName = (id) => id.replace(/[^\w.-]/g, '_');

/* Slice the affiliation header: everything before the abstract / section 1.
   Author names, affiliations and emails all live in this top region. */
export function affiliationRegion(firstPage) {
  const t = String(firstPage || '').replace(/\r/g, '');
  const cut = t.search(/\n\s*(?:abstract|a\s?b\s?s\s?t\s?r\s?a\s?c\s?t|1[\s.)]+introduction)\b/i);
  return cut > 120 ? t.slice(0, cut) : t.slice(0, 1800);
}

/* First-page plain text for an arXiv id, cached (successes only). null on failure. */
async function pdfFirstPageText(arxivId, { rederive = false } = {}) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const cacheFile = join(CACHE, safeName(arxivId) + '.txt');
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  if (rederive) return null; // re-derive mode reads cache only, never downloads
  const pdfTmp = join(CACHE, '_' + safeName(arxivId) + '.pdf');
  try {
    await execFileP('curl', ['-sL', '-A', `frontier-tracker (${MAILTO})`, '--max-time', '30',
      '-o', pdfTmp, `https://arxiv.org/pdf/${arxivId}`]);
    const { stdout } = await execFileP('pdftotext', ['-f', '1', '-l', '1', '-q', pdfTmp, '-'],
      { maxBuffer: 16 * 1024 * 1024 });
    if (stdout && stdout.trim().length > 40) { writeFileSync(cacheFile, stdout); return stdout; }
    return null;
  } catch (e) {
    return null;
  } finally {
    try { if (existsSync(pdfTmp)) unlinkSync(pdfTmp); } catch { /* ignore */ }
  }
}

/* Classify one paper from its first-page text. Returns {inst,instKind,org}|null. */
export function attributeFromFirstPage(firstPage) {
  if (!firstPage) return null;
  // names matched from the header region; emails scanned across the whole page
  // (affiliations are sometimes footnoted below the abstract).
  return classifyAffiliation(affiliationRegion(firstPage), firstPage);
}

/* Apply an attribution result to a record in place. The PDF first page is
   authoritative for arXiv papers, so it overwrites the (possibly abstract-
   derived, possibly wrong) existing org. */
const ABSTRACT_SOURCES = /arxiv-firehose|arxiv-sweep/;
function apply(p, res) {
  if (!res) {
    p.instMiss = 1;
    // A still-labeled paper whose org came from the abstract (the old firehose/
    // sweep behaviour) is unverifiable here and was the source of wrong tags —
    // demote it to 'other' rather than keep a guess.
    if (p.org && p.org !== 'other' && ABSTRACT_SOURCES.test((p.sources || []).join(','))) p.org = 'other';
    return false;
  }
  p.inst = res.inst;
  p.instKind = res.instKind;
  p.org = res.org || 'other';
  delete p.instMiss;
  return true;
}

function parseArgs(argv) {
  const a = { limit: Infinity, only: null, dry: false, rederive: false, conc: 5 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--limit') a.limit = parseInt(argv[++i], 10) || Infinity;
    else if (v === '--only') a.only = argv[++i];
    else if (v === '--conc') a.conc = Math.max(1, parseInt(argv[++i], 10) || 5);
    else if (v === '--dry') a.dry = true;
    else if (v === '--rederive') a.rederive = true;
  }
  return a;
}

/* Candidates needing attribution, highest-value first:
   already-labeled (fix wrong tags) > higher importance > newer. */
function candidates(papers, { only, rederive }) {
  let c = papers.filter((p) => p.arxiv_id && (rederive || (!p.inst && !p.instMiss)));
  if (only === 'labeled') c = c.filter((p) => p.org && p.org !== 'other');
  if (only === 'recent') c = c.filter((p) => p.date >= '2026-01-01');
  c.sort((a, b) =>
    ((a.org === 'other') - (b.org === 'other')) ||
    ((b.importance || 0) - (a.importance || 0)) ||
    (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return c;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  const cands = candidates(db.papers, args);
  const work = cands.slice(0, args.limit === Infinity ? cands.length : args.limit);
  console.log(`attribute: ${work.length} candidates (of ${cands.length} needing attribution)` +
    `${args.dry ? ' [DRY RUN — no write]' : ''}${args.rederive ? ' [RE-DERIVE from cache]' : ''}`);

  const tally = { lab: 0, startup: 0, academia: 0, company: 0, other: 0, miss: 0 };
  let done = 0, hits = 0;
  for (let i = 0; i < work.length; i += args.conc) {
    const chunk = work.slice(i, i + args.conc);
    await Promise.all(chunk.map(async (p) => {
      const text = await pdfFirstPageText(p.arxiv_id, { rederive: args.rederive });
      const res = attributeFromFirstPage(text);
      if (apply(p, res)) { hits++; tally[res.instKind] = (tally[res.instKind] || 0) + 1; }
      else tally.miss++;
      done++;
    }));
    if (done % 50 < args.conc) process.stdout.write(`\r  ${done}/${work.length} processed, ${hits} attributed`);
    if (!args.dry && done % 1000 < args.conc) writeFileSync(DB_PATH, serializeDb(db)); // checkpoint
    if (!args.rederive) await sleep(250); // be polite to arxiv.org
  }
  process.stdout.write('\n');
  if (!args.dry) { writeFileSync(DB_PATH, serializeDb(db)); console.log(`wrote ${DB_PATH}`); }
  console.log('result kinds:', JSON.stringify(tally));
}

// Only run the backfill when invoked as a CLI — importing for the exported
// helpers (tests, build steps) must NOT trigger a full run.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
