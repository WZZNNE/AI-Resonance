/**
 * The report's inline stylesheet — "Titanium × Signal" (docs/VISUAL.md §9): the web app's palette, system fonts and
 * plate/well materials in compact CSS. Light/dark via `prefers-color-scheme` plus an explicit `data-theme`; no glass
 * (it must print) and no external anything. Material recipes are literal per mode (no `color-mix()` inside tokens, so
 * a browser without it still gets every surface); `color-mix()` only tints optional halos.
 *
 * Token names are short because they ship in every file: `sf*` surface steps, `fg`/`fg2`/`mut` text steps, `mutw` =
 * text-3 that stays ≥ 4.5:1 on a well, `sig` the signal light, `sigt` the signal as text, `edge`/`e0..2`/`wedge` plate
 * edge, elevations and well edge, `s1..s8` signal colours, `c-*` categories, and a board's hue in `--c` (`.b-<board>`).
 */
import { BOARDS, CATEGORIES, LANGS } from '@resonance/schema'

const LIGHT =
  '--bg:#f5f5f7;--sf:#fff;--sf2:#fbfbfd;--sf3:#f2f2f6;--well:#ebebf0;--line:rgb(0 0 0/.08);--line2:rgb(0 0 0/.14);' +
  '--fg:#1d1d1f;--fg2:#424245;--mut:#6e6e73;--mutw:#636366;--acc:#006bd6;--sig:#0a84ff;--sig2:#8944ab;--sigt:#1d6fcd;' +
  '--up:#1f7a37;--down:#d70015;--warn:#b25000;--res:#a05a00;' +
  '--repos:#248a3d;--papers:#8944ab;--news:#c93400;--social:#0066cc;--labs:#d30f45;' +
  '--c-release:#248a3d;--c-product:#0071a4;--c-research:#8944ab;--c-tool:#a05a00;--c-engineering:#0066cc;' +
  '--c-discussion:#6c6c70;--c-industry:#c93400;--c-policy:#d70015;' +
  '--s1:#5856d6;--s2:#34c759;--s3:#ffcc00;--s4:#ff2d55;--s5:#32ade6;--s6:#af52de;--s7:#a2845e;--s8:#8e8e93;' +
  '--plate:linear-gradient(180deg,#fff,#fcfcfd);--edge:inset 0 1px 0 #fff,inset 0 0 0 1px rgb(0 0 0/.06);' +
  '--e0:0 1px 1px rgb(0 0 0/.05);--e1:0 1px 2px rgb(0 0 0/.04),0 8px 24px -10px rgb(0 0 0/.1);' +
  '--e2:0 2px 6px rgb(0 0 0/.06),0 18px 40px -16px rgb(0 0 0/.16);' +
  '--wedge:inset 0 1px 2px rgb(0 0 0/.08),inset 0 0 0 1px rgb(0 0 0/.06),0 1px 0 #fff;' +
  '--press:inset 0 2px 5px rgb(0 0 0/.12),inset 0 0 0 1px rgb(0 0 0/.08);--thumb:#fff;--hl:rgb(255 255 255/.3);' +
  '--bloom:0%;--halo:14%;--ring:0 0 0 1px #0a84ff,0 0 0 4px rgb(10 132 255/.22);--dots:rgb(0 0 0/.035);--spill:none'
