/* Bottom-up "emerging terminology" discovery.

   The Analytics tab tracks a FIXED list of ~45 hand-curated themes. This module
   is the complement: it mines paper TITLES for uni/bi/tri-grams the curators
   have NOT named yet, buckets them by quarter, and scores each by
   NEWCOMER + ACCELERATION (share-of-corpus, z-scored) + a Kleinberg-ish burst.
   build-site-data.mjs calls computeEmerging(db.papers) and ships the top ~30 as
   docs/data/emerging.json (titles-only — the bulk corpus ships without abstracts,
   so titles are the signal every record actually carries).

   Pure + deterministic given (papers, now). No I/O. */
import { THEMES } from './themes.mjs';

const BASE_YEAR = 2016;

/* generic English + paper-boilerplate: never useful as a unigram; a phrase made
   only of these is dropped. */
const STOP = new Set(`a an the of for to in on and or with without via using use used uses
 we our us this that these those is are be been being was were can could may might will would should
 do does did has have had not no but if then than into over under from at by as it its their they them
 he she his her you your i me my which who whom whose what when where why how all any some each both more
 most other another such only own same so very just about above below between during before after again
 further once here there out up down off across per among within toward towards upon also however thus
 therefore moreover furthermore hence whereas while although though yet still even much many few less
 new novel approach method methods framework based propose proposed proposing present presents presented
 study studies paper work works result results show shows shown showing demonstrate demonstrates
 achieve achieves achieving improve improves improved improving performance state art empirical empirically
 experiment experiments experimental evaluation evaluate evaluated evaluations analysis analyze analyses
 toward towards leveraging leverage exploit exploiting enable enables enabling provide provides providing
 effective efficient efficiently efficiency robust robustness scalable scalability general generalization
 task tasks dataset datasets benchmark benchmarks data setting settings problem problems challenge challenges
 model models modeling modelling system systems network networks architecture architectures method approach
 application applications domain domains real world large small high low single multi multiple various
 different several existing recent prior previous current standard simple complex deep wide
 learning learn learned learns training train trained trains test testing tested
 ai artificial intelligence machine ml dl nlp cv
 paper towards two three one first second third best better good
 given respect compared comparison baseline baselines significantly significant
 et al e.g i.e fig figure table section appendix abstract introduction conclusion
 across through both either neither none non end full part whole set sets type types kind kinds
 form forms way ways case cases point points line lines level levels step steps time times
 number numbers value values function functions space spaces order orders rate rates
 paper'm don 'll 've 're 's n't ll ve re`
  .split(/\s+/).filter(Boolean));

/* true-but-too-broad AI phrases: they dominate every quarter and tell us nothing new. */
const GENERIC_PHRASE = new Set([
  'language model', 'language models', 'large language', 'large language model',
  'large language models', 'neural network', 'neural networks', 'deep learning',
  'machine learning', 'deep neural', 'deep neural network', 'deep neural networks',
  'artificial intelligence', 'natural language', 'natural language processing',
  'reinforcement learning', 'transformer model', 'transformer models',
  'pre trained', 'pretrained', 'pre training', 'fine tuning', 'fine tuned',
  'state art', 'state of art', 'experimental results', 'extensive experiments',
  'foundation model', 'foundation models', 'generative model', 'generative models',
  'vision language', 'computer vision', 'training data', 'downstream tasks',
  'open source', 'open weight', 'real world', 'wide range', 'high quality',
  'large scale', 'self supervised', 'supervised learning', 'transfer learning',
  'empirical study', 'case study', 'ablation study', 'human evaluation',
  'pretrained language', 'pre trained language', 'language modeling',
  'large model', 'small model', 'model size', 'model performance',
]);

const WORD = /[a-z][a-z0-9+]*(?:-[a-z0-9+]+)*/g;
function tokenize(s) {
  return (s.toLowerCase().match(WORD) || []).filter((w) => w.length > 1 && w.length < 30);
}
const edgesOk = (toks) => !STOP.has(toks[0]) && !STOP.has(toks[toks.length - 1]);

function qIndexOf(dateStr) {
  const y = +String(dateStr).slice(0, 4), m = +String(dateStr).slice(5, 7);
  if (!y || y < BASE_YEAR) return -1;
  return (y - BASE_YEAR) * 4 + Math.floor(((m || 1) - 1) / 3);
}
function qLabel(idx) {
  return `${BASE_YEAR + Math.floor(idx / 4)} Q${(idx % 4) + 1}`;
}

