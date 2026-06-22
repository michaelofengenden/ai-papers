/* Shared helpers for the research-paper pipeline. */

export const TOPICS = [
  'Interpretability',
  'Alignment',
  'Safety',
  'Reasoning',
  'Evaluations',
  'Robustness & Security',
  'Agents',
  'Training & Scaling',
  'Multimodal',
  'Reinforcement Learning',
  'Science Applications',
  'Policy & Society',
  'Other',
];

/* Keyword rules for fallback tagging (CI updates run without an LLM).
   Order matters: earlier rules become the primary topic. */
const RULES = [
  ['Interpretability', /\b(interpretab|mechanistic|sparse autoencoder|SAE|superposition|circuit|feature visuali[sz]|probing|activation patch|attribution graph|crosscoder|transcoder|induction head|monosemantic|polysemantic|dictionary learning|attention head|residual stream|steering vector|representation engineering|introspect)\b/i],
  ['Safety', /\b(safety|dangerous capabilit|misuse|biorisk|bioweapon|catastrophic|existential|model organism|deceptive alignment|alignment faking|sandbagging|scheming|sabotage|AI control|responsible scaling|model welfare|situational awareness|self-exfiltration|blackmail)\b/i],
  ['Alignment', /\b(alignment|RLHF|reinforcement learning from human feedback|constitutional AI|DPO|preference (learning|model|optimization)|instruction.?tun|fine.?tun|reward model|reward hack|reward tamper|weak.to.strong|scalable oversight|debate|recursive reward|value learning|honesty|sycophan|character training|post.?training)\b/i],
  ['Robustness & Security', /\b(jailbreak|adversarial|prompt injection|backdoor|poison|robustness|red.?team|attack|exploit|universal trigger|unlearning|extraction attack|watermark)\b/i],
  ['Reasoning', /\b(reasoning|chain.of.thought|chain of thought|CoT|test.time compute|inference.time|scratchpad|theorem prov|mathematical|olympiad|deliberat|thinking model|o1|process supervision|process reward)\b/i],
  ['Evaluations', /\b(benchmark|evaluation|eval(s)?\b|leaderboard|capability elicitation|METR|task suite|HELM|BIG.bench|SWE.bench|GPQA|MMLU)\b/i],
  ['Agents', /\b(agent(s|ic)?\b|tool use|computer use|web navigation|multi.agent|autonomous|assistant)\b/i],
  ['Multimodal', /\b(multimodal|vision.language|image (generation|recognition)|video|audio|speech|text.to.image|diffusion|VLM|CLIP|DALL)\b/i],
  ['Reinforcement Learning', /\b(reinforcement learning|deep RL|RL agent|Atari|AlphaGo|AlphaZero|AlphaStar|MuZero|policy gradient|Q.learning|exploration|reward shaping|StarCraft|self.play)\b/i],
  ['Training & Scaling', /\b(scaling law|pretrain|pre.train|emergen(t|ce)|transformer architecture|mixture.of.experts|MoE|efficient training|optimizer|distillation|quantization|in.context learning|grokking|memori[sz]ation|data curation|tokeni[sz]|language model(s|ing)?\b)\b/i],
  ['Science Applications', /\b(protein|AlphaFold|drug|genomic|biology|chemistry|materials|weather|climate|fusion|mathematics discovery|FunSearch|AlphaTensor|AlphaDev|healthcare|medical|clinical)\b/i],
  ['Policy & Society', /\b(policy|governance|regulation|societal|economic impact|labor|election|democra|copyright|privacy|fairness|bias|ethic)\b/i],
];

export function tagTopics(text) {
  const tags = [];
  for (const [topic, re] of RULES) {
    if (re.test(text)) tags.push(topic);
    if (tags.length >= 3) break;
  }
  return tags.length ? tags : ['Other'];
}

/* Strip HTML tags and decode entities (handles double-encoding and JATS <scp> etc.)
   plus soft hyphens — OpenAlex and mirrored blogs both leak markup into titles. */
export function cleanText(t) {
  let s = String(t || '');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  }
  return s.replace(/<[^>]+>/g, ' ').replace(/[\u00AD\u200B]/g, '').replace(/\s+/g, ' ').trim();
}

export function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Classify record as research 'paper' vs company 'post' (announcement, product
   news, feature launch). Returns null when ambiguous (needs LLM review). */
