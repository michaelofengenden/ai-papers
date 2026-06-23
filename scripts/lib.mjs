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
  // NOTE: never match the bare English word "fair" — it false-positived
  // academic papers (e.g. "undermines fair comparison") onto Meta/FAIR.
  // Meta/FAIR first pages always carry an unambiguous marker.
  ['meta', /\b(?:meta ai|meta platforms|facebook ai(?: research)?|fundamental ai research)\b/i],
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

/* ============================================================================
   Institution attribution — "where is this paper actually from?"

   Order of trust (most reliable first), implemented in classifyAffiliation():
     1. author email domain (snowflake.com, cam.ac.uk) — unambiguous & clean
     2. a curated known-institution name found in the affiliation text
     3. a generic .edu/.ac.* domain  -> academia (name lifted from the text)
     4. a generic "<X> University / Institute / Inc / Labs" phrase in the text
     5. any non-freemail corporate domain -> company (name from the domain)
   Returns null when nothing is found so the caller can fall back to authors.

   Crucially this only ever runs over AFFILIATION text (the paper's first page),
   never the abstract — abstracts name other labs' *models* ("DeepSeek-R1",
   "Llama") and common words ("fair comparison"), which is what mislabeled the
   corpus in the first place.

   Each entry: [canonicalName, group, orgColorKey]. `group` is one of
   lab | startup | academia | company and drives the sidebar grouping + the
   academia-vs-lab distinction. `orgColorKey` reuses an existing --<key> colour
   for the frontier labs; everyone else inherits a group colour on the client. */

export const INST_FREEMAIL = /^(?:gmail|googlemail|outlook|hotmail|live|yahoo|ymail|qq|163|126|foxmail|sina|protonmail|proton|icloud|me|aol|mail)\.[a-z.]+$/i;