function addText(text, q, NQ, counts, seen) {
  const toks = tokenize(text);
  const bump = (term) => {
    let arr = counts.get(term);
    if (!arr) { arr = new Int32Array(NQ); counts.set(term, arr); }
    arr[q]++;
  };
  for (const t of toks) {
    if (STOP.has(t)) continue;
    if (!seen.has('1:' + t)) { seen.add('1:' + t); bump(t); }
  }
  for (let i = 0; i < toks.length; i++) {
    if (i + 1 < toks.length) {
      const t2 = [toks[i], toks[i + 1]], bg = t2.join(' ');
      if (edgesOk(t2) && !GENERIC_PHRASE.has(bg) && !seen.has('2:' + bg)) { seen.add('2:' + bg); bump(bg); }
    }
    if (i + 2 < toks.length) {
      const t3 = [toks[i], toks[i + 1], toks[i + 2]], tg = t3.join(' ');
      const content = t3.filter((t) => !STOP.has(t)).length;
      if (edgesOk(t3) && content >= 2 && !GENERIC_PHRASE.has(tg) && !seen.has('3:' + tg)) { seen.add('3:' + tg); bump(tg); }
    }
  }
}

const themeRes = THEMES.map((t) => t[1]);
const inCuratedTheme = (term) => themeRes.some((re) => re.test(term));

/* Returns { updated, labels:[6 quarter labels], terms:[{term, n, score, newcomer,
   sustained, inTheme, firstQ, recent, ratioShare, z, traj:[6]}] } sorted by score. */
export function computeEmerging(papers, { now = new Date(), top = 30 } = {}) {
  const y = now.getUTCFullYear(), qi = Math.floor(now.getUTCMonth() / 3);
  const nowQ = (y - BASE_YEAR) * 4 + qi, NQ = nowQ + 1;
  const qStart = Date.UTC(y, qi * 3, 1), qEnd = Date.UTC(y, qi * 3 + 3, 1);
  const qFrac = Math.min(1, Math.max(0.2, (now.getTime() - qStart) / (qEnd - qStart)));

  const counts = new Map();
  const docQ = new Int32Array(NQ);
  for (const p of papers) {
    if (p.kind === 'post') continue;
    const q = qIndexOf(p.date || '');
    if (q < 0 || q >= NQ) continue;
    docQ[q]++;
    addText(p.title || '', q, NQ, counts, new Set());
  }

  const cur = nowQ, prev = cur - 1;
  const baseQs = [prev - 4, prev - 3, prev - 2, prev - 1].filter((q) => q >= 0);
  const histEnd = prev - 6;
  const docRecent = (docQ[prev] || 0) + (docQ[cur] || 0) / qFrac;
  const docBase = baseQs.reduce((s, q) => s + (docQ[q] || 0), 0) / Math.max(1, baseQs.length);

  const rows = [];
  for (const [term, arr] of counts) {
    const tot = arr.reduce((a, b) => a + b, 0);
    if (tot < 8) continue;
    const rawCur = arr[cur], rawPrev = arr[prev] || 0;
    const recentCount = rawPrev + rawCur / qFrac;
    const recentRaw = rawPrev + rawCur;
    const isUni = term.indexOf(' ') === -1;
    if (recentRaw < (isUni ? 10 : 6)) continue;

    const last3 = [prev - 1, prev, cur].filter((q) => q >= 0);
    if (last3.filter((q) => arr[q] > 0).length < 2) continue;        // persistence gate
    const sustained = arr[cur] > 0 && arr[prev] > 0;

    const baseVals = baseQs.map((q) => arr[q]);
    const baseMean = baseVals.reduce((a, b) => a + b, 0) / Math.max(1, baseVals.length);
    const baseSd = Math.sqrt(baseVals.reduce((a, b) => a + (b - baseMean) ** 2, 0) / Math.max(1, baseVals.length));
    let histTot = 0; for (let q = 0; q <= histEnd; q++) histTot += arr[q];

    const recentShare = 1000 * recentCount / Math.max(1, docRecent);
    const baseShare = 1000 * baseMean / Math.max(1, docBase);
    const newcomer = histTot <= Math.max(2, 0.06 * tot);
    const firstQ = arr.findIndex((c) => c > 0);
    const ratioShare = baseShare > 0 ? recentShare / baseShare : (recentShare > 0 ? Infinity : 0);
    const z = baseSd > 0 ? (recentCount / 2 - baseMean) / baseSd : (recentCount > baseMean ? 6 : 0);

    let activeQs = 0, histSum = 0;
    for (let q = 0; q < prev; q++) { if (arr[q] > 0) activeQs++; histSum += arr[q]; }
    const histRate = histSum / (activeQs || 1);
    const burst = Math.log2((recentCount / 2 + 1) / (histRate + 1));

    const logGrow = baseShare > 0 ? Math.max(-2, Math.min(5, Math.log2(recentShare / baseShare)))
                                  : (recentShare > 0 ? 5 : 0);
    const volume = Math.log10(recentRaw + 1);
    let score = (logGrow * 6 + Math.max(0, Math.min(8, z)) * 1.5 + Math.max(0, burst) * 4) * (0.6 + volume);
    if (newcomer) score *= 1.6;
    if (sustained) score *= 1.25;
    if (isUni) score *= 0.82;
    if (!Number.isFinite(score)) score = 0;

    rows.push({
      term, n: term.split(' ').length, score: +score.toFixed(1), newcomer, sustained,
      inTheme: inCuratedTheme(term), firstQ: firstQ >= 0 ? qLabel(firstQ) : '-',
      recent: recentRaw, ratioShare: Number.isFinite(ratioShare) ? +ratioShare.toFixed(1) : null,
      z: +z.toFixed(1), traj: Array.from(arr.slice(Math.max(0, cur - 5), cur + 1)),
    });
  }

  rows.sort((a, b) => b.score - a.score);

  // drop near-identical overlapping n-grams (keep the higher-scored representative)
  const kept = [];
  outer: for (const r of rows) {
    for (const k of kept) {
      if (k.score >= r.score && (k.term.includes(r.term) || r.term.includes(k.term))
          && Math.abs(k.term.length - r.term.length) <= 14 && r.recent <= k.recent * 1.4) continue outer;
    }
    kept.push(r);
    if (kept.length >= top) break;
  }

  const labels = [];
  for (let q = Math.max(0, cur - 5); q <= cur; q++) labels.push(qLabel(q));
  return { updated: now.toISOString().slice(0, 10), labels, terms: kept };
}

