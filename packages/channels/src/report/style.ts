/**
 * The report's inline stylesheet — "Newsprint" (docs/VISUAL.md §9): the web app's paper palette (ink on warm stock,
 * one vermilion; a night edition in dark), serif headlines over system sans, and the site's ruled layout in compact
 * CSS. Light/dark via `prefers-color-scheme` plus an explicit `data-theme`; nothing floats, nothing glows (it must
 * print) and no external anything. Tokens are literal per mode (no `color-mix()` inside them, so a browser without it
 * still gets every surface).
 *
 * Token names are short because they ship in every file: `sf*` surface steps, `fg`/`fg2`/`mut` text steps, `mutw` =
 * text-3 that stays ≥ 4.5:1 on a field, `sig` the accent mark, `sigt` the accent as text, `edge`/`wedge` the hairline
 * round a control and a field, `s1..s8` signal colours, `c-*` categories, and a board's ink in `--c` (`.b-<board>`).
 */
import { BOARDS, CATEGORIES, LANGS } from '@resonance/schema'

const LIGHT =
  '--bg:#f6f3ec;--sf:#fbfaf6;--sf2:#f1ede4;--sf3:#e9e4d9;--well:#ece7dd;--line:rgb(40 32 20/.13);' +
  '--line2:rgb(40 32 20/.24);--fg:#1d1a16;--fg2:#4a443b;--mut:#6b6458;--mutw:#625b4f;--acc:#b42318;--sig:#b42318;' +
  '--sigt:#b42318;--up:#2f6b3a;--down:#b42318;--warn:#8a5a00;--res:#8a6200;' +
  '--repos:#2f6b3a;--papers:#6a4c93;--news:#a64a14;--social:#2b5c8a;--labs:#a8324a;' +
  '--c-release:#2f6b3a;--c-product:#1f6f78;--c-research:#6a4c93;--c-tool:#8a6200;--c-engineering:#2b5c8a;' +
  '--c-discussion:#6b6458;--c-industry:#a64a14;--c-policy:#b42318;' +
  '--s1:#2f4f7f;--s2:#3d7a4a;--s3:#b7861a;--s4:#a8324a;--s5:#2c7a86;--s6:#6a4c93;--s7:#7a7f2a;--s8:#8a8276;' +
  '--edge:inset 0 0 0 1px rgb(40 32 20/.24);--wedge:inset 0 0 0 1px rgb(40 32 20/.24);' +
  '--press:inset 0 0 0 1px #6b6458;--ring:0 0 0 2px #f6f3ec,0 0 0 4px #1d1a16'
const DARK =
  '--bg:#161513;--sf:#1f1e1b;--sf2:#262420;--sf3:#2e2b27;--well:#2a2824;--line:rgb(240 232 218/.11);' +
  '--line2:rgb(240 232 218/.2);--fg:#ece7de;--fg2:#c4bdb0;--mut:#9b9486;--mutw:#9b9486;--acc:#ff8a6b;--sig:#ff8a6b;' +
  '--sigt:#ff8a6b;--up:#86c08f;--down:#ff8a6b;--warn:#e0b55a;--res:#e0b55a;' +
  '--repos:#8cc497;--papers:#b9a0e0;--news:#f0a070;--social:#8fb5e0;--labs:#ee93a8;' +
  '--c-release:#8cc497;--c-product:#6fc0c8;--c-research:#b9a0e0;--c-tool:#e0b55a;--c-engineering:#8fb5e0;' +
  '--c-discussion:#b3ab9d;--c-industry:#f0a070;--c-policy:#ff8a6b;' +
  '--s1:#8fb0e0;--s2:#86c08f;--s3:#e0b55a;--s4:#e88aa0;--s5:#6fc0c8;--s6:#b9a0e0;--s7:#b8c06a;--s8:#a39b8e;' +
  '--edge:inset 0 0 0 1px rgb(240 232 218/.2);--wedge:inset 0 0 0 1px rgb(240 232 218/.2);' +
  '--press:inset 0 0 0 1px #9b9486;--ring:0 0 0 2px #161513,0 0 0 4px #ece7de'