/* domain (or any sub-domain of it) -> [canonicalName, group, orgColorKey] */
export const INSTITUTION_DOMAINS = [
  // ---- frontier AI labs ----
  ['anthropic.com', 'Anthropic', 'lab', 'anthropic'],
  ['openai.com', 'OpenAI', 'lab', 'openai'],
  ['deepmind.com', 'Google DeepMind', 'lab', 'deepmind'],
  ['research.google', 'Google Research', 'lab', 'deepmind'],
  ['google.com', 'Google Research', 'lab', 'deepmind'],
  ['meta.com', 'Meta AI', 'lab', 'meta'],
  ['fb.com', 'Meta AI', 'lab', 'meta'],
  ['microsoft.com', 'Microsoft Research', 'lab', 'microsoft'],
  ['deepseek.com', 'DeepSeek', 'lab', 'deepseek'],
  ['alibaba-inc.com', 'Qwen / Alibaba', 'lab', 'qwen'],
  ['alibaba.com', 'Qwen / Alibaba', 'lab', 'qwen'],
  ['mistral.ai', 'Mistral AI', 'lab', 'mistral'],
  ['x.ai', 'xAI', 'lab', 'xai'],
  ['allenai.org', 'Allen Institute for AI', 'lab', 'ai2'],
  // ---- big industry (not frontier-lab keys, but notable) ----
  ['nvidia.com', 'NVIDIA', 'company', 'other'],
  ['apple.com', 'Apple', 'company', 'other'],
  ['amazon.com', 'Amazon', 'company', 'other'],
  ['ibm.com', 'IBM Research', 'company', 'other'],
  ['salesforce.com', 'Salesforce Research', 'company', 'other'],
  ['bytedance.com', 'ByteDance', 'company', 'other'],
  ['tencent.com', 'Tencent', 'company', 'other'],
  ['baidu.com', 'Baidu', 'company', 'other'],
  ['huawei.com', 'Huawei', 'company', 'other'],
  ['samsung.com', 'Samsung Research', 'company', 'other'],
  ['navercorp.com', 'NAVER', 'company', 'other'],
  ['sony.com', 'Sony AI', 'company', 'other'],
  ['bloomberg.net', 'Bloomberg', 'company', 'other'],
  // ---- AI & safety startups ----
  ['snowflake.com', 'Snowflake AI Research', 'startup', 'other'],
  ['cohere.com', 'Cohere', 'startup', 'other'],
  ['cohere.ai', 'Cohere', 'startup', 'other'],
  ['huggingface.co', 'Hugging Face', 'startup', 'other'],
  ['eleuther.ai', 'EleutherAI', 'startup', 'other'],
  ['stability.ai', 'Stability AI', 'startup', 'other'],
  ['scale.com', 'Scale AI', 'startup', 'other'],
  ['perplexity.ai', 'Perplexity AI', 'startup', 'other'],
  ['ssi.inc', 'Safe Superintelligence', 'startup', 'other'],
  ['thinkingmachines.ai', 'Thinking Machines Lab', 'startup', 'other'],
  ['conjecture.dev', 'Conjecture', 'startup', 'other'],
  ['apolloresearch.ai', 'Apollo Research', 'startup', 'other'],
  ['metr.org', 'METR', 'startup', 'other'],
  ['redwoodresearch.org', 'Redwood Research', 'startup', 'other'],
  ['far.ai', 'FAR AI', 'startup', 'other'],
  ['together.ai', 'Together AI', 'startup', 'other'],
  ['together.xyz', 'Together AI', 'startup', 'other'],
  ['contextual.ai', 'Contextual AI', 'startup', 'other'],
  ['ai21.com', 'AI21 Labs', 'startup', 'other'],
  ['reka.ai', 'Reka AI', 'startup', 'other'],
  ['goodfire.ai', 'Goodfire', 'startup', 'other'],
  ['transluce.org', 'Transluce', 'startup', 'other'],
  ['safe.ai', 'Center for AI Safety', 'startup', 'other'],
  ['midjourney.com', 'Midjourney', 'startup', 'other'],
  ['runwayml.com', 'Runway', 'startup', 'other'],
  ['character.ai', 'Character.AI', 'startup', 'other'],
  ['inflection.ai', 'Inflection AI', 'startup', 'other'],
  ['liquid.ai', 'Liquid AI', 'startup', 'other'],
  ['writer.com', 'Writer', 'startup', 'other'],
  // ---- top academia (domain -> clean canonical name) ----
  ['mit.edu', 'MIT', 'academia', 'other'],
  ['stanford.edu', 'Stanford University', 'academia', 'other'],
  ['berkeley.edu', 'UC Berkeley', 'academia', 'other'],
  ['cmu.edu', 'Carnegie Mellon University', 'academia', 'other'],
  ['washington.edu', 'University of Washington', 'academia', 'other'],
  ['princeton.edu', 'Princeton University', 'academia', 'other'],
  ['harvard.edu', 'Harvard University', 'academia', 'other'],
  ['nyu.edu', 'New York University', 'academia', 'other'],
  ['cornell.edu', 'Cornell University', 'academia', 'other'],
  ['columbia.edu', 'Columbia University', 'academia', 'other'],
  ['ucla.edu', 'UCLA', 'academia', 'other'],
  ['ucsd.edu', 'UC San Diego', 'academia', 'other'],
  ['illinois.edu', 'UIUC', 'academia', 'other'],
  ['gatech.edu', 'Georgia Tech', 'academia', 'other'],
  ['utexas.edu', 'UT Austin', 'academia', 'other'],
  ['umich.edu', 'University of Michigan', 'academia', 'other'],
  ['caltech.edu', 'Caltech', 'academia', 'other'],
  ['yale.edu', 'Yale University', 'academia', 'other'],
  ['upenn.edu', 'University of Pennsylvania', 'academia', 'other'],
  ['wisc.edu', 'UW–Madison', 'academia', 'other'],
  ['umd.edu', 'University of Maryland', 'academia', 'other'],
  ['usc.edu', 'USC', 'academia', 'other'],
  ['cam.ac.uk', 'University of Cambridge', 'academia', 'other'],
  ['ox.ac.uk', 'University of Oxford', 'academia', 'other'],
  ['ed.ac.uk', 'University of Edinburgh', 'academia', 'other'],
  ['ucl.ac.uk', 'UCL', 'academia', 'other'],
  ['imperial.ac.uk', 'Imperial College London', 'academia', 'other'],
  ['ethz.ch', 'ETH Zurich', 'academia', 'other'],
  ['epfl.ch', 'EPFL', 'academia', 'other'],
  ['tsinghua.edu.cn', 'Tsinghua University', 'academia', 'other'],
  ['pku.edu.cn', 'Peking University', 'academia', 'other'],
  ['sjtu.edu.cn', 'Shanghai Jiao Tong University', 'academia', 'other'],
  ['fudan.edu.cn', 'Fudan University', 'academia', 'other'],
  ['zju.edu.cn', 'Zhejiang University', 'academia', 'other'],
  ['ruc.edu.cn', 'Renmin University of China', 'academia', 'other'],
  ['ustc.edu.cn', 'USTC', 'academia', 'other'],
  ['nus.edu.sg', 'National University of Singapore', 'academia', 'other'],
  ['ntu.edu.sg', 'Nanyang Technological University', 'academia', 'other'],
  ['u-tokyo.ac.jp', 'University of Tokyo', 'academia', 'other'],
  ['kaist.ac.kr', 'KAIST', 'academia', 'other'],
  ['snu.ac.kr', 'Seoul National University', 'academia', 'other'],
  ['utoronto.ca', 'University of Toronto', 'academia', 'other'],
  ['mila.quebec', 'Mila', 'academia', 'other'],
  ['tum.de', 'TU Munich', 'academia', 'other'],
  ['mpg.de', 'Max Planck Institute', 'academia', 'other'],
  ['inria.fr', 'Inria', 'academia', 'other'],
  ['technion.ac.il', 'Technion', 'academia', 'other'],
  ['huji.ac.il', 'Hebrew University of Jerusalem', 'academia', 'other'],
  ['tau.ac.il', 'Tel Aviv University', 'academia', 'other'],
];