const DARK =
  '--bg:#07080b;--sf:#111318;--sf2:#171a21;--sf3:#1e222b;--well:#050608;--line:rgb(255 255 255/.07);' +
  '--line2:rgb(255 255 255/.12);--fg:#f2f3f5;--fg2:#aeb4bf;--mut:#868d9a;--mutw:#868d9a;--acc:#0a84ff;--sig:#64d2ff;' +
  '--sig2:#bf5af2;--sigt:#86d9fe;--up:#30d158;--down:#ff453a;--warn:#ffd60a;--res:#ffd60a;' +
  '--repos:#30d158;--papers:#bf5af2;--news:#ff9f0a;--social:#0a84ff;--labs:#ff375f;' +
  '--c-release:#30d158;--c-product:#64d2ff;--c-research:#bf5af2;--c-tool:#ffd60a;--c-engineering:#0a84ff;' +
  '--c-discussion:#98989d;--c-industry:#ff9f0a;--c-policy:#ff453a;' +
  '--s1:#5e5ce6;--s2:#30d158;--s3:#ffd60a;--s4:#ff375f;--s5:#64d2ff;--s6:#bf5af2;--s7:#ac8e68;--s8:#8e8e93;' +
  '--plate:linear-gradient(180deg,#1c1e23 0%,#111318 42%);' +
  '--edge:inset 0 1px 0 rgb(255 255 255/.07),inset 0 0 0 1px rgb(255 255 255/.045);--e0:0 1px 1px rgb(0 0 0/.3);' +
  '--e1:0 1px 1px rgb(0 0 0/.35),0 10px 28px -14px rgb(0 0 0/.65);' +
  '--e2:0 2px 4px rgb(0 0 0/.4),0 22px 44px -18px rgb(0 0 0/.75);' +
  '--wedge:inset 0 1px 2px rgb(0 0 0/.55),inset 0 0 0 1px rgb(0 0 0/.45),0 1px 0 rgb(255 255 255/.05);' +
  '--press:inset 0 2px 5px rgb(0 0 0/.5),inset 0 0 0 1px rgb(0 0 0/.4);--thumb:#2c3038;--hl:rgb(255 255 255/.22);' +
  '--bloom:45%;--halo:0%;--ring:0 0 0 1px rgb(100 210 255/.55),0 0 16px -2px rgb(100 210 255/.45);' +
  '--dots:rgb(255 255 255/.035);--spill:radial-gradient(1200px 520px at 50% -260px,rgb(100 210 255/.07),transparent 70%)'
const SANS =
  '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI","PingFang SC",' +
  '"HarmonyOS Sans SC","MiSans","Microsoft YaHei UI","Noto Sans CJK SC",system-ui,sans-serif'
const DISP =
  '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI Variable Display","Segoe UI","PingFang SC",' +
  '"HarmonyOS Sans SC","MiSans","Microsoft YaHei UI","Noto Sans CJK SC",system-ui,sans-serif'
const MONO = '"SF Mono",ui-monospace,"Cascadia Mono","JetBrains Mono",Menlo,Consolas,monospace'
/** A hue dot's light: bloom in dark, a soft ring in light (`--bloom` / `--halo` switch per mode). */
const HALO = (v: string, blur = 6) =>
  `0 0 ${blur}px color-mix(in srgb,var(${v}) var(--bloom),transparent),` +
  `0 0 0 3px color-mix(in srgb,var(${v}) var(--halo),transparent)`