const POST_TITLE = /^(introducing|announcing|launching|expanding|bringing|previewing|update on|updates? to|our (approach|response|commitment|partnership)|partnering|a (letter|message) |now (available|rolling)|available (now|today)|new (ways|features|tools|funding|capabilities|models? available)|sam & jony|openai and|anthropic and|claude (can )?now|gpt-\S+ (is here|in|now)|strengthening|memory and new|improvements to|start using|how (we|to) use)/i;
const POST_HINT = /\b(api|pricing|enterprise|customers?|partnership|acquisition|hiring|joins?|board|policy update|terms of|brand|rebrand|store|app store|mobile app|desktop app|general availability|ga today|waitlist|rolling out|sign ?up)\b/i;
const PAPER_VENUE = /arxiv|neurips|icml|iclr|aaai|acl\b|emnlp|cvpr|nature|science\b|pnas|jmlr|tmlr|transactions|journal|proceedings|workshop|circuits thread|alignment science/i;

export function classifyKind(p) {
  if (p.arxiv_id) return 'paper';
  const src = Array.isArray(p.sources) ? p.sources.join(',') : (p.source || '');
  if (/openalex|arxiv|deepmind-site|transformer-circuits|alignment-blog|openai-alignment|alignmentforum/.test(src)) return 'paper';
  if (p.venue && PAPER_VENUE.test(p.venue)) return 'paper';
  if (POST_TITLE.test(p.title)) return 'post';
  if (POST_HINT.test(p.title)) return 'post';
  return null; // ambiguous lab-site record
}

/* OpenAlex affiliation pollution: AI-generated podcast records (Open MIND /
   myweirdprompts), Zenodo/Figshare software releases, GitHub release entries. */
const SPAM_URL = /zenodo\.org|figshare|myweirdprompts\.com|osf\.io/i;
const SPAM_VENUE = /^(open mind|zenodo|figshare)/i;
const SPAM_AUTHOR = /chatterbox|^(claude|gemini|chatgpt|gpt)[ ,-]|\((flash|pro|mini)\)|^rosehill, daniel/i;
/* Junk-title signatures. The "Title" mojibake tests stay case-SENSITIVE (literal
   [A-Z]) on purpose: a real title may begin with "Title-level", "Titled" or
   "Title:" (a 2012 RePEc paper does), and only a leading "Title" glued/spaced to
   an uppercase letter marks the prepended-"Title" garbage. The F1000 "volume N"
   audit mass-dump (all dated 2026-01-29) is matched by its phrase regardless of
   whether the bogus "Title" prefix survived ingestion. */
const SPAM_TITLE = [
  /^[\w.-]+\/[\w.-]+:/,                                      // "owner/repo: v1.2.3" release records
  /^Title(?=[A-Z])/,                                         // "TitleStrategic…" — "Title" glued to a capital
  /^Title\s+[A-Z]/,                                          // "Title Strategic…", "Title Pending 47" — "Title" + space + capital
  /strategic evaluation of advanced engineering systems/i,  // F1000 "professional audit volume N" dump
];

export function isSpam(p) {
  if (SPAM_URL.test(p.url || '') || SPAM_URL.test(p.pdf_url || '')) return true;
  if (SPAM_VENUE.test(p.venue || '')) return true;
  if (SPAM_TITLE.some((re) => re.test(p.title || ''))) return true;
  const authors = Array.isArray(p.authors) ? p.authors : [];
  if (authors.some((a) => SPAM_AUTHOR.test(String(a)))) return true;
  return false;
}

export function extractArxivId(url) {
  const m = String(url || '').match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})/i);
  return m ? m[1] : null;
}

/* Frontier-lab attribution. Each entry is an ordered [orgKey, regex] pair used
   to map an affiliation/abstract/comment haystack to a canonical org key.
   Regexes require word boundaries / multi-word context to avoid false
   positives (e.g. plain "meta", or "xai" embedded in another word). Order
   matters: the most specific / least-ambiguous patterns come first so a paper
   naming several labs is attributed to the most distinctive one. */
export const LAB_ORG_PATTERNS = [
  ['deepmind', /\b(?:google )?deepmind\b/i],
  ['anthropic', /\banthropic\b/i],
  ['deepseek', /\bdeep-?seek\b/i],
  ['mistral', /\bmistral\s*(?:ai)?\b/i],
  ['ai2', /\ballen institute for (?:artificial intelligence|ai)\b|\bai2\b|\ballenai\b/i],
  ['microsoft', /\bmicrosoft research\b|\bmsr\b/i],
  ['qwen', /\bqwen\b|\balibaba\b/i],
  // xAI is hard to disambiguate from "explainable AI (XAI)". Accept the
  // unambiguous dotted domain (x.ai), or the "xAI" token only when it sits next
  // to a corporate/lab marker (Grok, Corp, Inc, team, lab) — rejecting
  // "explainable AI (XAI) survey/methods/framework".
  ['xai', /\bx\.ai\b|\bxai\b(?=\s*(?:corp|inc|\bllc\b|team|lab|labs|grok))|(?:grok|elon musk)[^.]{0,40}\bxai\b/i],
  ['meta', /\b(?:meta ai|fair|facebook ai(?: research)?)\b/i],
  ['openai', /\bopenai\b/i],
];

