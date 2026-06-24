#!/usr/bin/env node
/* Re-verify every paper currently tagged as a frontier lab or company.

   The bulk topic collector (collect-topics.mjs) tagged a paper with a lab if
   ANY author's OpenAlex affiliation matched a lab pattern — and the old pattern
   set included the bare word "fair". That produced a lot of garbage: medical
   and chemistry papers tagged Meta/Microsoft/DeepSeek because one co-author (or
   a false "fair"/substring match) tripped the regex.

   This pass re-derives the institution from the **first author** (where the
   paper is actually from), using OpenAlex — which is authoritative for the
   published, DOI-bearing papers that make up almost all of this set — never the
   abstract. Papers we cannot positively place at a lab/company are demoted to
   `org: other` (the UI then shows their authors).

   Trustworthy sources are skipped: lab-site scrapers (website) and papers
   already verified from their PDF first page (scripts/attribute.mjs).

   Usage: node scripts/reattribute-labs.mjs [--dry] [--limit N]
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAffiliation, canonicalInstName, serializeDb } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'data', 'papers.json');
const MAILTO = 'michaelofengend@gmail.com';
const LAB_KEYS = new Set(['anthropic', 'openai', 'deepmind', 'meta', 'microsoft', 'deepseek', 'qwen', 'mistral', 'xai', 'ai2']);
const WEBSITE_SRC = /anthropic-site|openai-site|deepmind-site|transformer-circuits|alignment-blog|openai-alignment|manual/;
const OA_TYPE_KIND = { education: 'academia', healthcare: 'academia', company: 'company', facility: 'academia', government: 'other', nonprofit: 'other', archive: 'other', other: 'other' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normDoi = (s) => String(s || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/\s+/g, '');
const doiOf = (p) => { const m = String(p.url || '').match(/10\.\d{4,}\/[^\s?#"]+/); return m ? normDoi(m[0]) : null; };

async function fetchJSON(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await sleep(800);
  }
  return null;
}

/* {inst,instKind,org} from a work's FIRST author, or null.
   Trusts OpenAlex's *disambiguated* first-author institution (clean display_name
   + type). The lab-name matcher only ever runs over that clean name — never the
   raw affiliation strings, which carry noise that produced false lab hits (a MOF
   chemistry paper matching "Alibaba", etc.). */
function instFromWork(work) {
  const auths = work.authorships || [];
  const first = auths.find((a) => a.author_position === 'first') || auths[0];
  if (!first) return null;
  const insts = first.institutions || [];
  if (insts[0] && insts[0].display_name) {
    const canon = canonicalInstName(insts[0].display_name); // strips " (Country)", maps big-tech
    if (!canon) return null; // uninformative name -> demote to authors
    if (canon.instKind) return canon; // mapped to a known lab / big-tech entity
    return { inst: canon.inst, instKind: OA_TYPE_KIND[insts[0].type] || 'other', org: 'other' };
  }
  // no disambiguated institution: last-resort guess from the raw affiliation text
  const raw = (first.raw_affiliation_strings || []).join(' ; ');
  const known = classifyAffiliation(raw, '');
  return known && known.org !== 'other' ? known : null;
}

function applyResult(p, res) {
  if (res) { p.inst = res.inst; p.instKind = res.instKind; p.org = res.org || 'other'; delete p.instMiss; return true; }
  // could not place at a lab/company -> demote so the UI falls back to authors
  p.org = 'other'; delete p.inst; delete p.instKind; p.instMiss = 1; return false;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? parseInt(args[li + 1], 10) : Infinity;

  const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  let cands = db.papers.filter((p) => {
    if (!(LAB_KEYS.has(p.org) || p.instKind === 'company')) return false;
    if (p.inst && !p.instMiss) return false; // already PDF-verified
    const src = (p.sources || [p.source] || []).join(',');
    if (WEBSITE_SRC.test(src)) return false; // website/manual = trustworthy
    return true;
  });
  cands = cands.slice(0, limit === Infinity ? cands.length : limit);
  console.log(`re-verify ${cands.length} lab/company papers from first-author affiliation${dry ? ' [DRY]' : ''}`);

  // index candidates by DOI for batched lookup; keep the rest for title search
  const byDoi = new Map();
  const noDoi = [];
  for (const p of cands) { const d = doiOf(p); if (d) byDoi.set(d, p); else noDoi.push(p); }

  const tally = { relabeled: 0, demoted: 0, lab: 0, academia: 0, company: 0, other: 0 };
  const recordRes = (p, res) => {
    if (applyResult(p, res)) { tally.relabeled++; tally[res.instKind] = (tally[res.instKind] || 0) + 1; }
    else tally.demoted++;
  };

  // 1) DOI batches (50 per request)
  const dois = [...byDoi.keys()];
  for (let i = 0; i < dois.length; i += 50) {
    const batch = dois.slice(i, i + 50);
    const url = `https://api.openalex.org/works?filter=doi:${batch.map(encodeURIComponent).join('|')}` +
      `&select=doi,authorships&per-page=50&mailto=${MAILTO}`;
    const data = await fetchJSON(url);
    const found = new Set();
    for (const w of (data?.results || [])) {
      const d = normDoi(w.doi);
      const p = byDoi.get(d);
      if (!p) continue;
      found.add(d);
      recordRes(p, instFromWork(w));
    }
    // DOIs OpenAlex didn't return -> unverifiable -> demote
    for (const d of batch) if (!found.has(d)) recordRes(byDoi.get(d), null);
    process.stdout.write(`\r  DOI ${Math.min(i + 50, dois.length)}/${dois.length} · relabeled ${tally.relabeled} demoted ${tally.demoted}`);
    await sleep(150);
  }
  process.stdout.write('\n');

  // 2) title search for the DOI-less remainder
  for (let i = 0; i < noDoi.length; i++) {
    const p = noDoi[i];
    const url = `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(p.title.slice(0, 90))}` +
      `&select=doi,title,authorships&per-page=1&mailto=${MAILTO}`;
    const data = await fetchJSON(url);
    const w = (data?.results || [])[0];
    // require a close title match before trusting it
    const ok = w && w.title && w.title.toLowerCase().slice(0, 40) === p.title.toLowerCase().slice(0, 40);
    recordRes(p, ok ? instFromWork(w) : null);
    if (i % 20 === 0) process.stdout.write(`\r  title ${i + 1}/${noDoi.length} · relabeled ${tally.relabeled} demoted ${tally.demoted}`);
    await sleep(120);
  }
  process.stdout.write('\n');

  if (!dry) { writeFileSync(DB_PATH, serializeDb(db)); console.log(`wrote ${DB_PATH}`); }
  console.log('result:', JSON.stringify(tally));
}

main().catch((e) => { console.error(e); process.exit(1); });