// One rule per line; lines are trimmed and joined, which keeps the source readable and the output small.
// Dark is screen-only, so print always gets the light palette. Hit areas: controls look 30–36 px tall; a `::before` (or the track's padding) makes every target 44 px.
const RULES = `
:root{${LIGHT};--sans:${SANS};--disp:${DISP};--mono:${MONO};color-scheme:light}
@media screen and (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK};color-scheme:dark}}
@media screen{:root[data-theme=dark]{${DARK};color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 1rem/1.55 var(--sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow-wrap:break-word}
a{color:var(--acc);text-underline-offset:.18em;text-decoration-color:color-mix(in srgb,currentColor 35%,transparent)}
:focus-visible{outline:2px solid transparent;box-shadow:var(--ring)}
a:focus-visible{border-radius:4px}
[hidden]{display:none!important}
.nojs .js{display:none!important}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:52rem;margin:0 auto;padding:0 16px}
.top{position:relative;isolation:isolate;padding:10px 0 4px}
.top::before{content:"";position:absolute;z-index:-1;inset:0;background:var(--spill),radial-gradient(var(--dots) 1px,transparent 1.3px) 50% 0/24px 24px;-webkit-mask-image:linear-gradient(#000 30%,transparent);mask-image:linear-gradient(#000 30%,transparent);pointer-events:none}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.brand{display:inline-flex;align-items:center;gap:8px;min-height:44px;color:var(--fg);font:600 .9375rem/1 var(--disp);letter-spacing:-.012em;text-decoration:none}
.logo{flex:none;width:20px;height:20px;background:radial-gradient(circle at 50% 28%,var(--papers) 2.4px,transparent 2.9px),radial-gradient(circle at 28% 69%,var(--repos) 2.4px,transparent 2.9px),radial-gradient(circle at 72% 69%,var(--news) 2.4px,transparent 2.9px)}
.ctl{display:flex;gap:10px;align-items:center}
.seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--well);box-shadow:var(--wedge)}
.seg button,.tab,.chip,.tbtn{position:relative;appearance:none;border:0;margin:0;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;transition:color .16s,background-color .16s,box-shadow .16s,transform .16s cubic-bezier(.32,.72,0,1)}
.seg button::before,.tab::before,.chip::before,.tbtn::before{content:"";position:absolute;inset:-7px -1px}
.seg button{min-width:44px;height:30px;padding:0 12px;border-radius:999px;background:none;color:var(--fg2);font:500 .8125rem/1 var(--sans)}
.seg button[aria-pressed=true],.tab[aria-selected=true],.chip[aria-pressed=true]{background:var(--thumb);box-shadow:var(--edge),var(--e1);color:var(--fg)}
.tbtn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:999px;background:var(--plate);box-shadow:var(--edge),var(--e1);color:var(--fg);font:500 .8125rem/1 var(--sans)}
.tbtn::before{inset:-4px -1px}
.ic{width:12px;height:12px;border:1.5px solid currentColor;border-radius:50%;background:linear-gradient(90deg,currentColor 50%,transparent 50%)}
.tbtn:active,.chip:active{box-shadow:var(--press);transform:scale(.98)}
.seg button:focus-visible,.tab:focus-visible,.chip:focus-visible{box-shadow:var(--ring)}
.seg button[aria-pressed=true]:focus-visible,.tab[aria-selected=true]:focus-visible,.chip[aria-pressed=true]:focus-visible,.tbtn:focus-visible{box-shadow:var(--edge),var(--e1),var(--ring)}
@media (hover:hover){.seg button:hover,.tab:hover,.chip:hover{color:var(--fg)}.tbtn:hover{transform:translateY(-1px);box-shadow:var(--edge),var(--e2)}}
.kick{margin:34px 0 0;font:600 .75rem/1.2 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
h1{margin:8px 0 14px;font:700 clamp(2.25rem,1.3rem + 3.2vw,3.75rem)/1.05 var(--disp);letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.win{margin:2px 0 0;color:var(--mut);font-size:.8125rem;line-height:1.6}
.win time{font:400 .75rem/1 var(--mono);letter-spacing:-.02em;color:var(--fg2)}
.pre{display:flex;gap:10px;align-items:baseline;margin:18px 0 0;padding:11px 16px;border-radius:12px;background:var(--plate);box-shadow:var(--edge),var(--e1);color:var(--fg2);font-size:.875rem;line-height:1.5}
.pre::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:var(--warn);box-shadow:${HALO('--warn')};transform:translateY(-1px)}
.tools{position:sticky;top:0;z-index:5;margin-top:24px;background:var(--bg);box-shadow:0 1px 0 var(--line)}
.tools>.wrap{padding-top:10px}
.tabs{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;padding:4px;border-radius:999px;background:var(--well);box-shadow:var(--wedge)}
.tabs::-webkit-scrollbar,.chips::-webkit-scrollbar{display:none}
.tab{flex:1 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 15px;border-radius:999px;background:none;color:var(--fg2);font:500 .8125rem/1 var(--sans)}
.tab::before{inset:-4px -1px}
.tab[class*=b-]::after{content:"";order:-1;width:7px;height:7px;border-radius:50%;background:var(--c)}
.tab[aria-selected=true]{background:linear-gradient(var(--sig),var(--sig)) 50% calc(100% - 3px)/14px 2px no-repeat,var(--thumb)}
.tab small,.chip small{font:500 .6875rem/1 var(--mono);letter-spacing:-.02em;color:var(--mutw)}
.tab[aria-selected=true] small,.chip[aria-pressed=true] small{color:var(--fg2)}
.row2{display:flex;gap:12px;align-items:center;padding:2px 0 4px}
.chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:1 1 auto;min-width:0;padding:7px 24px 7px 2px;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent)}
.chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;background:var(--sf3);box-shadow:var(--edge),var(--e0);color:var(--fg2);font:500 .75rem/1 var(--sans)}
.chip:not([data-cat=""])::after{content:"";order:-1;width:7px;height:7px;border-radius:50%;background:var(--ct)}
.q{flex:0 1 14rem;min-width:7.5rem;height:40px;padding:0 14px;border:0;border-radius:12px;background:var(--well);box-shadow:var(--wedge);color:var(--fg);font:400 .875rem/1 var(--sans)}
.q::placeholder{color:var(--mutw);opacity:1}
.q:focus{outline:2px solid transparent;box-shadow:var(--wedge),var(--ring)}
@media (pointer:coarse){.q{height:44px}}
main{padding-bottom:40px}
.sec{margin-top:36px}
.sec>header{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px}
h2{margin:0;font:650 1.375rem/1.25 var(--disp);letter-spacing:-.02em}
.sub{color:var(--mut);font-size:.8125rem}
.brief{position:relative;margin-top:32px;padding:20px 24px 20px 26px;border-radius:18px;background:var(--plate);box-shadow:var(--edge),var(--e1)}
.brief::before{content:"";position:absolute;left:0;top:18px;bottom:18px;width:2px;border-radius:0 2px 2px 0;background:linear-gradient(180deg,var(--sig),var(--sig2))}
.brief h2{font:600 .75rem/1.2 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--sigt)}
.brief .hl{margin:10px 0 12px;font:650 1.375rem/1.3 var(--disp);letter-spacing:-.02em;text-wrap:balance}
.brief ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.brief li{position:relative;padding-left:18px;font-size:.9375rem;line-height:1.65}
.brief li::before{content:"";position:absolute;left:3px;top:.72em;width:5px;height:5px;border-radius:50%;background:var(--mut)}
.cite{display:inline-flex;align-items:center;gap:5px;height:22px;margin:0 2px;padding:0 8px;border-radius:999px;background:var(--sf3);box-shadow:var(--edge),var(--e0);color:var(--fg2);font:500 .6875rem/1 var(--sans);text-decoration:none;white-space:nowrap;vertical-align:1px}
.cite::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c,var(--mut))}
@media (hover:hover){.cite:hover{color:var(--fg)}}
.cl{display:grid;gap:12px;margin:14px 0 0;padding:0;list-style:none}
.cl>li:only-child{grid-column:1/-1}
.cl>li{min-width:0;padding:14px 18px 8px;border-radius:18px;background:var(--plate);box-shadow:var(--edge),var(--e1)}
.rt{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:16px}
.hs{display:flex;gap:4px}
.hs>span{width:14px;height:2px;border-radius:1px;background:var(--c);box-shadow:0 0 6px -1px color-mix(in srgb,var(--c) var(--bloom),transparent)}
.st{color:var(--mut);font:500 .75rem/1 var(--sans)}
.clh{margin:8px 0 6px;font:600 .9375rem/1.35 var(--disp);letter-spacing:-.01em}
.mem{margin:0;padding:0;list-style:none;font-size:.8125rem;line-height:1.45}
.mem>li{display:flex;align-items:baseline;gap:8px;padding:8px 0;border-top:1px solid var(--line)}
.mem .dot{transform:translateY(-1px)}
.mt{flex:1 1 auto;min-width:0;color:var(--fg2)}
.mt a{color:inherit;text-decoration:none}
@media (hover:hover){.mt a:hover{color:var(--fg);text-decoration:underline;text-decoration-color:var(--line2)}}
.mem .sub{flex:none;font-size:.75rem;font-variant-numeric:tabular-nums}
.dot{flex:none;display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c,var(--mut));box-shadow:${HALO('--c')}}
.sec[data-board]{margin-top:20px;padding-bottom:4px;border-radius:22px;background:var(--plate);box-shadow:var(--edge),var(--e1)}
.sec[data-board]>header{align-items:center;gap:2px 10px;padding:20px 24px 14px}
.sec[data-board]>header::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:${HALO('--c')}}
.sec[data-board] h2{font-size:1.25rem}
.n{min-width:24px;padding:4px 7px;border-radius:999px;background:var(--well);box-shadow:var(--wedge);color:var(--mutw);font:500 .6875rem/1 var(--mono);text-align:center;transform:translateY(-1px)}
.sec[data-board] .sub{flex-basis:100%;padding-left:18px}
.card{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:14px;padding:18px 24px 14px 20px;scroll-margin-top:136px}
.card::before{content:"";position:absolute;top:0;left:78px;right:0;height:1px;background:var(--line)}
.card:target{background:var(--sf2);box-shadow:inset 2px 0 0 var(--sig)}
.rk{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.rn{display:block;font:200 2.125rem/.86 var(--disp);letter-spacing:-.04em;font-variant-numeric:tabular-nums lining-nums;color:var(--mut)}
.rn.p{color:var(--fg);background:linear-gradient(180deg,var(--fg) 10%,var(--mut) 95%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.bdg{display:inline-block;padding:3px 6px;border-radius:999px;background:var(--sf3);color:var(--fg2);font:600 .625rem/1 var(--sans);letter-spacing:.04em;white-space:nowrap}
.bdg.new,.bdg.up,.bdg.down,.bdg.back{background:color-mix(in srgb,currentColor 12%,transparent)}
.bdg.new{color:var(--sigt)}
.bdg.up{color:var(--up)}
.bdg.down{color:var(--down)}
.bdg.back{color:var(--res)}
.ti{margin:0;font:600 1.0625rem/1.35 var(--disp);letter-spacing:-.01em;text-wrap:pretty}
.ti a{color:var(--fg);text-decoration:none}
.ti a:hover{text-decoration:underline;text-decoration-color:var(--line2)}
.bl{margin:6px 0 0;color:var(--fg2);font-size:.9375rem;line-height:1.55}
.bl:lang(zh){line-height:1.65}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:10px 0 0;color:var(--mut);font:500 .8125rem/1.35 var(--sans);font-variant-numeric:tabular-nums}
.meta a{color:inherit;text-decoration-color:var(--line2)}
.cm{position:relative;display:inline-block;width:12px;height:9px;margin-right:5px;border:1.25px solid currentColor;border-radius:3px;vertical-align:-.5px}
.cm::after{content:"";position:absolute;left:1.5px;top:100%;border-style:solid;border-width:3.5px 3.5px 0 0;border-color:currentColor transparent transparent}
.cat{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;background:var(--sf3);box-shadow:var(--edge),var(--e0);color:var(--fg2);font:500 .6875rem/1 var(--sans)}
.cat::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ct,var(--mut))}
.sc{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-top:12px;color:var(--mut);font-size:.75rem}
.sb{display:flex;flex:1 1 auto;max-width:13rem;min-width:5rem;height:6px;margin-right:4px;border-radius:3px;background:var(--well);box-shadow:var(--wedge)}
.sb i{height:100%;background:linear-gradient(180deg,var(--hl),var(--hl) 1px,transparent 1px),var(--sg,var(--c));box-shadow:0 0 6px -1px color-mix(in srgb,var(--sg,var(--c)) var(--bloom),transparent)}
.sb i+i{border-left:1px solid var(--well)}
.sb i:first-child{border-radius:3px 0 0 3px}
.sb i:last-child{border-top-right-radius:3px;border-bottom-right-radius:3px}
.tot{color:var(--fg);font:600 .875rem/1 var(--mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.res{display:inline-flex;align-items:center;gap:4px;margin-left:6px;white-space:nowrap}
.res .dot{width:6px;height:6px}
.res .dot:last-of-type{margin-right:3px}
details{margin-top:6px}
summary{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin:-6px 0;color:var(--acc);font:600 .8125rem/1 var(--sans);list-style:none;cursor:pointer}
summary::-webkit-details-marker{display:none}
summary::after{content:"";width:6px;height:6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:translateY(-2px) rotate(45deg);transition:transform .24s cubic-bezier(.32,.72,0,1)}
details[open]>summary::after{transform:translateY(1px) rotate(-135deg)}
.dx{margin:6px 0 4px;padding:2px 18px 14px;border-radius:14px;background:var(--sf2);box-shadow:var(--edge);color:var(--fg2);font-size:.875rem;line-height:1.55}
.dx h4{margin:14px 0 6px;color:var(--mut);font:600 .6875rem/1.2 var(--sans);letter-spacing:.06em;text-transform:uppercase}
.dx p{margin:4px 0}
.dx ul{margin:0;padding-left:1.1em}
.dx li{margin:3px 0}
.dx li::marker{color:var(--mut)}
.dx li[class*=b-]{list-style:none;margin-left:-1.1em}
.dx li .dot{margin-right:8px;transform:translateY(-1px)}
.bk{width:100%;border-collapse:collapse;font-size:.8125rem;font-variant-numeric:tabular-nums}
.bk th,.bk td{padding:7px 0 7px 12px;border-bottom:1px solid var(--line);text-align:right;vertical-align:baseline}
.bk td:not(:first-child){font-family:var(--mono);font-size:.75rem;letter-spacing:-.02em}
.bk th:first-child,.bk td:first-child{padding-left:0;text-align:left}
.bk tbody td:first-child::before{content:"";display:inline-block;width:8px;height:8px;margin-right:9px;border-radius:50%;background:var(--sg,var(--mut));box-shadow:${HALO('--sg')};vertical-align:0}
.bk thead th{color:var(--mut);font:500 .6875rem/1.2 var(--sans)}
.bk tfoot td{border-bottom:0;color:var(--fg);font-weight:600}
.via{display:block;color:var(--mut);font:400 .75rem/1.3 var(--sans);letter-spacing:0}
.us{margin-top:12px;padding-left:12px;border-left:2px solid var(--line2)}
.us .via{margin-top:6px}
.empty{margin:0;padding:6px 24px 20px;color:var(--mut);font-size:.875rem}
.nomatch{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0;padding:40px 0 8px;color:var(--mut)}
.foot{margin-top:8px;padding:20px 0 48px;border-top:1px solid var(--line);color:var(--mut);font-size:.8125rem}
.foot a{color:var(--fg2);text-decoration-color:var(--line2)}
@media (min-width:720px){.wrap{padding:0 24px}.cl{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.top{padding-top:6px}.kick{margin-top:22px}.brief{padding:18px 18px 18px 20px}.sec[data-board]{border-radius:20px}.sec[data-board]>header{padding:18px 16px 12px}.card{grid-template-columns:36px minmax(0,1fr);column-gap:12px;padding:16px 16px 12px 14px}.card::before{left:62px}.dx{margin-left:-48px;padding:2px 14px 12px}.bk th,.bk td{padding-left:8px}.q{flex:0 0 9.5rem;min-width:0}.rn{font-size:1.875rem}.ti{font-size:1rem}.bl{font-size:.9063rem}.tab{padding:0 13px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
${BOARDS.map((b) => `.b-${b}{--c:var(--${b})}`).join('\n')}
${CATEGORIES.map((c) => `[data-cat=${c}]{--ct:var(--c-${c})}`).join('\n')}
${LANGS.map((l) => `html[lang=${l}] [data-l]:not([data-l=${l}]){display:none}`).join('\n')}
@media print{:root{--plate:#fff;--sf2:#fff;--e0:0 0 #0000;--e1:0 0 #0000;--edge:0 0 0 1px #d2d2d7;color-scheme:light}@page{margin:14mm}body{background:#fff;font-size:10.5pt}.top::before,.tools,.ctl,.js,summary,.nomatch{display:none!important}.kick{margin-top:0}.brief,.cl>li,.card{break-inside:avoid}.sec>header{break-after:avoid}.rn.p{background:none;-webkit-text-fill-color:currentColor}.sb,.sb i,.dot,.cat::before,.hs>span,.brief::before,.bk td:first-child::before,.sec[data-board]>header::before{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit}.ti a::after{content:" " attr(href);font-weight:400;font-size:8pt;color:#555;word-break:break-all}}
`

/** The minified stylesheet. */
export const STYLE = RULES.split('\n')
  .map((line) => line.trim())
  .join('')
