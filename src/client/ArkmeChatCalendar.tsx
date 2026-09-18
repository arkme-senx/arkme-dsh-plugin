import { useMemo, useRef, useState } from 'react'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArkmeSelfCalendarPopover } from './ArkmeCalendarSurface.js'
import { ArkmeConversationHeaderIconButton } from './ArkmeGroupChatControls.js'
import { useCalendarMonth } from './use-calendar-month.js'
import type { SelfCalendarDateSelection } from './use-self-calendar-navigation.js'
import type { ArkmeInterwovenMention } from '../types.js'
import { mergeConversationCalendar, conversationCalendarNotice, type ConversationCalendarInteractionState } from './conversation-calendar.js'

/** Both private and group chats share Flutter's service-owned date index. */
export function ArkmeChatCalendar({ sourceRef, scopeKey, accountScope, getReadingDate, onSelect, onOpen, interactions }: {
  sourceRef: string; scopeKey: string; accountScope?: string | undefined
  getReadingDate?: (() => string | undefined) | undefined
  onSelect(selection: SelfCalendarDateSelection): void; onOpen(): void
  interactions?: { moments: readonly ArkmeInterwovenMention[]; state: ConversationCalendarInteractionState; retry(): void } | undefined
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  const offset = -new Date().getTimezoneOffset() * 60_000
  const base = useCalendarMonth({ sourceRef, scopeKey, timezone, startDate: '0001-01-01', endDate: '9999-12-31',
    timezoneOffsetMillis: offset }, true, accountScope)
  const value = useMemo(() => interactions ? mergeConversationCalendar(base.value, interactions.moments, offset) : base.value,
    [base.value, interactions?.moments, offset])
  const incomplete = interactions !== undefined && interactions.state !== 'disabled'
  const index = { ...base, ...(value ? { value } : {}), incomplete,
    notice: interactions ? conversationCalendarNotice(interactions.state) : '',
    retryNotice: interactions && (interactions.state === 'error' || interactions.state === 'partial') ? interactions.retry : undefined }
  const label = `按日期查看聊天记录${index.value ? ` · ${incomplete ? '已知 ' : ''}${index.value.totalDayCount ?? index.value.days.length} 个日期` : ''}`
  return <div data-arkme-chat-calendar style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
    onClick={event => event.stopPropagation()}>
    <ArkmeConversationHeaderIconButton buttonRef={anchor} label={label}
      hasPopup="dialog" expanded={open} busy={index.loading && !index.value} onClick={() => {
        if (!open) { onOpen(); if (index.error) index.retry(); else index.revalidate() }
        setOpen(value => !value)
      }}>
      {index.loading && !index.value
        ? <span role="status" aria-label="正在加载日历" style={{ display: 'inline-flex' }}><IconLoadingOutline16 className="arkme-icon-spin" /></span>
        : <CalendarBlank size={16} aria-hidden />}
    </ArkmeConversationHeaderIconButton>
    <ArkmeSelfCalendarPopover open={open} anchor={anchor} sourceRef={sourceRef} scopeKey={scopeKey}
      getReadingDate={getReadingDate}
      accountScope={accountScope} index={index} onClose={() => setOpen(false)} onSelectDate={onSelect}
      onSelectRecord={() => { /* Chat navigation always uses the index anchor. */ }} />
  </div>
}
