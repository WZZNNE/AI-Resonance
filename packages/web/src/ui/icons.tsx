/**
 * Inline SVG icons on a 24-unit grid, 1.75 stroke, `currentColor`. Decorative by default (`aria-hidden`); give the
 * surrounding control an accessible name. Add an icon = one entry in `PATHS` (strokes; a `!` prefix fills one path) or
 * `FILLED` (solid shapes).
 */
import type { JSX } from 'preact'

/** Circle as a path, so every icon is a list of `d` strings. */
const c = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

/** An 8-tooth cog, generated rather than hand-drawn so it stays symmetric. */
function cog(): string {
  const pts: string[] = []
  const teeth = 8
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2
    const r = i % 4 === 1 || i % 4 === 2 ? 9.5 : 7.4
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z${c(12, 12, 3)}`
}

const PATHS = {
  search: [c(11, 11, 6.5), 'M16 16l4.5 4.5'],
  settings: [cog()],
  sun: [
    c(12, 12, 4),
    'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  ],
  moon: ['M20 14.6A8 8 0 0 1 9.4 4a8 8 0 1 0 10.6 10.6z'],
  contrast: [c(12, 12, 8.5), '!M12 3.5a8.5 8.5 0 0 1 0 17z'],
  download: ['M12 4v11M7 10.5l5 5 5-5M5 20h14'],
  upload: ['M12 16V5M7 9.5l5-5 5 5M5 20h14'],
  external: ['M13.5 4.5H19.5V10.5M19.5 4.5l-8.5 8.5M18 14v5.5H4.5V6H10'],
  link: [
    'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1',
    'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  ],
  copy: ['M9 9h10.5v10.5H9z', 'M5 15H4.5V4.5H15V5'],
  sparkle: [
    'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z',
    'M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  ],
  'chevron-down': ['M6 9l6 6 6-6'],
  'chevron-up': ['M6 15l6-6 6 6'],
  'chevron-left': ['M15 6l-6 6 6 6'],
  'chevron-right': ['M9 6l6 6-6 6'],
  x: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  info: [c(12, 12, 9), 'M12 11v5.5M12 7.8v.2'],
  warn: ['M12 3.8l9 15.7H3z', 'M12 10v4.2M12 16.8v.2'],
  error: [c(12, 12, 9), 'M9 9l6 6M15 9l-6 6'],
  star: ['M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z'],
  fork: [c(6.5, 5.5, 2), c(17.5, 5.5, 2), c(12, 18.5, 2), 'M6.5 7.5v1.5a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3V7.5M12 12v4.5'],
  'arrow-up': ['M12 19V5.5M6.5 11l5.5-5.5 5.5 5.5'],
  'arrow-down': ['M12 5v13.5M6.5 13l5.5 5.5 5.5-5.5'],
  flame: [
    'M12 21a6 6 0 0 0 6-6c0-4.2-3.3-6.3-4.5-10-2.5 1.8-3.2 4.3-3 6.3-1.2-.6-1.8-1.9-1.9-3.1C7 9.9 6 12.1 6 15a6 6 0 0 0 6 6z',
  ],
  comment: ['M4.5 5.5h15v10.5h-9L6 19.5V16H4.5z'],
  heart: ['M12 19.5s-7.5-4.5-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.5-7.5 10-7.5 10z'],
  repost: ['M7 16.5V8h11M15 5l3 3-3 3', 'M17 7.5V16H6M9 19l-3-3 3-3'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', c(12, 12, 3)],
  code: ['M8.5 7l-5 5 5 5M15.5 7l5 5-5 5'],
  book: ['M5 4.5h11.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z', 'M5 18a2 2 0 0 1 2-2h11.5'],
  paper: ['M7 3.5h7l5 5v12H7z', 'M14 3.5v5h5M10 12.5h6M10 16h6'],
  hn: ['M4.5 4.5h15v15h-15z', 'M8.5 8l3.5 5 3.5-5M12 13v3.5'],
  lab: ['M4 20.5V9.5l8-5 8 5v11', 'M9 20.5v-6h6v6', 'M2.5 20.5h19'],
  chat: ['M5 5.5h14v9.5h-7l-4.5 3.5V15H5z', 'M9 10h.01M12 10h.01M15 10h.01'],
  live: [
    `!${c(12, 12, 2.4)}`,
    'M7.6 16.4a6.2 6.2 0 0 1 0-8.8M16.4 7.6a6.2 6.2 0 0 1 0 8.8M4.8 19.2a10.2 10.2 0 0 1 0-14.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4',
  ],
  calendar: ['M4.5 6h15v14h-15z', 'M4.5 10h15M8.5 3.5v4M15.5 3.5v4'],
  clock: [c(12, 12, 8.5), 'M12 7.5V12l3 2'],
  filter: ['M4 5.5h16l-6.2 7.3V19l-3.6 1.5v-7.7z'],
  more: ['M5.5 12h.01M12 12h.01M18.5 12h.01'],
  'wifi-off': [
    'M3 3l18 18',
    'M8.5 16a5 5 0 0 1 6-.7M5.2 12.6a10 10 0 0 1 4-2.4M15.6 10.4a10 10 0 0 1 3.2 2.2M12 19.5v.1',
  ],
  refresh: ['M19.5 11A7.5 7.5 0 1 0 17.3 16.3', 'M19.5 4.5V11H13'],
  trash: ['M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5', 'M10 10.5v6M14 10.5v6'],
  key: [c(8, 15, 4), 'M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2'],
  lock: ['M6 10.5h12V20H6z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'],
  mail: ['M4 6h16v12.5H4z', 'M4.5 6.5l7.5 6 7.5-6'],
  today: [
    'M4.5 5h12v13.5a1.5 1.5 0 0 0 1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5z',
    'M16.5 9H19.5v9.5a1.5 1.5 0 0 1-3 0M7.5 8.5h6M7.5 12h6M7.5 15.5h4',
  ],
  archive: ['M4 5h16v4H4z', 'M5.5 9v10.5h13V9M10 13h4'],
  resonance: [c(6, 17, 2.4), c(12, 6.5, 2.4), c(18, 17, 2.4), 'M7.3 15l3.5-6.3M13.2 8.7l3.5 6.3M8.4 17h7.2'],
  sliders: ['M4 7h9M17 7h3M4 17h3M11 17h9', c(15, 7, 2), c(9, 17, 2)],
  bookmark: ['M6.5 4h11v16.5L12 16.5l-5.5 4z'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  grip: ['M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'],
  globe: [
    c(12, 12, 8.5),
    'M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z',
  ],
  scale: ['M12 4v16M6 20h12M4.5 8h15', 'M4.5 8L2.5 13a2.5 2.5 0 0 0 4 0zM19.5 8l-2 5a2.5 2.5 0 0 0 4 0z'],
  send: ['M4 12l16-7.5-5.5 15-3-6.5z', 'M11.5 13l8.5-8.5'],
  image: ['M4.5 5h15v14h-15z', c(9, 9.5, 1.6), 'M4.5 17l5-5 4 4 2.5-2.5 3.5 3.5'],
  history: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4 4v4h4M12 8v4l3 2'],
} satisfies Record<string, string[]>

/** Solid glyphs: brand marks and dots. */
const FILLED = {
  x_logo: ['M3.8 4h4.4l12 16h-4.4z', 'M18.5 4h1.8l-6.9 7.7-.9-1.2zM5.6 20H3.8l7-7.8.9 1.2z'],
  reddit: [
    'M12 7.5c3.9 0 7 2.2 7 5s-3.1 5-7 5-7-2.2-7-5 3.1-5 7-5zm-2.6 3.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm5.2 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-5 3.5c.8.6 1.6.8 2.4.8s1.6-.2 2.4-.8l-.5-.6c-.6.4-1.2.6-1.9.6s-1.3-.2-1.9-.6z',
    `${c(18.6, 9.3, 1.5)}${c(5.4, 9.3, 1.5)}${c(17, 4.6, 1.3)}`,
    'M12.3 7.6l1-4 3.4.8-.2.8-2.6-.6-.8 3.1z',
  ],
  dot: [c(12, 12, 4)],
} satisfies Record<string, string[]>

export type IconName = keyof typeof PATHS | keyof typeof FILLED

export interface IconProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, 'icon'> {
  name: IconName
  /** Pixel size (default 18). */
  size?: number
  /** Accessible name; omit for decorative icons. */
  title?: string
}

/** One inline SVG icon. */
export function Icon({ name, size = 18, title, class: cls, ...rest }: IconProps) {
  const filled = name in FILLED
  const paths = filled ? FILLED[name as keyof typeof FILLED] : PATHS[name as keyof typeof PATHS]
  const decorative = !title
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative icons are aria-hidden; titled ones render a <title> below
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      class={`icon${cls ? ` ${cls}` : ''}`}
      fill={filled ? 'currentColor' : 'none'}
      fill-rule={filled ? 'evenodd' : undefined}
      stroke={filled ? 'none' : 'currentColor'}
      stroke-width={1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {paths.map((d) =>
        // A leading '!' marks a solid shape inside a stroked icon (the half disc of 'contrast', the live dot).
        d.startsWith('!') ? <path key={d} d={d.slice(1)} fill="currentColor" stroke="none" /> : <path key={d} d={d} />,
      )}
    </svg>
  )
}

/** Every icon name, for docs and pickers. */
export const ICON_NAMES = [...Object.keys(PATHS), ...Object.keys(FILLED)] as IconName[]
