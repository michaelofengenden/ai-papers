/* Bulk topic collection: pull topic-relevant papers (all orgs, 2012+) from
   OpenAlex for every theme query, dedupe against data/papers.json, and append
   with rule-based topics/summaries + importance. Deterministic, no LLM.
   Usage: node scripts/collect-topics.mjs [--cap 3000] */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTitle, extractArxivId, tagTopics, autoSummary, isSpam, classifyKind, computeImportance, serializeDb, orgFromText } from './lib.mjs';
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

/* Frontier-lab attribution shares lib.mjs's orgFromText so every collection
   path (update.mjs arXiv sweep/firehose + this bulk topic pull) recognises the
   same labs with the same false-positive-safe patterns. */
function orgOf(w) {
  const affs = (w.authorships || []).flatMap((a) => (a.raw_affiliation_strings || []).concat((a.institutions || []).map((x) => x.display_name || '')));
  return orgFromText(affs.join(' | '));
}

/* AI/ML relevance signal for the bulk gate (step 4). Generic phrase queries
   ("calibration", "negation", "world models") pull in preprint-mill /
   general-science noise that has nothing to do with AI; we require a positive
   AI/ML signal in the title/abstract to keep such a record. */
const AI_SIGNAL_RE = /\b(language model|\bllms?\b|\bnlp\b|neural network|neural net|deep learning|machine learning|reinforcement learning|transformer|attention mechanism|fine.?tun|pretrain|pre.?train|embedding|generative (model|ai)|diffusion model|foundation model|large language|gpt|bert|few.?shot|zero.?shot|in.context learning|gradient descent|backpropagation|self.supervised|representation learning|prompt(ing)?|chatbot|artificial intelligence|computer vision|image (classification|generation|recognition)|object detection|semantic segmentation|speech recognition|text (generation|classification)|question answering|knowledge graph|graph neural)\b/i;

/* AI-related OpenAlex concept names (level 0/1) we treat as a positive signal.
   Matched case-insensitively against each concept's display_name substring. */
const AI_CONCEPT_RE = /artificial intelligence|machine learning|deep learning|natural language processing|computer vision|reinforcement learning|artificial neural network|pattern recognition|speech recognition|language model/i;

/* Preprint-mill / general-science / bio-medical venues that flood generic
   queries. A record from one of these is dropped unless it carries an explicit
   AI signal (handled in the gate below). */
const NOISE_VENUE_RE = /\bssrn\b|research square|researchsquare|preprints?\.org|biorxiv|medrxiv|chemrxiv|\bscientific reports\b|\bieee access\b|\bplos one\b|\bheliyon\b|\bcureus\b|\bf1000\b/i;

async function collectQuery(q, seenIds) {
  const out = [];
  let cursor = '*';
  while (out.length < CAP && cursor) {
    const url = `https://api.openalex.org/works?filter=title_and_abstract.search:${encodeURIComponent(q)},from_publication_date:${FROM},type:types/article|types/preprint&per-page=200&cursor=${encodeURIComponent(cursor)}&select=id,title,authorships,publication_date,primary_location,locations,cited_by_count,type,abstract_inverted_index,concepts&mailto=${MAILTO}`;
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
        // carried only for the relevance gate (step 4): top concept names and
        // whether this record has an arXiv landing/pdf (treated as cs-trusted).
        concepts: (w.concepts || []).map((c) => c.display_name).filter(Boolean),
        is_arxiv: !!arxiv_id,
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
let added = 0, dup = 0, spam = 0, irrelevant = 0, badDate = 0, noise = 0;
for (const p of collected) {
  if (!p.title || !p.date || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || p.date > today) { badDate++; continue; }
  if (isSpam(p)) { spam++; continue; }
  const keys = ['ttl:' + normTitle(p.title)];
  if (p.arxiv_id) keys.push('axv:' + p.arxiv_id);
  if (keys.some((k) => seen.has(k))) { dup++; continue; }
  const hay = `${p.title} ${p.abstract || ''} ${p.venue || ''}`.toLowerCase();
  const [lo, hi] = themeMask(hay);
  const topics = tagTopics(`${p.title} ${p.abstract || ''} ${p.venue || ''}`);
  // relevance gate (broad): must hit a theme or land a non-Other topic.
  if (!lo && !hi && topics.length === 1 && topics[0] === 'Other') { irrelevant++; continue; }
  /* AI/ML signal gate (step 4): generic phrase queries ("calibration",
     "negation", "world models") drag in preprint-mill / general-science /
     bio-medical records that pass the broad topic gate by coincidence. The
     rule, kept deliberately conservative so legitimate arXiv cs papers are
     never dropped:
       - arXiv-hosted records that are NOT from a known noise venue are trusted
         as cs and kept without an AI test;
       - every other record (no arXiv id, OR hosted at a preprint-mill /
         general-science venue: SSRN, Research Square, Preprints.org,
         bioRxiv/medRxiv, Scientific Reports, IEEE Access, PLOS ONE, ...) must
         show a positive AI signal to survive — either an AI-related OpenAlex
         concept (AI_CONCEPT_RE) OR an AI/ML keyword in its title/abstract
         (AI_SIGNAL_RE). A bio paper that merely matched a phrase query and
         lives on bioRxiv thus gets dropped, while a genuine AI paper on the
         same venue (its own concepts/title carry the signal) survives.
     Net effect: records with no AI concept and no AI keyword are dropped
     whenever they aren't a plain arXiv cs preprint; clearly-AI work is
     unaffected. */
  const noisyVenue = NOISE_VENUE_RE.test(p.venue || '');
  if (!p.is_arxiv || noisyVenue) {
    const concepts = Array.isArray(p.concepts) ? p.concepts.join(' ') : '';
    const aiSignal = AI_CONCEPT_RE.test(concepts) || AI_SIGNAL_RE.test(hay);
    if (!aiSignal) { noise++; continue; }
  }
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
console.log(`append: +${added} (dup ${dup}, spam ${spam}, irrelevant ${irrelevant}, noise ${noise}, badDate ${badDate}) -> total ${db.count}`);
