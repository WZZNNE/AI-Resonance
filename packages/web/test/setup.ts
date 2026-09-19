// The app loads dictionaries on demand (src/i18n/index.ts); tests render in both languages, so load both up front.
import { loadLang } from '../src/i18n/index.ts'

await Promise.all([loadLang('en'), loadLang('zh')])
