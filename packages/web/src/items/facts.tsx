/**
 * Board facts for the item detail: everything the source told us, as a definition list, plus the long-form text
 * blocks (abstract, post text, top comments, "also on" links). Text is always rendered as text.
 */
import type { Item } from '@resonance/schema'
import type { ComponentChildren } from 'preact'
import { fmt, t } from '../i18n/index.ts'
import { Chip } from '../ui/chip.tsx'
import { ExtLink } from '../ui/link.tsx'
import { KIND_KEYS, labDate, socialPosition, socialWho } from './meta.tsx'

type Row = [label: string, value: ComponentChildren] | false | null | undefined | ''

function Rows({ rows }: { rows: Row[] }) {
  const kept = rows.filter(
    (r): r is [string, ComponentChildren] => !!r && r[1] !== undefined && r[1] !== null && r[1] !== '',
  )
  return (
    <dl class="facts">
      {kept.map(([label, value]) => (
        <div key={label} class="facts__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

const n = (v: number | undefined) => (v === undefined ? undefined : fmt.number(v))

/** Key/value facts for any board. */
export function ItemFacts({ item }: { item: Item }) {
  switch (item.board) {
    case 'repos': {
      const r = item.repo
      return (
        <Rows
          rows={[
            [t('facts.stars'), n(r.stars)],
            [t('facts.starsToday'), fmt.signed(r.starsToday)],
            [t('facts.forks'), n(r.forks)],
            [t('facts.language'), r.language],
            [t('facts.license'), r.license],
            r.createdAt && [t('facts.created'), fmt.dateTime(r.createdAt)],
            r.pushedAt && [t('facts.pushed'), fmt.relative(r.pushedAt)],
            r.topics.length > 0 && [
              t('facts.topics'),
              <span key="t" class="facts__chips">
                {r.topics.map((x) => (
                  <Chip key={x} size="s">
                    {x}
                  </Chip>
                ))}
              </span>,
            ],
          ]}
        />
      )
    }
    case 'papers': {
      const p = item.paper
      const authors =
        p.authors.length > 8
          ? `${p.authors.slice(0, 8).join(', ')} ${t('facts.andMore', { n: p.authors.length - 8 })}`
          : p.authors.join(', ')
      return (
        <Rows
          rows={[
            [t('facts.authors'), authors],
            !!p.orgs?.length && [t('facts.orgs'), p.orgs.join(' · ')],
            p.venue && [t('facts.venue'), p.venue],
            p.arxivId && [
              t('facts.arxiv'),
              <ExtLink key="a" href={`https://arxiv.org/abs/${p.arxivId}`}>
                {p.arxivId}
              </ExtLink>,
            ],
            p.doi && [
              t('facts.doi'),
              <ExtLink key="d" href={`https://doi.org/${p.doi}`}>
                {p.doi}
              </ExtLink>,
            ],
            [t('facts.categories'), p.categories.join(' · ')],
            p.hfUpvotes !== undefined && [t('facts.hfUpvotes'), n(p.hfUpvotes)],
            p.hfComments !== undefined && [t('facts.hfComments'), n(p.hfComments)],
            p.codeUrl && [
              t('facts.code'),
              <ExtLink key="c" href={p.codeUrl} arrow>
                {p.codeUrl.replace(/^https?:\/\/(www\.)?/, '')}
                {p.codeStars ? ` · ★ ${fmt.compact(p.codeStars)}` : ''}
              </ExtLink>,
            ],
            (p.pdfUrl || p.hfUrl) && [
              t('facts.links'),
              <span key="l" class="facts__links">
                {p.pdfUrl && (
                  <ExtLink href={p.pdfUrl} arrow>
                    PDF
                  </ExtLink>
                )}
                {p.hfUrl && (
                  <ExtLink href={p.hfUrl} arrow>
                    Hugging Face
                  </ExtLink>
                )}
              </span>,
            ],
          ]}
        />
      )
    }
    case 'news': {
      const x = item.news
      return (
        <Rows
          rows={[
            [t('facts.points'), n(x.points)],
            [t('facts.comments'), n(x.comments)],
            x.author && [t('facts.author'), x.author],
            x.domain && [t('facts.domain'), x.domain],
            [t('facts.posted'), fmt.dateTime(x.createdAt)],
            [
              t('facts.discussion'),
              <ExtLink key="h" href={x.hnUrl} arrow>
                news.ycombinator.com
              </ExtLink>,
            ],
          ]}
        />
      )
    }
    case 'social': {
      const s = item.social
      const pos = socialPosition(item)
      return (
        <Rows
          rows={[
            [t('facts.platform'), t(s.platform === 'x' ? 'platform.x' : 'platform.reddit')],
            [
              t('facts.author'),
              s.handle && s.handle !== s.author
                ? `${s.author} (${s.platform === 'x' ? '@' : 'u/'}${s.handle})`
                : s.author,
            ],
            s.community && [t('facts.community'), `r/${s.community}`],
            [t('facts.posted'), fmt.dateTime(s.createdAt)],
            s.rankBasis === 'votes'
              ? [t(s.platform === 'x' ? 'facts.likes' : 'facts.score'), n(s.likes)]
              : [
                  t('facts.rankBasis'),
                  pos ? t('meta.position', { n: pos, where: socialWho(item) }) : t('meta.byPosition'),
                ],
            s.rankBasis === 'votes' && [t('facts.comments'), n(s.comments)],
            s.reposts !== undefined && [t('facts.reposts'), n(s.reposts)],
            s.views !== undefined && [t('facts.views'), n(s.views)],
            s.ratio !== undefined && [t('facts.ratio'), `${Math.round(s.ratio * 100)}%`],
            s.flair && [t('facts.flair'), s.flair],
            s.linkUrl && [
              t('facts.shared'),
              <ExtLink key="u" href={s.linkUrl} arrow>
                {s.linkUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
              </ExtLink>,
            ],
            [
              t('facts.permalink'),
              <ExtLink key="p" href={s.permalink} arrow>
                {s.platform === 'x' ? 'x.com' : 'reddit.com'}
              </ExtLink>,
            ],
          ]}
        />
      )
    }
    case 'labs': {
      const l = item.lab
      return (
        <Rows
          rows={[
            [t('facts.company'), l.companyName],
            [t('facts.kind'), t(KIND_KEYS[l.kind])],
            [t('facts.surface'), l.surface],
            [t('facts.published'), `${labDate(item)} · ${t(`precision.${l.datePrecision}` as 'precision.day')}`],
            [t('facts.fresh'), l.fresh ? t('facts.freshYes') : t('facts.freshNo')],
            !!l.alsoOn?.length && [
              t('facts.alsoOn'),
              <span key="a" class="facts__links">
                {l.alsoOn.map((a) => (
                  <ExtLink key={a.url} href={a.url} arrow>
                    {a.surface}
                  </ExtLink>
                ))}
              </span>,
            ],
          ]}
        />
      )
    }
  }
}

/** Long-form source text: abstract, post text, lab excerpt. */
export function SourceText({ item }: { item: Item }) {
  const text = item.board === 'papers' ? item.paper.abstract : item.board === 'social' ? item.social.text : item.summary
  if (!text) return null
  return <p class="detail__source">{text}</p>
}

/** Reddit top comments kept by the pipeline (text only, ≤ 2 days). */
export function TopComments({ item }: { item: Item }) {
  if (item.board !== 'social' || !item.social.topComments?.length) return null
  return (
    <ol class="comments">
      {item.social.topComments.map((c, i) => (
        <li key={i} class="comments__item">
          <p>{c.text}</p>
          {c.score !== undefined && <span class="comments__score num">▲ {fmt.compact(c.score)}</span>}
        </li>
      ))}
    </ol>
  )
}
