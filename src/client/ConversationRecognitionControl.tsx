import { useId, useState } from 'react'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import type { ConversationActionItem } from './PrivateChatActions.js'
import { useConversationRecognition } from './use-conversation-recognition.js'
import { ConversationSettingSwitch } from './ConversationSettingSwitch.js'
import { ArkmeTextTooltip } from './ArkmeTextTooltip.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export const CONVERSATION_RECOGNITION_HELP = '开启后，AI会识别此对话中与你相关的待办，整理到安排中，帮你减少遗漏、方便跟进。仅影响你自己，已有安排保留。'
function RecognitionLabel({ state }: { state: ReturnType<typeof useConversationRecognition> }) {
  const [anchor, setAnchor] = useState<HTMLElement>()
  const id = useId()
  const help = tr(CONVERSATION_RECOGNITION_HELP) + (state.value?.blockedReason ? `\n${state.value.blockedReason}` : '')
  return <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
    <span>{tr('安排识别')}</span>
    <span role="button" tabIndex={0} aria-label={tr('安排识别说明')} aria-describedby={anchor ? id : undefined}
      style={{ display: 'inline-flex', color: arkmeTheme.secondary, cursor: 'help', padding: 2 }}
      onMouseEnter={event => setAnchor(event.currentTarget)} onMouseLeave={() => setAnchor(undefined)} onFocus={event => setAnchor(event.currentTarget)} onBlur={() => setAnchor(undefined)}
      onClick={event => { event.stopPropagation(); setAnchor(event.currentTarget) }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setAnchor(event.currentTarget) } }}><Info size={15} aria-hidden /></span>
    {anchor && <ArkmeTextTooltip anchor={anchor} id={id} text={help} kind="help" onClose={() => setAnchor(undefined)} />}
    {state.value ? <ConversationSettingSwitch label={tr('安排识别')} checked={state.value.enabled} busy={state.busy} onChange={() => { void state.toggle() }} />
      : <span style={{ marginLeft: 'auto', fontSize: 12, color: arkmeTheme.secondary }}>{tr(state.error ? '重试' : '读取中…')}</span>}
  </span>
}
export function useConversationRecognitionAction(account: string, reference: string, scope: 'chat' | 'team', open: boolean): ConversationActionItem {
  const state = useConversationRecognition(account, reference, scope, open)
  return { id: 'arrangement-recognition', label: <RecognitionLabel state={state} />, icon: <ListChecks size={20} aria-hidden />,
    keepOpenOnSelect: true, disabled: state.busy, ...(state.error ? { error: state.error } : {}), invoke: () => { void state.toggle() } }
}
