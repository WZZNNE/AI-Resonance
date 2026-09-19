/**
 * One rule-based category per item (DESIGN §4a), shared by every board so the UI can filter them all the same way.
 * Order of evidence: a source's own label (a lab post's kind, a Reddit flair or `[R]` tag, an HN `Ask`/`Show`/`Launch`
 * tag), then title/text cues in a fixed priority, then the board's default. The matched cue is appended to
 * `relevance.reasons` as `cat:<cue>`. Categories never change scores. Pure.
 */
import type { Category, LabKind } from '@resonance/schema'
import type { Categorize, RawCandidate } from './types.ts'

/** A text cue: the first regex of a board's list that matches decides the category. */
interface Cue {
  category: Category
  regex: RegExp
}

/** An outcome plus the words that decided it (becomes `cat:<cue>`). */
export interface Verdict {
  category: Category
  cue: string
}

// Guards come from real traps: "Astra for Law" is a product name, "scaling laws" and RL's "policy optimization" are
// research, "raises prices" is product, "partner-built plugins" is a launch.
const POLICY =
  /\b(regulat(?:ion|ions|ory|ors?|e|es|ed|ing)|legislat\w*|(?:new|state|federal|eu|california|copyright|privacy|ai) laws?|lawmakers?|lawsuits?|sues|sued|court|ruling|antitrust|copyright|policy(?! (?:optimi[sz]ation|gradients?|networks?|models?|learning|iteration|distillation|head))|policies|governments?|senate|congress|parliament|white house|executive order|(?:eu )?ai act|safety bill|ban(?:s|ned)?)\b/i
const INDUSTRY =
  /\b(funding|raises? \$[\d.]+[bmk]?|raised \$[\d.]+[bmk]?|series [a-f]|valuation|acqui(?:res?|red|ring|sition)|merg(?:er|es|ed)|partnerships?|partners? with|partnering with|hiring|hires|layoffs?|laid off|ipo|revenue|invest(?:s|ed|ment|ments|ors?)?|ceo|cfo|cto|appoint(?:s|ed)?|resign(?:s|ed)?|steps down|earnings)\b/i
const QUESTION = /^\s*(ask hn|ask|why|anyone|does anyone|is it just me)\b|\?\s*$/i
const SHOWCASE =
  /\b(show hn|i (?:built|made|wrote|created|open[- ]sourced)|we (?:built|made)|my (?:first |new |side )?(?:project|tool|app|library|cli)|open[- ]source (?:alternative|tool|library|cli|framework|app))\b/i
const ENGINEERING =
  /\b(how we|postmortem|post-mortem|incident|outage|infrastructure|infra|kernels?|at scale|serving|lessons learned|under the hood|deep dive)\b/i
const RELEASE =
  /\b(releas(?:e|es|ed|ing)|launch(?:es|ed|ing)?|introduc(?:e|es|ed|ing)|announc(?:e|es|ed|ing)|unveil(?:s|ed|ing)?|now available|generally available|is (?:here|out)|out now|open[- ]?sourc(?:es|ed|ing)|open[- ]source (?:model|llm|weights)|open[- ]weights?|weights (?:are|now) (?:up|out|available))\b/i
const RESEARCH =
  /\b(papers?|research|researchers|scaling laws?|benchmarks?|study|studies|we (?:show|find|propose|present)|arxiv|dataset|evals?|evaluation|interpretability)\b/i
const PRODUCT =
  /\b(apis?|sdks?|pricing|prices?|price cut|deprecat\w*|retir(?:e|es|ed|ing|ement)|rate limits?|endpoints?|subscription|(?:pro|max|team|enterprise|free) plan|features?|rolling out|rolls out|can now|now supports?|add(?:s|ing)? support|support for|changelog|app)\b/i
const TOOL = /\b(library|cli|framework|toolkit|a tool|tool for|plugin|extension|github repo|self-hosted|wrapper)\b/i
const DISCUSSION = /\b(discussion|opinion|thoughts|rant|essay|debate|hot take)\b/i

/** Cue priority for boards whose items are headlines about anything. */
const HEADLINE_CUES: Cue[] = [
  { category: 'policy', regex: POLICY },
  { category: 'industry', regex: INDUSTRY },
  { category: 'discussion', regex: QUESTION },
  { category: 'tool', regex: SHOWCASE },
  { category: 'engineering', regex: ENGINEERING },
  { category: 'release', regex: RELEASE },
  { category: 'research', regex: RESEARCH },
  { category: 'product', regex: PRODUCT },
  { category: 'tool', regex: TOOL },
  { category: 'discussion', regex: DISCUSSION },
]