/* curated institution NAMES found directly in affiliation text (case-insensitive
   unless an acronym demands case). Mirrors the canonical names above so the
   domain path and the text path agree. Order: specific before generic. */
export const KNOWN_INSTITUTIONS = [
  ['Anthropic', 'lab', 'anthropic', /\banthropic\b/i],
  ['OpenAI', 'lab', 'openai', /\bopen\s?ai\b/i],
  ['Google DeepMind', 'lab', 'deepmind', /\b(?:google )?deepmind\b/i],
  ['Google Research', 'lab', 'deepmind', /\bgoogle (?:research|brain)\b/i],
  ['Meta AI', 'lab', 'meta', /\bmeta ai\b|\bfacebook ai\b|\bfundamental ai research\b|\bFAIR,? (?:meta|menlo)|\bmeta,? (?:fair|menlo park|platforms)\b/],
  ['Microsoft Research', 'lab', 'microsoft', /\bmicrosoft\b/i],
  ['DeepSeek', 'lab', 'deepseek', /\bdeepseek(?:[ -]ai)?\b/i],
  ['Qwen / Alibaba', 'lab', 'qwen', /\bqwen\b|\balibaba\b|\btongyi\b|\bdamo academy\b/i],
  ['Mistral AI', 'lab', 'mistral', /\bmistral\s?ai\b/i],
  ['xAI', 'lab', 'xai', /\bx\.ai\b|\bxai\b(?=.{0,30}(?:grok|corp|inc))/i],
  ['Allen Institute for AI', 'lab', 'ai2', /\ballen institute for (?:artificial intelligence|ai)\b|\ballenai\b/i],
  ['NVIDIA', 'company', 'other', /\bnvidia\b/i],
  ['IBM Research', 'company', 'other', /\bibm\b/i],
  ['Salesforce Research', 'company', 'other', /\bsalesforce\b/i],
  ['ByteDance', 'company', 'other', /\bbytedance\b|\bseed team\b/i],
  ['Tencent', 'company', 'other', /\btencent\b/i],
  ['Apple', 'company', 'other', /\bapple inc\b|\bapple machine learning\b/i],
  ['Snowflake AI Research', 'startup', 'other', /\bsnowflake\b/i],
  ['Cohere', 'startup', 'other', /\bcohere\b/i],
  ['Hugging Face', 'startup', 'other', /\bhugging\s?face\b/i],
  ['EleutherAI', 'startup', 'other', /\beleuther\s?ai\b/i],
  ['Stability AI', 'startup', 'other', /\bstability ai\b/i],
  ['Scale AI', 'startup', 'other', /\bscale ai\b/i],
  ['Perplexity AI', 'startup', 'other', /\bperplexity\b/i],
  ['Safe Superintelligence', 'startup', 'other', /\bsafe superintelligence\b|\bSSI inc\b/i],
  ['Thinking Machines Lab', 'startup', 'other', /\bthinking machines\b/i],
  ['Apollo Research', 'startup', 'other', /\bapollo research\b/i],
  ['METR', 'startup', 'other', /\bMETR\b/],
  ['Redwood Research', 'startup', 'other', /\bredwood research\b/i],
  ['FAR AI', 'startup', 'other', /\bFAR\b ?AI|\bFAR AI\b/i],
  ['Together AI', 'startup', 'other', /\btogether ai\b/i],
  ['AI21 Labs', 'startup', 'other', /\bai21\b/i],
  ['Center for AI Safety', 'startup', 'other', /\bcenter for ai safety\b/i],
];

/* Canonical institution name for each frontier-lab colour key — so lab blog
   posts and other non-arXiv lab records (which never hit the PDF backfill) still
   carry a consistent `inst` and group under the same sidebar chip as their
   arXiv papers. */
