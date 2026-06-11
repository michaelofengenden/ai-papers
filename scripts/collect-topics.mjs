/* Bulk topic collection: pull topic-relevant papers (all orgs, 2012+) from
   OpenAlex for every theme query, dedupe against data/papers.json, and append
   with rule-based topics/summaries + importance. Deterministic, no LLM.
   Usage: node scripts/collect-topics.mjs [--cap 3000] */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTitle, extractArxivId, tagTopics, autoSummary, isSpam, classifyKind, computeImportance, serializeDb } from './lib.mjs';
import { THEMES, UMBRELLA_QUERIES, themeMask } from './themes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'papers.json');
const MAILTO = 'michaelofengend@gmail.com';
const CAP = Number(process.argv[process.argv.indexOf('--cap') + 1]) || 3000;
const FROM = '2012-01-01';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': `ai-papers-tracker (${MAILTO})` } });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      return null;
    } catch (e) { await sleep(2500); }
  }
  return null;
}

function deinvert(idx) {
  if (!idx) return null;
  const words = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  return words.join(' ');
}

const ORG_RE = { anthropic: /\banthropic\b/i, openai: /\bopenai\b/i, deepmind: /deepmind/i };
function orgOf(w) {
  const affs = (w.authorships || []).flatMap((a) => (a.raw_affiliation_strings || []).concat((a.institutions || []).map((x) => x.display_name || '')));
  const t = affs.join(' | ');
  for (const [org, re] of Object.entries(ORG_RE)) if (re.test(t)) return org;
  return 'other';
}

async function collectQuery(q, seenIds) {
  const out = [];
  let cursor = '*';
  while (out.length < CAP && cursor) {
    const url = `https://api.openalex.org/works?filter=title_and_abstract.search:${encodeURIComponent(q)},from_publication_date:${FROM},type:types/article|types/preprint&per-page=200&cursor=${encodeURIComponent(cursor)}&select=id,title,authorships,publication_date,primary_location,locations,cited_by_count,type,abstract_inverted_index&mailto=${MAILTO}`;
    const json = await fetchJson(url);
    if (!json) break;
    for (const w of json.results || []) {
      if (!w.title || seenIds.has(w.id)) continue;
      seenIds.add(w.id);
      const loc = w.primary_location || {};
      const arxivLoc = (w.locations || []).find((l) => /arxiv/i.test(l.source?.display_name || '') || /arxiv\.org/.test(l.landing_page_url || ''));
      const arxiv_id = extractArxivId(arxivLoc?.landing_page_url) || extractArxivId(arxivLoc?.pdf_url);
      out.push({
        title: w.title,
        authors: (w.authorships || []).slice(0, 12).map((a) => a.raw_author_name || a.author?.display_name).filter(Boolean),
        org: orgOf(w),
        date: w.publication_date,
        url: arxiv_id ? `https://arxiv.org/abs/${arxiv_id}` : (loc.landing_page_url || w.id),
        pdf_url: arxiv_id ? `https://arxiv.org/pdf/${arxiv_id}` : (loc.pdf_url || null),
        arxiv_id,
        abstract: deinvert(w.abstract_inverted_index),
        source: 'openalex-topic',
        venue: loc.source?.display_name || null,
        cited_by: w.cited_by_count ?? null,
      });
    }
    cursor = json.meta?.next_cursor || null;
    await sleep(300);
  }
  return out;
}

/* ---------- main ---------- */
const db = JSON.parse(readFileSync(DATA, 'utf8'));
const seen = new Set();
for (const p of db.papers) {
  if (p.arxiv_id) seen.add('axv:' + p.arxiv_id);
  seen.add('ttl:' + normTitle(p.title));
}

const queries = [...new Set([...THEMES.flatMap((t) => t[2] || []), ...UMBRELLA_QUERIES])];
console.log(`${queries.length} queries, cap ${CAP} each, from ${FROM}`);

mkdirSync(join(ROOT, 'data', 'raw'), { recursive: true });
const NDJSON = join(ROOT, 'data', 'raw', 'openalex-topics.ndjson');
const PROGRESS = join(ROOT, 'data', 'raw', 'topics-done.json');
const done = new Set(existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : []);
const seenIds = new Set();

let qi = 0, sessionRows = 0;
for (const q of queries) {
  qi++;
  if (done.has(q)) continue;
  const rows = await collectQuery(q, seenIds);
  appendFileSync(NDJSON, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  sessionRows += rows.length;
  done.add(q);
  writeFileSync(PROGRESS, JSON.stringify([...done]));
  console.log(`[${qi}/${queries.length}] ${q} -> ${rows.length} (session ${sessionRows})`);
}

if (done.size < queries.length) {
  console.log(`PARTIAL: ${done.size}/${queries.length} queries done — rerun to resume`);
  process.exit(0);
}
console.log('ALL_QUERIES_DONE');
const collected = readFileSync(NDJSON, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(`raw rows: ${collected.length}`);

/* append: dedupe, spam filter, relevance gate, enrich-lite */
let nextId = Math.max(0, ...db.papers.map((p) => p.id)) + 1;
let added = 0, dup = 0, spam = 0, irrelevant = 0, badDate = 0;
for (const p of collected) {
  if (!p.title || !p.date || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || p.date > today) { badDate++; continue; }
  if (isSpam(p)) { spam++; continue; }
  const keys = ['ttl:' + normTitle(p.title)];
  if (p.arxiv_id) keys.push('axv:' + p.arxiv_id);
  if (keys.some((k) => seen.has(k))) { dup++; continue; }
  const hay = `${p.title} ${p.abstract || ''} ${p.venue || ''}`.toLowerCase();
  const [lo, hi] = themeMask(hay);
  const topics = tagTopics(`${p.title} ${p.abstract || ''} ${p.venue || ''}`);
  // relevance gate: must hit a theme or land a non-Other topic
  if (!lo && !hi && topics.length === 1 && topics[0] === 'Other') { irrelevant++; continue; }
  keys.forEach((k) => seen.add(k));
  const rec = {
    id: nextId++,
    title: String(p.title).replace(/\s+/g, ' ').trim(),
    authors: p.authors || [],
    org: p.org,
    date: p.date,
    url: p.url,
    pdf_url: p.pdf_url,
    arxiv_id: p.arxiv_id,
    abstract: p.abstract ? String(p.abstract).replace(/\s+/g, ' ').trim().slice(0, 400) : null,
    summary: autoSummary(p.abstract) || null,
    topics,
    venue: p.venue,
    cited_by: p.cited_by,
    sources: [p.source],
    kind: 'paper',
  };
  rec.importance = computeImportance(rec);
  db.papers.push(rec);
  added++;
}

db.papers.sort((a, b) => (a.date < b.date ? 1 : -1));
db.updated = today;
db.count = db.papers.length;
writeFileSync(DATA, serializeDb(db));
console.log(`append: +${added} (dup ${dup}, spam ${spam}, irrelevant ${irrelevant}, badDate ${badDate}) -> total ${db.count}`);
