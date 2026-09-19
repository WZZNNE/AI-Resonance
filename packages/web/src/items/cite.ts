/**
 * Brief bullets cite the items they draw on as `board#rank` (DESIGN §8.7), e.g. "… tops GitHub [repos#1, news#3]".
 * `parseBullet` splits a bullet into text and citations so the UI can link each one to its item.
 */
import { BOARDS, type Board } from '@resonance/schema'

export type BulletPart = string | { board: Board; rank: number }

const CITE = `(?:${BOARDS.join('|')})#\\d{1,3}`
const LIST = `${CITE}(?:\\s*[,，;；、/]\\s*${CITE})*`
// A bracketed group "(repos#1, news#2)" or a bare run "repos#1, news#2"; brackets of either width.
const GROUP = new RegExp(`\\s*[\\[(（【]\\s*(${LIST})\\s*[\\])）】]|(${LIST})`, 'g')
const ONE = new RegExp(`(${BOARDS.join('|')})#(\\d{1,3})`, 'g')

/** Pure: split a bullet into plain text and `{ board, rank }` citations (brackets around citations are dropped). */
export function parseBullet(text: string): BulletPart[] {
  const out: BulletPart[] = []
  let last = 0
  for (const m of text.matchAll(GROUP)) {
    const before = text.slice(last, m.index)
    if (before) out.push(before)
    for (const c of (m[1] ?? m[2]).matchAll(ONE)) out.push({ board: c[1] as Board, rank: Number(c[2]) })
    last = (m.index ?? 0) + m[0].length
  }
  const tail = text.slice(last)
  if (tail) out.push(tail)
  // After a citation, drop whitespace that would otherwise sit before punctuation or end the bullet.
  const tidy: BulletPart[] = []
  for (const p of out) {
    const prev = tidy[tidy.length - 1]
    const s =
      typeof p === 'string' && prev !== undefined && typeof prev !== 'string'
        ? p.replace(/^\s+(?=[.,;:!?。，；：！？)）]|$)/, '')
        : p
    if (s !== '') tidy.push(s)
  }
  return tidy
}
