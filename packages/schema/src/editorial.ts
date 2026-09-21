import type { Board } from './api.ts'

export interface EditorialCandidate {
  board: Board
  title: string
  summary: string
  social?: { text: string }
}

/** Editorial eligibility is separate from the transparent heat score; excluded items remain on their board. */
export function editorialEligibility(item: EditorialCandidate): {
  eligible: boolean
  reason?: 'conversation' | 'promotion' | 'no-information'
} {
  if (item.board !== 'social') return { eligible: true }
  const title = item.title.trim()
  const text = `${title} ${item.summary} ${item.social?.text ?? ''}`.replace(/https?:\/\/\S+/g, '').trim()
  const conversation =
    /^(?:what (?:are|is|do|did|would|will) you|what(?:'s| is) (?:your|everyone)|anyone (?:else|here)|who(?:'s| is) (?:building|using)|happy (?:friday|weekend|monday)|good morning|is there (?:something|a tool) like)\b/i
  if (conversation.test(title) || /(?:你们|大家)(?:周末|今天|最近)?(?:在做|在用|都用|喜欢)/.test(title))
    return { eligible: false, reason: 'conversation' }
  if (
    /\b(?:like and (?:repost|share)|retweet to win|giveaway|tag (?:a |your )?friend|comment (?:below|to get)|follow (?:us|me) for)\b/i.test(
      text,
    )
  )
    return { eligible: false, reason: 'promotion' }
  // A reaction without an explanation/source is not a daily takeaway. Substantive discussion still qualifies.
  if (
    text.length < 240 &&
    /^(?:a great example of|this is (?:amazing|incredible|huge)|wow\b|thoughts\??|with .{1,50}, bench goes up)/i.test(
      title,
    )
  )
    return { eligible: false, reason: 'no-information' }
  return { eligible: true }
}
