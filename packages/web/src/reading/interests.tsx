import { useState } from 'preact/hooks'
import { t } from '../i18n/index.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { Field, Input, Select } from '../ui/form.tsx'
import { addRule, cleanRules, type FollowRule, reading, removeRule } from './store.ts'

export default function Interests() {
  const [value, setValue] = useState('')
  const [kind, setKind] = useState<FollowRule['kind']>('keyword')
  const [mode, setMode] = useState<FollowRule['mode']>('follow')
  const rules = cleanRules(reading.value.rules)
  const add = (e: SubmitEvent) => {
    e.preventDefault()
    addRule(value, kind, mode)
    setValue('')
  }
  return (
    <div class="settings__stack interests">
      <p class="settings__hint">{t('reading.interestsHelp')}</p>
      <form class="interests__form" onSubmit={add}>
        <Field label={t('reading.ruleKind')}>
          {(id) => (
            <Select
              id={id}
              value={kind}
              onValue={setKind}
              options={(['keyword', 'company', 'project'] as const).map((v) => ({
                value: v,
                label: t(`reading.${v}`),
              }))}
            />
          )}
        </Field>
        <Field label={t('reading.ruleValue')} hint={t('reading.ruleHint')}>
          {(id, describedBy) => (
            <Input id={id} aria-describedby={describedBy} value={value} onValue={setValue} maxLength={100} required />
          )}
        </Field>
        <Field label={t('reading.ruleMode')}>
          {(id) => (
            <Select
              id={id}
              value={mode}
              onValue={setMode}
              options={(['follow', 'mute'] as const).map((v) => ({ value: v, label: t(`reading.${v}`) }))}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" icon="plus" disabled={!value.trim()}>
          {t('reading.add')}
        </Button>
      </form>
      <section>
        <h3 class="settings__subh">{t('reading.presets')}</h3>
        <div class="reading-tabs">
          <Button
            onClick={() =>
              ['coding', 'agent', '编程'].forEach((v) => {
                addRule(v)
              })
            }
          >
            {t('reading.presetCoding')}
          </Button>
          <Button
            onClick={() =>
              ['arxiv', 'research', '研究'].forEach((v) => {
                addRule(v)
              })
            }
          >
            {t('reading.presetResearch')}
          </Button>
          <Button
            onClick={() =>
              ['video', 'image', 'diffusion', '视频'].forEach((v) => {
                addRule(v)
              })
            }
          >
            {t('reading.presetMedia')}
          </Button>
        </div>
      </section>
      <ul class="interests__rules">
        {rules.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{r.value}</strong>
              <small>
                {t(`reading.${r.kind}`)} · {t(`reading.${r.mode}`)}
              </small>
            </span>
            <IconButton icon="x" label={t('reading.removeRule', { value: r.value })} onClick={() => removeRule(r.id)} />
          </li>
        ))}
      </ul>
      {!rules.length && <p class="settings__hint">{t('reading.noRules')}</p>}
    </div>
  )
}
