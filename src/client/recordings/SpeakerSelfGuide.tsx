import { useEffect, useState } from 'react'
import type { ArkmeMyVoiceprint } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeUi } from '../ui-controller.js'
import { tr, useArkmeLocale } from '../locale.js'

const loadVoiceprint = (signal: AbortSignal) => callArkme<ArkmeMyVoiceprint>('voiceprint.status', {}, signal)

export function SpeakerSelfGuide({ onOpenRecordings, readVoiceprint = loadVoiceprint }: {
  onOpenRecordings(): void
  readVoiceprint?: typeof loadVoiceprint
}) {
  useArkmeLocale()
  const [state, setState] = useState<{ loading: boolean; value?: ArkmeMyVoiceprint }>({ loading: true })
  useEffect(() => {
    const controller = new AbortController()
    void readVoiceprint(controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ loading: false, value })
    }).catch(() => { if (!controller.signal.aborted) setState({ loading: false }) })
    return () => { controller.abort() }
  }, [readVoiceprint])
  if (state.loading) return null
  const pending = state.value?.enrollmentPending === true
  const hasVoiceprint = state.value?.hasVoiceprint === true
  const title = pending ? '你的声纹正在处理中'
    : hasVoiceprint ? '已录入声纹，暂未在录音中匹配到你' : '还没有标记你的声音'
  const actionStyle = { border: 0, padding: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 12 }
  return <aside aria-label={tr('识别我的声音')} style={{ padding: '12px 14px', marginBottom: 16, borderRadius: 10, background: arkmeTheme.layer1, fontSize: 13 }}>
    <div>{tr(title)}</div>
    <div style={{ marginTop: 5, color: arkmeTheme.secondary, fontSize: 12 }}>{tr('打开你的录音，点击说话人名称并选择自己；请先试听确认。')}</div>
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8 }}>
      <button type="button" style={actionStyle} onClick={onOpenRecordings}>{tr('从录音中标记我')}</button>
      <button type="button" style={actionStyle} onClick={() => { arkmeUi.showVoiceprint() }}>{tr(state.value !== undefined && !hasVoiceprint && !pending ? '录入我的声纹' : '管理声纹')}</button>
    </div>
  </aside>
}
