/* Build the browser payload: data/papers.json -> docs/data/papers.json
   - backfills importance (0-100) on every record
   - precomputes theme bitmasks server-side (th: [lo, hi]) so the client
     never runs 36 regexes x 30k papers
   - slims the transfer: abstracts only for frontier-lab papers (truncated),
     bulk-corpus summaries capped
   - writes docs/data/themes.json (theme names, for chips/board labels)
   Usage: node scripts/build-site-data.mjs */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeImportance, ORG_TO_INST } from './lib.mjs';
import { THEMES, themeMask } from './themes.mjs';
import { TOPICS } from './lib.mjs';

// Effective institution for a record: the PDF-derived `inst`, else (for lab blog
// posts / non-arXiv lab records) the canonical name for its frontier-lab org.
const effInst = (p) => p.inst || ORG_TO_INST[p.org] || null;
const effKind = (p) => p.instKind || (ORG_TO_INST[p.org] ? 'lab' : 'other');
import { computeEmerging, computeNovelty } from './emerging.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = JSON.parse(readFileSync(join(ROOT, 'data', 'papers.json'), 'utf8'));

let timelineIds = new Set();
const tlPath = join(ROOT, 'data', 'timeline.json');
if (existsSync(tlPath)) {
  try { timelineIds = new Set(JSON.parse(readFileSync(tlPath, 'utf8')).entries.map((e) => e.id)); } catch (e) { /* ignore */ }
}

const LAB = new Set(['anthropic', 'openai', 'deepmind']);
const SURVEY = /\b(survey|systematic review|literature review|comprehensive review|a review of|primer|tutorial|taxonomy|an overview of|introduction to)\b/i;
// novelty radar: per-paper count of recently-coined title terms (recent papers only)
const noveltyById = computeNovelty(db.papers).byId;

// Institution taxonomy: intern the per-paper `inst` strings into one table so the
// feed ships a small integer index (rec.in) instead of repeating names, and the
// client gets the grouped filter list (name + kind + colour + count) for free.
const KIND_ORDER = { lab: 0, startup: 1, company: 2, academia: 3, other: 4 };
const instAgg = new Map();
for (const p of db.papers) {
  const name = effInst(p);
  if (!name) continue;
  const kind = effKind(p);
  const e = instAgg.get(name) || { name, kind, org: 'other', n: 0 };
  e.n++;
  if (kind && (KIND_ORDER[kind] ?? 9) < (KIND_ORDER[e.kind] ?? 9)) e.kind = kind;
  if (p.org && p.org !== 'other') e.org = p.org; // frontier-lab colour key
  instAgg.set(name, e);
}
const instList = [...instAgg.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
const instIndex = new Map(instList.map((e, i) => [e.name, i]));

const slim = db.papers.map((p) => {
  const hay = `${p.title} ${(p.authors || []).join(' ')} ${p.summary || ''} ${p.abstract || ''} ${(p.topics || []).join(' ')} ${p.venue || ''}`.toLowerCase();
  const th = themeMask(hay);
  const importance = computeImportance(p, timelineIds);
  const isLab = LAB.has(p.org) || (p.sources || []).includes('manual') || timelineIds.has(p.id);
  const abstract = isLab && p.abstract
    ? (p.abstract.length > 700 ? p.abstract.slice(0, 697).trimEnd() + '…' : p.abstract)
    : null;
  // bulk corpus ships without summaries/abstracts: it powers analytics,
  // search-by-title and discovery; lab/manual/timeline papers keep full text
  const summary = isLab ? (p.summary || null) : null;
  const rec = {
    id: p.id,
    title: p.title,
    org: p.org,
    date: p.date,
    x: (p.topics || []).map((t) => TOPICS.indexOf(t)).filter((i) => i >= 0),
    kind: p.kind === 'post' ? 'post' : 'paper',
    importance,
  };
  // Ship first authors for every paper (3 for bulk, 12 for lab/manual): they
  // render the card byline and are the badge fallback when no institution is known.
  const auth = (p.authors || []).slice(0, isLab ? 12 : 3);
  if (auth.length) rec.authors = auth;
  const iname = effInst(p);
  if (iname && instIndex.has(iname)) rec.in = instIndex.get(iname); // -> institutions.json[in]
  if (p.arxiv_id) rec.arxiv_id = p.arxiv_id; else rec.url = p.url;
  if (abstract) rec.abstract = abstract;
  if (summary) rec.summary = summary;
  if (p.venue) rec.venue = String(p.venue).slice(0, 40);
  if (p.cited_by) rec.cited_by = p.cited_by;
  if (th[0] || th[1]) rec.th = th;
  if (SURVEY.test(p.title)) rec.sv = 1;
  if (noveltyById.has(p.id)) rec.nov = noveltyById.get(p.id);
  return rec;
});

const out = join(ROOT, 'docs', 'data');
if (!existsSync(out)) mkdirSync(out, { recursive: true });
const json = JSON.stringify({ updated: db.updated, count: slim.length, papers: slim });
writeFileSync(join(out, 'papers.json'), json);
writeFileSync(join(out, 'themes.json'), JSON.stringify({ names: THEMES.map((t) => t[0]), topics: TOPICS }));
// institution taxonomy for the grouped sidebar filter + per-paper badge resolution
writeFileSync(join(out, 'institutions.json'), JSON.stringify({ updated: db.updated, list: instList }));
const instAttributed = slim.filter((r) => r.in != null).length;
console.log(`docs/data/institutions.json: ${instList.length} institutions, ${instAttributed} papers attributed`);
// bottom-up "emerging now" terms (titles-only — matches the shipped signal)
const emerging = computeEmerging(db.papers, { top: 30 });
emerging.updated = db.updated; // align with the data version for cache-busting
writeFileSync(join(out, 'emerging.json'), JSON.stringify(emerging));
console.log(`docs/data/emerging.json: ${emerging.terms.length} terms`);
if (existsSync(tlPath)) writeFileSync(join(out, 'timeline.json'), readFileSync(tlPath, 'utf8'));
const rdPath = join(ROOT, 'data', 'reading.json');
if (existsSync(rdPath)) writeFileSync(join(out, 'reading.json'), readFileSync(rdPath, 'utf8'));
const blPath = join(ROOT, 'data', 'field-baseline.json');
if (existsSync(blPath)) writeFileSync(join(out, 'field-baseline.json'), readFileSync(blPath, 'utf8'));
console.log(`docs/data/papers.json: ${slim.length} papers, ${(json.length / 1e6).toFixed(2)} MB raw`);
