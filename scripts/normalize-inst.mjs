#!/usr/bin/env node
/* Idempotent cleanup of stored institution names (data/papers.json):
   - strip OpenAlex " (Country)" suffixes  ("Google (United States)" -> Google Research)
   - remap big-tech entity names to their lab  ("Meta (Israel)" -> Meta AI)
   - drop bare country-code garbage from domain fallbacks ("fzi.de" -> "De") so the
     paper falls back to its authors
   All logic lives in lib.mjs canonicalInstName, so this stays in sync with the
   live attribution path. Safe to re-run. Usage: node scripts/normalize-inst.mjs [--dry]
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalInstName, serializeDb } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'papers.json');
const dry = process.argv.includes('--dry');

const db = JSON.parse(readFileSync(DB, 'utf8'));
let remapped = 0, cleaned = 0, dropped = 0;
for (const p of db.papers) {
  if (!p.inst) continue;
  const canon = canonicalInstName(p.inst);
  if (!canon) { // uninformative -> demote to authors
    delete p.inst; delete p.instKind; p.org = 'other'; p.instMiss = 1; dropped++; continue;
  }
  if (canon.instKind) { // mapped to a known lab / big-tech entity
    if (p.inst !== canon.inst || p.instKind !== canon.instKind || p.org !== canon.org) remapped++;
    p.inst = canon.inst; p.instKind = canon.instKind; p.org = canon.org;
  } else if (canon.inst !== p.inst) { // name cleanup only (keep kind/org)
    p.inst = canon.inst; cleaned++;
  }
}
console.log(`normalize-inst: remapped ${remapped}, cleaned ${cleaned}, dropped ${dropped}${dry ? ' [DRY]' : ''}`);
if (!dry) { writeFileSync(DB, serializeDb(db)); console.log('wrote', DB); }
