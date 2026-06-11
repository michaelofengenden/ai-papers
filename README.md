# AI Papers

A static webapp (formerly "Frontier AI Research Tracker") that tracks research publications in the **interpretability / AI safety / capabilities / reasoning** space from **Anthropic, OpenAI, and Google DeepMind** — with mini summaries, topic + time filtering, and analytics.

## Data sources

- [transformer-circuits.pub](https://transformer-circuits.pub) (all papers + Circuits Updates)
- [anthropic.com/research](https://www.anthropic.com/research) and the [Alignment Science blog](https://alignment.anthropic.com)
- [openai.com research index](https://openai.com/research/)
- [deepmind.google/research/publications](https://deepmind.google/research/publications/)
- [OpenAlex](https://openalex.org) (affiliation-indexed works for all three labs — catches arXiv papers never posted on lab sites)
- arXiv API topic sweeps (mech interp, alignment, reasoning, evals, agents)
- **Bulk topic corpus** (`scripts/collect-topics.mjs`): ~35k topic-relevant papers from all orgs, 2012-present, via ~85 OpenAlex phrase queries derived from the interest themes — gives the analytics full historical bell curves instead of a lab-recent sample. Records carry an `importance` score (0-100: lab affiliation, citations, timeline membership) and the feed defaults to Featured ordering so frontier-lab work stays on top.
- **Field baseline** (`scripts/fetch-baseline.mjs`): quarterly counts of all ML papers (OpenAlex) — the denominator for share-of-field interest curves.

## How it works

- `docs/` — the webapp (vanilla JS + Chart.js, no build step). Served by GitHub Pages.
- `data/papers.json` — the merged, deduplicated dataset.
- `scripts/merge.mjs` — merges `data/raw/*.json` collector output into `data/papers.json`.
- `scripts/update.mjs` — daily refresher (runs in GitHub Actions **every day at 13:00 UTC / 06:00 PT**, see `.github/workflows/update.yml`; also triggerable manually from the Actions tab): scrapes/queries all six sources — OpenAlex (per-lab affiliation), arXiv topic sweeps, transformer-circuits.pub, the alignment blog, openai.com (sitemaps + RSS), and deepmind.google (sitemap + JSON-LD detail pages) — dedupes, spam-filters, classifies paper-vs-post, and appends new papers with rule-based topics and abstract-derived summaries.
- `data/timeline.json` — editorially curated breakthrough-papers timeline (LLM-curated, not citation-ranked), shown in the Timeline tab.
- Records carry `kind: "paper" | "post"` — company announcements are excluded from Analytics and from the default Papers view (toggle under the Type facet).

## Local development

```bash
node scripts/update.mjs          # refresh data
cd docs && python3 -m http.server 8000
```

Summaries are auto-generated; verify claims against the papers themselves.
