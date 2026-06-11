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
import { computeImportance } from './lib.mjs';
import { THEMES, themeMask } from './themes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = JSON.parse(readFileSync(join(ROOT, 'data', 'papers.json'), 'utf8'));

let timelineIds = new Set();
const tlPath = join(ROOT, 'data', 'timeline.json');
if (existsSync(tlPath)) {
  try { timelineIds = new Set(JSON.parse(readFileSync(tlPath, 'utf8')).entries.map((e) => e.id)); } catch (e) { /* ignore */ }
}

const LAB = new Set(['anthropic', 'openai', 'deepmind']);
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
    authors: isLab ? (p.authors || []).slice(0, 12) : (p.authors || []).slice(0, 3),
    org: p.org,
    date: p.date,
    topics: p.topics || [],
    kind: p.kind === 'post' ? 'post' : 'paper',
    importance,
  };
  if (p.arxiv_id) rec.arxiv_id = p.arxiv_id; else rec.url = p.url;
  if (abstract) rec.abstract = abstract;
  if (summary) rec.summary = summary;
  if (p.venue) rec.venue = String(p.venue).slice(0, 48);
  if (p.cited_by) rec.cited_by = p.cited_by;
  if (th[0] || th[1]) rec.th = th;
  return rec;
});

const out = join(ROOT, 'docs', 'data');
if (!existsSync(out)) mkdirSync(out, { recursive: true });
const json = JSON.stringify({ updated: db.updated, count: slim.length, papers: slim });
writeFileSync(join(out, 'papers.json'), json);
writeFileSync(join(out, 'themes.json'), JSON.stringify({ names: THEMES.map((t) => t[0]) }));
if (existsSync(tlPath)) writeFileSync(join(out, 'timeline.json'), readFileSync(tlPath, 'utf8'));
const blPath = join(ROOT, 'data', 'field-baseline.json');
if (existsSync(blPath)) writeFileSync(join(out, 'field-baseline.json'), readFileSync(blPath, 'utf8'));
console.log(`docs/data/papers.json: ${slim.length} papers, ${(json.length / 1e6).toFixed(2)} MB raw`);