const SANS =
  '-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI","PingFang SC",' +
  '"HarmonyOS Sans SC","MiSans","Microsoft YaHei UI","Noto Sans CJK SC",system-ui,sans-serif'
// Latin serif first, then a CJK serif where there is one; Windows falls back to YaHei rather than SimSun's faux bold.
const DISP =
  '"Iowan Old Style","Charter","Bitstream Charter","Sitka Text","Cambria","Georgia","Liberation Serif",' +
  '"Songti SC","Noto Serif CJK SC","Source Han Serif SC","Microsoft YaHei UI",serif'

// One rule per line; lines are trimmed and joined, which keeps the source readable and the output small.
// Dark is screen-only, so print always gets the light palette. Hit areas: controls look 30–36 px tall; a `::before` (or the track's padding) makes every target 44 px.
const RULES = `
:root{${LIGHT};--sans:${SANS};--disp:${DISP};color-scheme:light}
@media screen and (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK};color-scheme:dark}}
@media screen{:root[data-theme=dark]{${DARK};color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 1rem/1.6 var(--sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow-wrap:break-word}
a{color:var(--acc);text-underline-offset:.18em;text-decoration-color:color-mix(in srgb,currentColor 35%,transparent)}
:focus-visible{outline:2px solid transparent;box-shadow:var(--ring)}
a:focus-visible{border-radius:2px}
[hidden]{display:none!important}
.nojs .js{display:none!important}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:52rem;margin:0 auto;padding:0 16px}
.top{position:relative;padding:10px 0 4px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.brand{display:inline-flex;align-items:center;gap:8px;min-height:44px;color:var(--fg);font:700 1.0625rem/1 var(--disp);text-decoration:none}
.logo{flex:none;width:20px;height:20px;background:radial-gradient(circle at 50% 28%,var(--sig) 2.4px,transparent 2.9px),radial-gradient(circle at 28% 69%,var(--fg) 2.4px,transparent 2.9px),radial-gradient(circle at 72% 69%,var(--fg) 2.4px,transparent 2.9px)}
.ctl{display:flex;gap:10px;align-items:center}
.seg{display:inline-flex;gap:2px;padding:2px;border-radius:3px;background:var(--sf2);box-shadow:var(--wedge)}
.seg button,.tab,.chip,.tbtn{position:relative;appearance:none;border:0;margin:0;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;transition:color .16s,background-color .16s,box-shadow .16s}
.seg button::before,.tab::before,.chip::before,.tbtn::before{content:"";position:absolute;inset:-7px -1px}
.seg button{min-width:44px;height:30px;padding:0 12px;border-radius:2px;background:none;color:var(--fg2);font:500 .8125rem/1 var(--sans)}
.seg button[aria-pressed=true],.chip[aria-pressed=true]{background:var(--fg);box-shadow:none;color:var(--bg)}
.tbtn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px;border-radius:3px;background:var(--sf);box-shadow:var(--edge);color:var(--fg);font:500 .8125rem/1 var(--sans)}
.tbtn::before{inset:-5px -1px}
.ic{width:12px;height:12px;border:1.5px solid currentColor;border-radius:50%;background:linear-gradient(90deg,currentColor 50%,transparent 50%)}
.tbtn:active,.chip:active{box-shadow:var(--press)}
.seg button:focus-visible,.tab:focus-visible,.chip:focus-visible,.tbtn:focus-visible{box-shadow:var(--ring)}
@media (hover:hover){.seg button:hover,.tab:hover{color:var(--fg)}.chip:not([aria-pressed=true]):hover{color:var(--fg);box-shadow:inset 0 0 0 1px var(--mut)}.tbtn:hover{background:var(--sf2);box-shadow:inset 0 0 0 1px var(--mut)}}
.kick{margin:34px 0 0;font:700 .8125rem/1.25 var(--sans);color:var(--sigt)}
h1{margin:6px 0 0;padding-bottom:14px;border-bottom:2px solid var(--fg);font:700 clamp(2.25rem,1.3rem + 3.2vw,3.5rem)/1.08 var(--disp);letter-spacing:-.015em;font-variant-numeric:lining-nums}
.win{margin:8px 0 0;color:var(--mut);font-size:.8125rem;line-height:1.6}
.win time{font:500 .8125rem/1 var(--sans);font-variant-numeric:tabular-nums;color:var(--fg2)}
.pre{display:flex;gap:10px;align-items:baseline;margin:18px 0 0;padding:10px 14px;border-radius:2px;background:var(--sf2);box-shadow:inset 3px 0 0 var(--warn);color:var(--fg2);font-size:.875rem;line-height:1.5}
.pre::before{content:"";flex:none;width:7px;height:7px;background:var(--warn);transform:translateY(-1px)}
.tools{position:sticky;top:0;z-index:5;margin-top:24px;background:var(--bg);box-shadow:0 1px 0 var(--line2)}
.tools>.wrap{padding-top:6px}
.tabs{display:flex;gap:0;overflow-x:auto;scrollbar-width:none;box-shadow:inset 0 -1px 0 var(--line)}
.tabs::-webkit-scrollbar,.chips::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:42px;padding:0 14px;border-radius:0;background:none;color:var(--fg2);font:700 .9375rem/1 var(--disp)}
.tab:first-child{padding-left:0}
.tab::before{inset:-1px 0}
.tab[aria-selected=true]{color:var(--fg);box-shadow:inset 0 -2px 0 var(--sig)}
.tab:first-child[aria-selected=true]{box-shadow:none;background:linear-gradient(var(--sig),var(--sig)) 0 100%/calc(100% - 14px) 2px no-repeat}
.tab small,.chip small{font:500 .6875rem/1 var(--sans);font-variant-numeric:tabular-nums;color:var(--mutw)}
.chip[aria-pressed=true] small{color:inherit;opacity:.75}
.row2{display:flex;gap:12px;align-items:center;padding:2px 0 4px}
.chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:1 1 auto;min-width:0;padding:7px 24px 7px 2px;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent)}
.chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:3px;background:none;box-shadow:inset 0 0 0 1px var(--line2);color:var(--fg2);font:500 .75rem/1 var(--sans)}
.q{flex:0 1 14rem;min-width:7.5rem;height:38px;padding:0 12px;border:0;border-radius:3px;background:var(--sf);box-shadow:var(--wedge);color:var(--fg);font:400 .875rem/1 var(--sans)}
.q::placeholder{color:var(--mutw);opacity:1}
.q:focus{outline:2px solid transparent;box-shadow:inset 0 0 0 1px var(--fg),var(--ring)}
@media (pointer:coarse){.q{height:44px}}
main{padding-bottom:40px}
.sec{margin-top:36px}
.sec>header{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px}
h2{margin:0;font:700 1.375rem/1.25 var(--disp)}
.sub{color:var(--mut);font-size:.8125rem}
.brief{position:relative;margin-top:32px;padding:0 0 22px;border-bottom:3px double var(--fg)}
.brief h2{font:700 .8125rem/1.25 var(--sans);color:var(--sigt)}
.brief .hl{margin:8px 0 12px;font:700 1.625rem/1.25 var(--disp);text-wrap:balance}
.brief ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.brief li{position:relative;padding-left:18px;font-size:.9375rem;line-height:1.7}
.brief li::before{content:"";position:absolute;left:2px;top:.72em;width:5px;height:5px;background:var(--fg)}
.cite{display:inline;margin:0 1px;color:var(--mut);font:500 .8125rem/1 var(--sans);text-decoration:none;white-space:nowrap}
@media (hover:hover){.cite:hover{color:var(--fg);text-decoration:underline}}
.cl{display:grid;gap:14px;margin:14px 0 0;padding:0;list-style:none}
.cl>li:only-child{grid-column:1/-1}
.cl>li{min-width:0;padding:12px 16px 8px;box-shadow:inset 0 2px 0 var(--fg),inset 0 0 0 1px var(--line)}
.rt{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:16px}
.hs{display:flex;gap:4px}
.hs>span{width:14px;height:2px;background:var(--c)}
.st{color:var(--mut);font:500 .75rem/1 var(--sans);font-variant-numeric:tabular-nums}
.clh{margin:8px 0 6px;font:700 1rem/1.35 var(--disp)}
.mem{margin:0;padding:0;list-style:none;font-size:.8125rem;line-height:1.45}
.mem>li{display:flex;align-items:baseline;gap:8px;padding:8px 0;border-top:1px solid var(--line)}
.mem .dot{transform:translateY(-1px)}
.mt{flex:1 1 auto;min-width:0;color:var(--fg2)}
.mt a{color:inherit;text-decoration:none}
@media (hover:hover){.mt a:hover{color:var(--fg);text-decoration:underline;text-decoration-color:var(--line2)}}
.mem .sub{flex:none;font-size:.75rem;font-variant-numeric:tabular-nums}
.dot{flex:none;display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c,var(--mut))}
.sec[data-board]{margin-top:40px;padding-bottom:4px}
.sec[data-board]>header{align-items:baseline;gap:2px 10px;padding:0 0 8px;border-bottom:2px solid var(--fg)}
.sec[data-board] h2{font-size:1.375rem}
.n{color:var(--mutw);font:500 .75rem/1 var(--sans);font-variant-numeric:tabular-nums}
.sec[data-board] .sub{flex-basis:100%}
.card{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:14px;padding:18px 0 14px;scroll-margin-top:136px}
.card::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:var(--line)}
.sec[data-board]>header+.card::before{display:none}
.card:target{background:var(--sf2);box-shadow:inset 3px 0 0 var(--sig)}
.rk{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.rn{display:block;font:700 1.75rem/1 var(--disp);font-variant-numeric:tabular-nums lining-nums;color:var(--fg2)}
.rn.p{color:var(--sigt)}
.bdg{display:inline-block;color:var(--fg2);font:700 .6875rem/1.1 var(--sans);white-space:nowrap}
.bdg.new{color:var(--sigt)}
.bdg.up{color:var(--up)}
.bdg.down{color:var(--down)}
.bdg.back{color:var(--res)}
.ti{margin:0;font:700 1.125rem/1.35 var(--disp);text-wrap:pretty}
.ti a{color:var(--fg);text-decoration:none}
.ti a:hover{text-decoration:underline;text-decoration-color:var(--line2)}
.bl{margin:6px 0 0;color:var(--fg2);font-size:.9375rem;line-height:1.6}
.bl:lang(zh){line-height:1.7}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:10px 0 0;color:var(--mut);font:500 .8125rem/1.35 var(--sans);font-variant-numeric:tabular-nums}
.meta a{color:inherit;text-decoration-color:var(--line2)}
.cm{position:relative;display:inline-block;width:12px;height:9px;margin-right:5px;border:1.25px solid currentColor;border-radius:2px;vertical-align:-.5px}
.cm::after{content:"";position:absolute;left:1.5px;top:100%;border-style:solid;border-width:3.5px 3.5px 0 0;border-color:currentColor transparent transparent}
.cat{display:inline-flex;align-items:center;color:var(--fg2);font:700 .6875rem/1 var(--sans)}
.sc{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-top:12px;color:var(--mut);font-size:.75rem}
.sb{display:flex;flex:1 1 auto;max-width:13rem;min-width:5rem;height:3px;margin-right:4px;background:var(--line)}
.sb i{height:100%;background:var(--fg2)}
.sb i+i{border-left:1px solid var(--bg)}
.tot{color:var(--fg);font:600 .875rem/1 var(--sans);font-variant-numeric:tabular-nums}
.res{display:inline-flex;align-items:center;gap:4px;margin-left:6px;color:var(--res);font-weight:600;white-space:nowrap}
.res .dot{width:6px;height:6px}
.res .dot:last-of-type{margin-right:3px}
details{margin-top:6px}
summary{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin:-6px 0;color:var(--acc);font:600 .8125rem/1 var(--sans);list-style:none;cursor:pointer}
summary::-webkit-details-marker{display:none}
summary::after{content:"";width:6px;height:6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:translateY(-2px) rotate(45deg);transition:transform .24s cubic-bezier(.32,.72,0,1)}
details[open]>summary::after{transform:translateY(1px) rotate(-135deg)}
.dx{margin:6px 0 4px;padding:2px 16px 14px;border-radius:2px;background:var(--sf2);color:var(--fg2);font-size:.875rem;line-height:1.55}
.dx h4{margin:14px 0 6px;color:var(--fg);font:700 .875rem/1.3 var(--disp)}
.dx p{margin:4px 0}
.dx ul{margin:0;padding-left:1.1em}
.dx li{margin:3px 0}
.dx li::marker{color:var(--mut)}
.dx li[class*=b-]{list-style:none;margin-left:-1.1em}
.dx li .dot{margin-right:8px;transform:translateY(-1px)}
.bk{width:100%;border-collapse:collapse;border-top:1px solid var(--fg);font-size:.8125rem;font-variant-numeric:tabular-nums}
.bk th,.bk td{padding:7px 0 7px 12px;border-bottom:1px solid var(--line);text-align:right;vertical-align:baseline}
.bk td:not(:first-child){font-size:.75rem}
.bk th:first-child,.bk td:first-child{padding-left:0;text-align:left}
.bk tbody td:first-child::before{content:"";display:inline-block;width:8px;height:8px;margin-right:9px;background:var(--sg,var(--mut));vertical-align:0}
.bk thead th{color:var(--mut);font:600 .6875rem/1.2 var(--sans)}
.bk tfoot td{border-bottom:0;color:var(--fg);font-weight:600}
.via{display:block;color:var(--mut);font:400 .75rem/1.3 var(--sans);letter-spacing:0}
.us{margin-top:12px;padding-left:12px;border-left:3px solid var(--line2)}
.us .via{margin-top:6px}
.empty{margin:0;padding:6px 0 20px;color:var(--mut);font-size:.875rem}
.nomatch{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0;padding:40px 0 8px;color:var(--mut)}
.foot{margin-top:16px;padding:18px 0 48px;border-top:2px solid var(--fg);color:var(--mut);font-size:.8125rem}
.foot a{color:var(--fg2);text-decoration-color:var(--line2)}
@media (min-width:720px){.wrap{padding:0 24px}.cl{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.top{padding-top:6px}.kick{margin-top:22px}.card{grid-template-columns:36px minmax(0,1fr);column-gap:12px;padding:16px 0 12px}.dx{margin-left:-48px;padding:2px 14px 12px}.bk th,.bk td{padding-left:8px}.q{flex:0 0 9.5rem;min-width:0}.rn{font-size:1.5rem}.ti{font-size:1.0625rem}.bl{font-size:.9063rem}.tab{padding:0 12px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
${BOARDS.map((b) => `.b-${b}{--c:var(--${b})}`).join('\n')}
${CATEGORIES.map((c) => `[data-cat=${c}]{--ct:var(--c-${c})}`).join('\n')}
${LANGS.map((l) => `html[lang=${l}] [data-l]:not([data-l=${l}]){display:none}`).join('\n')}
@media print{:root{--sf2:#fff;--edge:0 0 0 1px #d2cdc2;color-scheme:light}@page{margin:14mm}body{background:#fff;font-size:10.5pt}.tools,.ctl,.js,summary,.nomatch{display:none!important}.kick{margin-top:0}.brief,.cl>li,.card{break-inside:avoid}.sec>header{break-after:avoid}.sb,.sb i,.dot,.hs>span,.brief li::before,.bk td:first-child::before{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit}.ti a::after{content:" " attr(href);font-weight:400;font-size:8pt;color:#555;word-break:break-all}}
`

/** The minified stylesheet. */
export const STYLE = RULES.split('\n')
  .map((line) => line.trim())
  .join('')