/** Repos are tools unless their description says they ship weights or implement a paper. */
const REPO_CUES: Cue[] = [
  { category: 'release', regex: /\b(open[- ]weights?|model weights|checkpoints?|pretrained models?|model card)\b/i },
  {
    category: 'research',
    // A conference tag opens with "[", which has no word boundary before it.
    regex:
      /\bofficial (?:\w+ )?implementation\b|\bcode (?:for|of) (?:the |our )?paper\b|\[(?:neurips|icml|iclr|cvpr|iccv|eccv|acl|emnlp|naacl|aaai|colm)\b[^\]]*\]/i,
  },
]

/** A paper is research, unless it is about law and governance rather than models. */
const PAPER_CUES: Cue[] = [
  { category: 'policy', regex: /\b(regulat\w+|legislat\w+|governance|eu ai act|copyright)\b/i },
]

const LAB_KIND: Record<LabKind, Category> = {
  model: 'release',
  product: 'product',
  research: 'research',
  engineering: 'engineering',
  company: 'industry',
}

/** Reddit flairs → category; `News` and `Other` say nothing about the kind of post and fall through to the cues. */
const FLAIRS: Array<[RegExp, Category]> = [
  [/new model|model release|release|launch|announcement/i, 'release'],
  [/research|paper/i, 'research'],
  [/resources?|project|tool|tutorial|guide|showcase|built with|workflow/i, 'tool'],
  [/discussion|question|help|opinion|meme|funny|humou?r|rant|complaint|shitpost/i, 'discussion'],
  [/industry|business|funding|jobs?|hiring/i, 'industry'],
  [/policy|ethics|regulation|law|politics/i, 'policy'],
]

/** r/MachineLearning-style title tags. */
const TITLE_TAG = /^\s*\[(r|research|d|discussion|p|project)\]/i
const TITLE_TAGS: Record<string, Category> = {
  r: 'research',
  research: 'research',
  d: 'discussion',
  discussion: 'discussion',
  p: 'tool',
  project: 'tool',
}

const HN_TAGS: Array<[string, Category]> = [
  ['ask_hn', 'discussion'],
  ['show_hn', 'tool'],
  ['launch_hn', 'product'],
]

function firstCue(cues: Cue[], text: string): Verdict | null {
  for (const { category, regex } of cues) {
    const m = regex.exec(text)
    if (m) return { category, cue: m[0].trim().toLowerCase() }
  }
  return null
}

/** The source's own label for a social post: its Reddit flair or an `[R]`/`[D]`/`[P]` title tag. */
function socialHint(cand: RawCandidate): Verdict | null {
  if (cand.board !== 'social') return null
  const flair = cand.social.flair?.trim()
  if (flair) {
    const hit = FLAIRS.find(([regex]) => regex.test(flair))
    if (hit) return { category: hit[1], cue: `flair:${flair.toLowerCase()}` }
  }
  const tag = TITLE_TAG.exec(cand.title)
  return tag ? { category: TITLE_TAGS[tag[1].toLowerCase()], cue: `tag:${tag[1].toLowerCase()}` } : null
}

/** The category of one candidate and the cue that decided it. Exported for the tests; `categorize` is the stage. */
export function categoryOf(cand: RawCandidate): Verdict {
  switch (cand.board) {
    case 'repos':
      return firstCue(REPO_CUES, `${cand.title} ${cand.summary}`) ?? { category: 'tool', cue: 'board' }
    case 'papers':
      return firstCue(PAPER_CUES, cand.title) ?? { category: 'research', cue: 'board' }
    case 'labs': {
      const kind = LAB_KIND[cand.lab.kind]
      const policy = kind === 'industry' ? POLICY.exec(`${cand.title} ${cand.summary}`) : null
      return policy
        ? { category: 'policy', cue: policy[0].toLowerCase() }
        : { category: kind, cue: `kind:${cand.lab.kind}` }
    }
    case 'news': {
      const tag = HN_TAGS.find(([t]) => cand.tags.includes(t))
      if (tag) return { category: tag[1], cue: tag[0] }
      return firstCue(HEADLINE_CUES, cand.title) ?? { category: 'discussion', cue: 'board' }
    }
    case 'social': {
      const text = cand.social.platform === 'x' ? cand.social.text || cand.title : cand.title
      const found = socialHint(cand) ?? firstCue(HEADLINE_CUES, text)
      if (found) return found
      // A lab account with no cue is usually shipping something small ("Claude now works in Excel").
      return cand.social.authorKind === 'lab'
        ? { category: 'product', cue: 'watch:lab' }
        : { category: 'discussion', cue: 'board' }
    }
  }
}

/** Sets `category` on every candidate and records its cue. See `Categorize` in `types.ts`. */
export const categorize: Categorize = (candidates) =>
  candidates.map((cand) => {
    const { category, cue } = categoryOf(cand)
    if (!cand.relevance) return { ...cand, category }
    // Idempotent: a re-run replaces the previous verdict instead of stacking cues.
    const reasons = [...cand.relevance.reasons.filter((r) => !r.startsWith('cat:')), `cat:${cue}`]
    return { ...cand, category, relevance: { ...cand.relevance, reasons } }
  })