export const ORG_TO_INST = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepmind: 'Google DeepMind',
  meta: 'Meta AI',
  microsoft: 'Microsoft Research',
  deepseek: 'DeepSeek',
  qwen: 'Qwen / Alibaba',
  mistral: 'Mistral AI',
  xai: 'xAI',
  ai2: 'Allen Institute for AI',
};

function instEmailDomains(text) {
  const out = [];
  const re = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].toLowerCase().replace(/\.$/, ''));
  return out;
}

function matchInstDomain(d) {
  for (const ent of INSTITUTION_DOMAINS) if (d === ent[0] || d.endsWith('.' + ent[0])) return ent;
  return null;
}

/* Generic academic domain: *.edu, *.edu.cn, *.ac.uk, *.ac.jp, etc. */
function isAcademicDomain(d) {
  return /(?:^|\.)edu$|\.edu\.[a-z]{2,3}$|\.ac\.[a-z]{2,3}$|(?:^|\.)edu\.[a-z]{2}$/.test(d);
}

/* Pull a plausible institution name out of free affiliation text.
   Returns {name, kind} or null. Academia markers win over company markers. */
export function guessInstitutionFromText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const ACAD = [
    /\bUniversity of [A-Z][\w'’.-]+(?:[, ]+[A-Z][\w'’.-]+){0,2}/,
    /\b[A-Z][\w'’.&-]+(?:\s+[A-Z][\w'’.&-]+){0,3}\s+University\b/,
    /\b[A-Z][\w'’.&-]+(?:\s+[A-Z][\w'’.&-]+){0,3}\s+Institute of Technology\b/,
    /\b(?:[A-Z][\w'’.&-]+\s+){0,3}Institute\b(?!\s+of\s+[A-Z])/,
    /\b[A-Z][\w'’.&-]+(?:\s+[A-Z][\w'’.&-]+){0,2}\s+College\b/,
    /\b(?:Universit[éè]|Universidad|Università|Universität|Universiteit)\s+[A-Z][\w'’.-]+(?:\s+[\w'’.-]+){0,2}/,
  ];
  for (const re of ACAD) { const m = t.match(re); if (m) return { name: tidyInst(m[0]), kind: 'academia' }; }
  const CORP = [
    /\b[A-Z][\w'’.&-]+(?:\s+[A-Z][\w'’.&-]+){0,3}\s+(?:Research|Labs|Laboratories|AI Lab)\b/,
    /\b[A-Z][\w'’.&-]+(?:\s+[A-Z][\w'’.&-]+){0,2}\s+(?:Inc\.?|Corporation|Corp\.?|Technologies|GmbH|Ltd\.?)\b/,
    /\b[A-Z][\w'’.&-]+\s+AI\b/,
  ];
  for (const re of CORP) { const m = t.match(re); if (m) return { name: tidyInst(m[0]), kind: 'company' }; }
  return null;
}

function tidyInst(s) {
  return String(s).replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/^(?:the|and|of|at)\s+/i, '').trim().slice(0, 60);
}

function prettyDomain(d) {
  const label = d.replace(/\.(com|org|net|ai|io|co|inc|dev|edu|gov)(\.[a-z]{2})?$/i, '').split('.').pop() || d;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* MAIN: map first-page affiliation text to {inst, instKind, org}, or null. */
export function classifyAffiliation(affilText, emailText) {
  const text = String(affilText || '');
  const domains = instEmailDomains(emailText != null ? emailText : text);
  // 1. known email domain — cleanest, unambiguous
  for (const d of domains) {
    const hit = matchInstDomain(d);
    if (hit) return { inst: hit[1], instKind: hit[2], org: hit[3] };
  }
  // 2. curated institution name in the affiliation text
  for (const [name, group, org, re] of KNOWN_INSTITUTIONS) if (re.test(text)) return { inst: name, instKind: group, org };
  // 3. generic academic domain -> academia, name lifted from the text
  for (const d of domains) {
    if (isAcademicDomain(d)) {
      const g = guessInstitutionFromText(text);
      return { inst: g && g.kind === 'academia' ? g.name : prettyDomain(d), instKind: 'academia', org: 'other' };
    }
  }
  // 4. generic "<X> University / Institute / Inc / Labs" phrase in the text
  const g = guessInstitutionFromText(text);
  if (g) return { inst: g.name, instKind: g.kind, org: 'other' };
  // 5. any remaining non-freemail corporate domain -> company
  for (const d of domains) {
    if (!INST_FREEMAIL.test(d) && !isAcademicDomain(d)) return { inst: prettyDomain(d), instKind: 'company', org: 'other' };
  }
  return null; // nothing usable -> caller falls back to first authors
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