/* Combined regex of all lab patterns, for a single relevance test ("does this
   text mention any tracked lab?"). Built from the alternations above so the two
   stay in sync. */
export const LAB_ORG_RE = new RegExp(
  LAB_ORG_PATTERNS.map(([, re]) => `(?:${re.source})`).join('|'), 'i');

/* Return the canonical org key for the first lab pattern that matches `text`,
   or 'other' when none do (or `text` is empty). */
export function orgFromText(text) {
  const t = String(text || '');
  for (const [org, re] of LAB_ORG_PATTERNS) if (re.test(t)) return org;
  return 'other';
}

/* First ~2 sentences of an abstract, for fallback summaries. */
export function autoSummary(abstract) {
  if (!abstract) return null;
  const clean = abstract.replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [clean];
  let out = '';
  for (const s of sentences) {
    out += s;
    if (out.length > 180) break;
  }
  out = out.trim();
  return out.length > 420 ? out.slice(0, 417).trimEnd() + '…' : out;
}

/* Priority/importance score 0-100: keeps frontier-lab work on top of the feed
   while the bulk topic corpus powers analytics and search. */
export function computeImportance(p, timelineIds = new Set()) {
  let s = 0;
  // The "big three" labs that anchor the feed keep the full boost; the newly
  // tracked competitor frontier labs get a slightly lower boost so the big-3
  // stay on top while still ranking well above the bulk topic corpus.
  if (['anthropic', 'openai', 'deepmind'].includes(p.org)) s += 45;
  else if (['meta', 'microsoft', 'deepseek', 'mistral', 'xai', 'qwen', 'ai2'].includes(p.org)) s += 35;
  const src = (p.sources || []).join(',');
  if (/transformer-circuits|alignment-blog|anthropic-site|openai-site|deepmind-site/.test(src)) s += 12;
  if (/manual/.test(src)) s += 20;
  if (timelineIds.has(p.id)) s += 20;
  s += Math.min(25, 6 * Math.log1p(p.cited_by || 0));
  const ageDays = (Date.now() - Date.parse(p.date)) / 864e5;
  if (ageDays < 180) s += 8;
  if (p.kind === 'post') s -= 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

const SOURCE_PRIORITY = ['transformer-circuits', 'alignment-blog', 'anthropic-site', 'openai-site', 'deepmind-site', 'arxiv-sweep', 'arxiv', 'openalex'];

export function sourceRank(s) {
  const i = SOURCE_PRIORITY.indexOf(s);
  return i === -1 ? SOURCE_PRIORITY.length : i;
}

/* Merge duplicate records: keep richest fields, prefer lab-site canonical URLs. */
export function mergeRecords(a, b) {
  const [hi, lo] = sourceRank(a.source) <= sourceRank(b.source) ? [a, b] : [b, a];
  return {
    ...lo,
    ...Object.fromEntries(Object.entries(hi).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))),
    authors: (hi.authors && hi.authors.length ? hi.authors : lo.authors) || [],
    abstract: longest(hi.abstract, lo.abstract),
    summary: hi.summary || lo.summary || null,
    topics: (hi.topics && hi.topics.length ? hi.topics : lo.topics) || [],
    arxiv_id: hi.arxiv_id || lo.arxiv_id || null,
    pdf_url: hi.pdf_url || lo.pdf_url || null,
    venue: hi.venue || lo.venue || null,
    cited_by: Math.max(hi.cited_by || 0, lo.cited_by || 0) || null,
    org: hi.org !== 'other' ? hi.org : lo.org,
    sources: [...new Set([...(hi.sources || [hi.source]), ...(lo.sources || [lo.source])])],
  };
}

function longest(a, b) {
  return (a || '').length >= (b || '').length ? a || null : b || null;
}

/* Master-file serializer: compact but line-per-paper so git diffs stay small. */
export function serializeDb(db) {
  return '{"updated":' + JSON.stringify(db.updated) + ',"count":' + db.papers.length + ',"papers":[\n'
    + db.papers.map((p) => JSON.stringify(p)).join(',\n') + '\n]}';
}
