/**
 * The board-specific meta row of a card (DESIGN §7.2): ★ total +today · language / ↑ upvotes · code / ▲ points · 💬 /
 * platform · @author or r/community · ♥ · 💬 / company · kind · surface · date. Numbers are tabular and every icon has
 * a text equivalent for screen readers.
 */
import type { Item, LabKind, SocialItem } from '@resonance/schema'
import type { ComponentChildren } from 'preact'
import { fmt, type MessageKey, t, term } from '../i18n/index.ts'
import { Icon, type IconName } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'

/** A number with an icon and a screen-reader label. */
export function Stat({
  icon,
  value,
  label,
  class: cls,
}: {
  icon: IconName
  value: string
  label: string
  class?: string
}) {
  return (
    <span class={`stat${cls ? ` ${cls}` : ''}`} title={label}>
      <Icon name={icon} size={14} />
      <span class="num">{value}</span>
      <span class="sr-only"> {label}</span>
    </span>
  )
}

/**
 * Position of a Reddit post in its community's Top-Today list (RSS mode). Not yet part of the published contract —
 * read defensively so the card can say "#3 in r/LocalLLaMA" as soon as the pipeline provides it.
 */
export function socialPosition(item: SocialItem): number | undefined {
  const p = (item.social as SocialItem['social'] & { position?: unknown }).position
  return typeof p === 'number' && p > 0 ? p : undefined
}

/** Who posted it: `@handle` on X, `r/community` on Reddit. */
export function socialWho(item: SocialItem): string {
  const s = item.social
  if (s.platform === 'reddit') return s.community ? `r/${s.community}` : `u/${s.handle ?? s.author}`
  return s.handle ? `@${s.handle}` : s.author
}

export const KIND_KEYS: Record<LabKind, MessageKey> = {
  model: 'kind.model',
  product: 'kind.product',
  research: 'kind.research',
  engineering: 'kind.engineering',
  company: 'kind.company',
}

/** Published date of a lab post at the precision the source gave. */
export function labDate(item: Extract<Item, { board: 'labs' }>): string {
  const l = item.lab
  const text = fmt.published(l.publishedAt, l.datePrecision === 'first-seen' ? 'day' : l.datePrecision)
  return l.datePrecision === 'first-seen' ? t('meta.firstSeen', { date: text }) : text
}

function parts(item: Item): ComponentChildren[] {
  switch (item.board) {
    case 'repos': {
      const r = item.repo
      return [
        <Stat key="s" icon="star" value={fmt.compact(r.stars)} label={t('meta.stars')} />,
        r.starsToday > 0 && (
          <span key="g" class="meta__gain num">
            {t('meta.starsToday', { n: fmt.signed(r.starsToday) })}
          </span>
        ),
        r.language && <span key="l">{r.language}</span>,
      ]
    }
    case 'papers': {
      const p = item.paper
      const who = p.venue ?? (p.orgs?.[0] || (p.authors[0] ? t('meta.etAl', { name: p.authors[0] }) : undefined))
      return [
        p.hfUpvotes !== undefined && (
          <Stat key="u" icon="arrow-up" value={fmt.compact(p.hfUpvotes)} label={t('meta.upvotes')} />
        ),
        p.hfComments ? (
          <Stat key="c" icon="comment" value={fmt.compact(p.hfComments)} label={t('meta.comments')} />
        ) : null,
        p.codeUrl && (
          <Stat
            key="k"
            icon="code"
            value={p.codeStars ? fmt.compact(p.codeStars) : t('meta.code')}
            label={t('meta.codeStars')}
          />
        ),
        who && (
          <span key="w" class="meta__who">
            {who}
          </span>
        ),
      ]
    }
    case 'news': {
      const n = item.news
      return [
        <Stat key="p" icon="arrow-up" value={fmt.compact(n.points)} label={t('meta.points')} />,
        <Stat key="c" icon="comment" value={fmt.compact(n.comments)} label={t('meta.comments')} />,
        n.domain && (
          <span key="d" class="meta__who">
            {n.domain}
          </span>
        ),
        <span key="t">{fmt.relative(n.createdAt)}</span>,
      ]
    }
    case 'social': {
      const s = item.social
      const who = (
        <span key="w" class="meta__platform">
          <Icon name={s.platform === 'x' ? 'x_logo' : 'reddit'} size={14} />
          <span class="sr-only">{t(s.platform === 'x' ? 'platform.x' : 'platform.reddit')} </span>
          <span class="meta__who">{socialWho(item)}</span>
        </span>
      )
      if (s.rankBasis === 'position') {
        // RSS mode has no counts: the community list position is the whole story ("rank #3 in r/LocalLLaMA").
        const pos = socialPosition(item)
        return [
          <span key="w" class="meta__platform" title={t('meta.positionHelp')}>
            <Icon name="reddit" size={14} />
            <span class="meta__position">
              {pos
                ? t('meta.position', { n: pos, where: socialWho(item) })
                : `${socialWho(item)} · ${t('meta.byPosition')}`}
            </span>
          </span>,
          <span key="t">{fmt.relative(s.createdAt)}</span>,
        ]
      }
      return [
        who,
        <Stat
          key="l"
          icon={s.platform === 'x' ? 'heart' : 'arrow-up'}
          value={fmt.compact(s.likes)}
          label={t(s.platform === 'x' ? 'meta.likes' : 'meta.score')}
        />,
        <Stat key="c" icon="comment" value={fmt.compact(s.comments)} label={t('meta.comments')} />,
        s.reposts ? <Stat key="r" icon="repost" value={fmt.compact(s.reposts)} label={t('meta.reposts')} /> : null,
        <span key="t">{fmt.relative(s.createdAt)}</span>,
      ]
    }
    case 'labs': {
      const l = item.lab
      return [
        <span key="c" class="meta__company">
          <Icon name="lab" size={14} />
          {l.companyName}
        </span>,
        <span key="k">{t(KIND_KEYS[l.kind])}</span>,
        <span key="s">{term('surface', l.surface)}</span>,
        <span key="d" class="num">
          {labDate(item)}
        </span>,
        // "Just published" is a fact about the post, not a board event: plain meta text, never the NEW pill.
        l.fresh && (
          <span key="n" class="meta__fresh" title={t('meta.freshHelp')}>
            {t('meta.fresh')}
          </span>
        ),
        !!l.alsoOn?.length && (
          <span key="a" class="meta__also">
            {t('meta.alsoOn')}{' '}
            {l.alsoOn.map((a) => (
              <ExtLink key={a.url} href={a.url} arrow>
                {term('surface', a.surface)}
              </ExtLink>
            ))}
          </span>
        ),
      ]
    }
  }
}

/** Board-specific facts under a card title. */
export function ItemMeta({ item }: { item: Item }) {
  return (
    <div class="meta" data-part="item-meta">
      {parts(item).filter(Boolean)}
    </div>
  )
}
