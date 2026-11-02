import type { ArkmeRecordingWorkbenchItem } from './types.js'

export const VOICE_TRIGGER_PENDING = '后端接口开发中，开发完成后此功能完整可用。'
export interface RecordingVoiceRule {
  id: string
  phrase: string
  aliases: string[]
  enabled: boolean
  autoSaveSelf: boolean
  action: 'save-self'
}
export interface RecordingVoiceDraft { revision: number; rules: RecordingVoiceRule[] }
export interface RecordingVoiceSettings {
  accountKey: string
  available: boolean
  revision: number
  rules: RecordingVoiceRule[]
  draft: RecordingVoiceDraft
}
export interface RecordingVoiceCandidate {
  candidateKey: string
  candidateRef: string
  revision: number
  phrase: string
  text: string
  startAtMillis: number
  endAtMillis: number
  speaker: 'self' | 'unknown' | 'other'
  speakerLabel: string
  status: 'pending' | 'saved' | 'ignored'
  boundary: 'complete' | 'open' | 'uncertain'
  evidence: { kind: 'audio-kws'; model: string; score: number }
}
export interface RecordingVoicePage { items: RecordingVoiceCandidate[]; nextCursor?: string }
export interface RecordingVoiceDetail { items: ArkmeRecordingWorkbenchItem[] }

/** Rule text configures an acoustic detector; this is never a transcript matcher. */
export function recordingVoiceRules(value: unknown): RecordingVoiceRule[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('最多添加 20 条语音触发规则')
  const phrases = new Set<string>(), ids = new Set<string>()
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id) || ids.has(raw.id)
      || typeof raw.enabled !== 'boolean' || typeof raw.autoSaveSelf !== 'boolean' || raw.action !== 'save-self'
      || !Array.isArray(raw.aliases) || raw.aliases.length > 5) throw new Error('语音触发规则无效')
    ids.add(raw.id)
    const normalize = (value: unknown) => {
      if (typeof value !== 'string') throw new Error('请填写触发口令')
      const text = value.trim().normalize('NFKC')
      if ([...text].length < 3 || [...text].length > 32 || /[\r\n\x00-\x1f]/u.test(text)) throw new Error('触发口令需为 3–32 个字')
      const key = text.toLocaleLowerCase('zh-CN').replace(/[\s，。！？、,.!?]/gu, '')
      if ([...key].length < 3 || !/[\p{L}\p{N}]/u.test(key)) throw new Error('请填写有辨识度的触发口令')
      if (phrases.has(key)) throw new Error('口令或其他说法重复，请调整后保存')
      phrases.add(key)
      return text
    }
    return { id: raw.id, phrase: normalize(raw.phrase), aliases: raw.aliases.map(normalize), enabled: raw.enabled, autoSaveSelf: raw.autoSaveSelf, action: 'save-self' }
  })
}
export function defaultRecordingVoiceRule(): RecordingVoiceRule {
  return { id: 'note-to-self', phrase: '帮我记一下', aliases: [], enabled: false, autoSaveSelf: true, action: 'save-self' }
}

/** Prefer self within a loaded page, without hiding unknown or differently attributed voices. */
export function prioritizeRecordingVoiceCandidates(items: RecordingVoiceCandidate[]): RecordingVoiceCandidate[] {
  return [...items].sort((a, b) => Number(b.speaker === 'self') - Number(a.speaker === 'self') || b.startAtMillis - a.startAtMillis)
}
