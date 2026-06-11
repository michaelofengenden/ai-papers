/* Fetch quarterly counts of all ML/AI papers from OpenAlex — the denominator
   for share-of-field interest curves. Writes data/field-baseline.json.
   Usage: node scripts/fetch-baseline.mjs */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAILTO = 'michaelofengend@gmail.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function count(from, to) {
  const url = `https://api.openalex.org/works?filter=concepts.id:C119857082,from_publication_date:${from},to_publication_date:${to},type:types/article|types/preprint&per-page=1&mailto=${MAILTO}`;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': `ai-papers-tracker (${MAILTO})` } });
      if (res.ok) return (await res.json()).meta.count;
      await sleep(2000 * (i + 1));
    } catch (e) { await sleep(2000); }
  }
  return null;
}

const now = new Date();
const nowYear = now.getUTCFullYear();
const nowQ = Math.floor(now.getUTCMonth() / 3);
const quarters = [];
for (let y = 2012; y <= nowYear; y++) {
  for (let q = 0; q < 4; q++) {
    if (y === nowYear && q > nowQ) break;
    const from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    const toM = q * 3 + 3;
    const to = toM > 11 ? `${y}-12-31` : `${y}-${String(toM + 1).padStart(2, '0')}-01`;
    quarters.push({ y, q, from, to });
  }
}

for (const qq of quarters) {
  qq.n = await count(qq.from, qq.to);
  process.stdout.write(`${qq.y}Q${qq.q + 1}=${qq.n} `);
  await sleep(250);
}
console.log();
writeFileSync(join(ROOT, 'data', 'field-baseline.json'),
  JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), concept: 'Machine learning (C119857082)', quarters: quarters.map(({ y, q, n }) => ({ y, q, n })) }));
console.log('data/field-baseline.json written');