/* distinct content bigrams+trigrams of one title (shared by novelty pass) */
function titlePhrases(title) {
  const toks = tokenize(title);
  const out = new Set();
  for (let i = 0; i < toks.length; i++) {
    if (i + 1 < toks.length) {
      const t2 = [toks[i], toks[i + 1]], bg = t2.join(' ');
      if (edgesOk(t2) && !GENERIC_PHRASE.has(bg)) out.add(bg);
    }
    if (i + 2 < toks.length) {
      const t3 = [toks[i], toks[i + 1], toks[i + 2]], tg = t3.join(' ');
      if (edgesOk(t3) && t3.filter((t) => !STOP.has(t)).length >= 2 && !GENERIC_PHRASE.has(tg)) out.add(tg);
    }
  }
  return out;
}

/* Novelty radar: how much brand-new vocabulary a recent paper's title carries.
   A phrase is "young" if it was first seen in the corpus within the last ~6
   quarters and has enough volume; nov = count of distinct young phrases in the
   title. Only scored for papers from the last `recentMonths` (novelty is a
   "just coming out" signal). Returns { youngCount, byId: Map(id -> nov) }. */
export function computeNovelty(papers, { now = new Date(), recentMonths = 15, floor = 6, minNov = 2 } = {}) {
  const y = now.getUTCFullYear(), qi = Math.floor(now.getUTCMonth() / 3);
  const nowQ = (y - BASE_YEAR) * 4 + qi, NQ = nowQ + 1;
  const total = new Map(), firstQ = new Map(), lastQ = new Map();
  for (const p of papers) {
    if (p.kind === 'post') continue;
    const q = qIndexOf(p.date || '');
    if (q < 0 || q >= NQ) continue;
    for (const ph of titlePhrases(p.title || '')) {
      total.set(ph, (total.get(ph) || 0) + 1);
      const f = firstQ.get(ph);
      if (f === undefined || q < f) firstQ.set(ph, q);
      const l = lastQ.get(ph);
      if (l === undefined || q > l) lastQ.set(ph, q);
    }
  }
  // young = coined within ~6 quarters, with volume, AND spread over >=2 distinct
  // quarters (lastQ > firstQ) — the spread gate rejects single-day junk dumps
  // (e.g. a spammer's 18 near-identical titles all in one quarter).
  const young = new Set();
  for (const [ph, t] of total) {
    if (t >= floor && firstQ.get(ph) >= nowQ - 6 && lastQ.get(ph) > firstQ.get(ph)) young.add(ph);
  }

  const cutoff = Date.UTC(y, now.getUTCMonth() - recentMonths, now.getUTCDate());
  const byId = new Map();
  for (const p of papers) {
    if (p.kind === 'post') continue;
    const ts = Date.parse(p.date || '');
    if (!ts || ts < cutoff) continue;
    let nov = 0;
    for (const ph of titlePhrases(p.title || '')) if (young.has(ph)) nov++;
    if (nov >= minNov) byId.set(p.id, nov);
  }
  return { youngCount: young.size, byId };
}

/* CLI: node scripts/emerging.mjs [--top N]  -> prints JSON over data/papers.json */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const db = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  const top = Number(process.argv[process.argv.indexOf('--top') + 1]) || 30;
  console.log(JSON.stringify(computeEmerging(db.papers, { top }), null, 2));
}
