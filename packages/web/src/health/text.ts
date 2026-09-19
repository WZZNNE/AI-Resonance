import { lang } from '../i18n/index.ts'

const WORDS = {
  en: {
    observed: 'Latest collection attempt',
    unknown: 'Not available',
    delivered: 'Accepted',
    failed: 'Failed',
    recentSent: 'Most recent complete delivery',
    settledEdition: 'Settlement for edition',
    pendingHelp: 'Pending sources can recover on a later run. Completed sources keep their recorded readings.',
    legacy: 'This older edition has no per-source settlement record.',
  },
  zh: {
    observed: '最近一次采集尝试',
    unknown: '暂无记录',
    delivered: '已接受',
    failed: '失败',
    recentSent: '最近一次完整投递',
    settledEdition: '定稿进度所属期',
    pendingHelp: '未完成的来源会在后续运行继续尝试；已完成来源保留当时的读数。',
    legacy: '这期旧数据尚无按来源记录的定稿时间。',
  },
}
export const words = () => WORDS[lang.value]
