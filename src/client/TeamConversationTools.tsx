import { mergeTeamNotificationPolicy, type TeamNotificationPolicy } from '../team-notification-contract.js'
import { invalidateTeamMessages, subscribeTeamMessageChanges } from './team-messaging-events.js'
import { teamChangeAffectsSource } from './team-source-read.js'
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import type { TeamConversation, TeamIdentity, TeamMessage } from '../team-app-contract.js'
import type { ArkmeOpenPrivateChatResult } from '../types.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeConversationHeaderIconButton, ARKME_CONVERSATION_HEADER_ACTIONS_STYLE } from './ArkmeGroupChatControls.js'
import { ArkmeSelfCalendarPopover } from './ArkmeCalendarSurface.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
import { ConversationActionsMenu, conversationExportActionItem } from './PrivateChatActions.js'
import { useSelectedMessageSearch } from './message-selection-search.js'
import { teamHistoryDate } from './team-history-browser.js'
import { TeamHistoryPanel } from './TeamHistoryPanel.js'
import { historyCall, historyTimezone, localDateWindow, prepareHistory } from './team-history-client.js'
import type { TeamHistoryResponse } from '../team-history-contract.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { arkmeUi } from './ui-controller.js'
import { tr } from './locale.js'

type Panel = 'calendar' | 'search' | 'analysis' | 'menu'
const button: CSSProperties = { border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', padding: '5px 8px', font: 'inherit', fontSize: 12 }
const errorText = (e: unknown) => e instanceof Error ? e.message : tr('操作失败，请重试')

/** Team history reads share the server-authorized owner with Tools and SDK. */
export function TeamConversationTools({ conversation, accountKey, host, onOpenPanel, onLocate, resolveIdentity, getReadingDate, overlayOpen }: {
  conversation: TeamConversation; accountKey: string; overlayOpen: boolean; host: RefObject<HTMLElement>
  onOpenPanel(): void; onLocate(message: TeamMessage, signal: AbortSignal): Promise<void>
  resolveIdentity(identity: TeamIdentity): TeamIdentity; getReadingDate(): string | undefined
}) {
  const [open, setOpen] = useState<Panel>()
  const input = useRef<HTMLInputElement>(null)
  const calendar = useRef<HTMLButtonElement>(null), search = useRef<HTMLButtonElement>(null), analysis = useRef<HTMLButtonElement>(null), menu = useRef<HTMLButtonElement>(null)
  const lifetime=useRef(new AbortController()),reader=useRef<AbortController>()
  const [query,setQuery]=useState(''),[notice,setNotice]=useState(''),[opening,setOpening]=useState('')
  const [calendarRevision,setCalendarRevision]=useState(0)
  const [exportProgress,setExportProgress]=useState<TeamHistoryResponse>()
  const exportJob=useRef<{requestId:string;resultRef?:string}>()
  const [exporting, setExporting] = useState(false), [privateBusy, setPrivateBusy] = useState(false)
  const [policy, setPolicy] = useState(() => mergeTeamNotificationPolicy(undefined, conversation.notificationPolicy))
  const [policyBusy, setPolicyBusy] = useState(false), [policyError, setPolicyError] = useState('')
  const policyLock = useRef(false)
  useEffect(() => { setPolicy(current => mergeTeamNotificationPolicy(current, conversation.notificationPolicy)) }, [conversation.notificationPolicy])
  useEffect(() => {
    if (open !== 'menu') return
    const request = new AbortController()
    setPolicyBusy(true); setPolicyError('')
    void callArkme<TeamNotificationPolicy>('team.app.notification-policy.get', {conversationRef:conversation.ref,expectedAccountKey:accountKey}, request.signal)
      .then(value => { if (!request.signal.aborted) setPolicy(current => mergeTeamNotificationPolicy(current,value)) })
      .catch(error => { if (!request.signal.aborted) setPolicyError(errorText(error)) })
      .finally(() => { if (!request.signal.aborted) setPolicyBusy(false) })
    return () => request.abort()
  }, [open,conversation.ref,accountKey])
  const setMuted = async () => {
    if (policyBusy || policyLock.current) return
    policyLock.current = true; setPolicyBusy(true); setPolicyError('')
    try {
      const value = await callArkme<TeamNotificationPolicy>('team.app.notification-policy.set',
        {conversationRef:conversation.ref,expectedAccountKey:accountKey,muted:!policy.muted},lifetime.current.signal)
      if (!lifetime.current.signal.aborted) {
        setPolicy(current=>mergeTeamNotificationPolicy(current,value)); invalidateTeamMessages(accountKey,false,{kind:'team.notification-policy.changed'})
      }
    } catch (error) { if (!lifetime.current.signal.aborted) setPolicyError(errorText(error)) }
    finally { policyLock.current=false; if (!lifetime.current.signal.aborted) setPolicyBusy(false) }
  }
  const privateLock = useRef(false), locateLock = useRef(false), exportLock = useRef(false)
  useEffect(()=>{lifetime.current=new AbortController();return()=>{lifetime.current.abort();reader.current?.abort()}},[accountKey,conversation.key,conversation.side])
  useEffect(() => { if (overlayOpen) setOpen(undefined) }, [overlayOpen])
  useEffect(() => {
    if (open !== 'search') return
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])
  const cancel = async () => {
    reader.current?.abort()
    const job=exportJob.current
    if(!job)return
    setNotice(tr('正在取消导出…'))
    try{
      const manifest=job.resultRef?{resultRef:job.resultRef}:await historyCall(conversation.ref,accountKey,'exports/create',{requestId:job.requestId,timezone:historyTimezone()},lifetime.current.signal)
      if(!manifest.resultRef)throw new Error(tr('取消结果尚不确定，请重试取消'))
      await historyCall(conversation.ref,accountKey,'exports/cancel',{resultRef:manifest.resultRef},lifetime.current.signal)
      exportJob.current=undefined;setExporting(false);setNotice(tr('已取消导出'))
    }catch(error){if(!lifetime.current.signal.aborted)setNotice(errorText(error))}
  }
  const toggle = (next: Panel) => {
    if (next === open) { setOpen(undefined); return }
    onOpenPanel(); setOpen(next); setNotice(''); setPolicyError('')
  }
  useSelectedMessageSearch(conversation.ref, text => {onOpenPanel();setQuery(text);setOpen('search');requestAnimationFrame(()=>input.current?.focus({preventScroll:true}))})
  const loadCalendarMonth = async (range:{startDate:string;endDate:string;timezone:string},signal:AbortSignal) => {
    const options={...localDateWindow(range.startDate,range.endDate),timezone:range.timezone,requestId:crypto.randomUUID()}
    const manifest=await prepareHistory(conversation.ref,accountKey,'dates',options,signal)
    const page=await historyCall(conversation.ref,accountKey,'dates',{resultRef:manifest.resultRef!,limit:100},signal)
    if(page.hasMore)throw new Error(tr('日期索引不完整，请重新读取'))
    for(const item of page.days)calendarAnchors.current.set(item.date,item.message)
    return {days:page.days.map(day=>({bucketDate:day.date,count:day.count,protectedCount:0,hasRecords:day.count>0}))}
  }
  const calendarAnchors=useRef(new Map<string,TeamMessage>())
  useEffect(()=>subscribeTeamMessageChanges((account,receiptOnly,change)=>{
    if(account===accountKey&&!receiptOnly&&teamChangeAffectsSource(change,{conversationKey:conversation.key})){calendarAnchors.current.clear();setCalendarRevision(n=>n+1)}
  }),[accountKey,conversation.key])
  const locate = async (message: TeamMessage) => {
    if (locateLock.current) return
    locateLock.current = true; setOpening(message.key); setNotice('')
    try { await onLocate(message, lifetime.current.signal); if (!lifetime.current.signal.aborted) setOpen(undefined) }
    catch (e) { if (!lifetime.current.signal.aborted) { setNotice(errorText(e)); invalidateTeamMessages(accountKey) } }
    finally { locateLock.current = false; if (!lifetime.current.signal.aborted) setOpening('') }
  }
  const openPrivate = async (mediaType?: 'audio' | 'video') => {
    if (privateLock.current) return
    setOpen(undefined)
    if (conversation.side !== 'team') { setNotice(tr('当前是团队服务会话，请先选择具体成员再发起个人通话')); return }
    privateLock.current = true; setPrivateBusy(true); setNotice('')
    try {
      const result = await withArkmeReadDeadline(signal => callArkme<ArkmeOpenPrivateChatResult>('team.app.visitor.private.open', {
        conversationRef: conversation.ref, expectedAccountKey: accountKey,
      }, signal), lifetime.current.signal)
      lifetime.current.signal.throwIfAborted()
      if (mediaType) outgoingCallUi.request({ sourceRef: result.source.sourceRef, displayName: conversation.visitor?.nickname ?? result.source.displayName, mediaType })
      else arkmeUi.activateNotificationSource(result.source)
    } catch (e) { if (!lifetime.current.signal.aborted) setNotice(errorText(e)) }
    finally { privateLock.current = false; if (!lifetime.current.signal.aborted) setPrivateBusy(false) }
  }
  const title = conversation.side === 'team' ? conversation.visitor?.nickname ?? tr('外部用户') : conversation.channel.name
  const exportHistory = async () => {
    if(exportLock.current)return
    exportLock.current=true;setExporting(true);setNotice('')
    const controller=new AbortController();reader.current=controller
    exportJob.current??={requestId:crypto.randomUUID()}
    const job=exportJob.current
    try{
      const manifest=await prepareHistory(conversation.ref,accountKey,'exports/create',{requestId:job.requestId,timezone:historyTimezone()},controller.signal,result=>{setExportProgress(result);if(result.resultRef)job.resultRef=result.resultRef})
      const ready=await historyCall(conversation.ref,accountKey,'exports/link',{resultRef:manifest.resultRef!},controller.signal)
      controller.signal.throwIfAborted()
      const fileName=`${title.replace(/[\\/:*?"<>|\r\n]/g,'_')}-团队对话-${teamHistoryDate(Date.now())}.md`
      const anchor=document.createElement('a');anchor.href=`${ready.downloadUrl!}&name=${encodeURIComponent(fileName)}`;anchor.download=fileName;document.body.append(anchor);anchor.click();anchor.remove()
      setNotice(tr('导出已生成，已开始下载'));exportJob.current=undefined
    }catch(error){if(!controller.signal.aborted)setNotice(errorText(error))}
    finally{exportLock.current=false;if(!controller.signal.aborted)setExporting(false)}
  }
  const progress=`${tr('正在生成导出…')} · ${exportProgress?.messageCount??0} ${tr('条')}`
  return <div data-team-conversation-tools style={{ ...ARKME_CONVERSATION_HEADER_ACTIONS_STYLE, flex: '0 0 auto' }}>
    <ArkmeConversationHeaderIconButton label={tr('按日期查看团队消息')} buttonRef={calendar} hasPopup="dialog" expanded={open === 'calendar'} onClick={() => toggle('calendar')}><CalendarBlank size={24}/></ArkmeConversationHeaderIconButton>
    <ArkmeConversationHeaderIconButton label={tr('搜索团队消息')} buttonRef={search} hasPopup="dialog" expanded={open === 'search'} onClick={() => toggle('search')}><MagnifyingGlass size={24}/></ArkmeConversationHeaderIconButton>
    <ArkmeConversationHeaderIconButton label={tr('对话分析')} buttonRef={analysis} hasPopup="dialog" expanded={open === 'analysis'} onClick={() => toggle('analysis')}><ChartBar size={22}/></ArkmeConversationHeaderIconButton>
    <ArkmePrivateCallMenu displayName={title} personalIdentity busy={privateBusy} onStart={mediaType => void openPrivate(mediaType)}/>
    <ConversationActionsMenu anchor={menu} label={tr('更多团队对话操作')} trigger={{ open: open === 'menu', onOpenChange: value => value ? toggle('menu') : setOpen(undefined) }} onClose={() => setOpen(undefined)} items={[
      {
        id: 'message-dnd', label: tr('消息免打扰'), icon: <BellSlash size={20} aria-hidden />,
        keepOpenOnSelect: true,
        checked: policy.muted, busy: policyBusy, ...(policyError ? {error:policyError} : {}),
        invoke: () => void setMuted(),
      },
      conversationExportActionItem({ busy: exporting, processed: exportProgress?.messageCount??0, invoke: () => void exportHistory() }),
    ]}/>
    <ArkmeSelfCalendarPopover open={open === 'calendar'} anchor={calendar} accountScope={accountKey} scopeKey={`team:${conversation.key}:${calendarRevision}`} getReadingDate={getReadingDate}
      onClose={() => setOpen(undefined)} onSelectRecord={() => {}}
      index={{loadMonth:loadCalendarMonth,loading:false,error:'',retry:()=>{}}}
      onSelectIndexedDay={date => {const message=calendarAnchors.current.get(date);if(message)void locate(message)}}/>
    {host.current && (open === 'search' || open === 'analysis') && createPortal(<ArkmeDetailShell title={tr(open === 'search' ? '查找团队消息' : '对话分析')} label={tr(open === 'search' ? '查找团队消息' : '团队对话分析')}
      returnFocusRef={open === 'search' ? search : analysis} onPointerDownOutside={() => setOpen(undefined)} onClose={() => setOpen(undefined)} bodyStyle={{ padding: '12px 16px' }}>
      <TeamHistoryPanel key={JSON.stringify([accountKey,conversation.key,conversation.side])} conversation={conversation} accountKey={accountKey} kind={open} keyword={query} onKeywordChange={setQuery} inputRef={input} opening={opening} resolveIdentity={resolveIdentity} onLocate={message=>void locate(message)}/>
    </ArkmeDetailShell>, host.current)}
    {host.current && (notice || exporting || privateBusy) && createPortal(<div role="status" style={{ position: 'absolute', zIndex: 13, top: 76, right: 16, maxWidth: 'calc(100% - 32px)', padding: '8px 12px', borderRadius: 8, background: arkmeTheme.layer2, color: arkmeTheme.secondary, border: `1px solid ${arkmeTheme.border}`, fontSize: 12 }}>
      {exporting ? [progress,notice].filter(Boolean).join(' · ') : privateBusy ? tr('正在打开个人会话…') : notice}
      {exporting ? <button style={button} onClick={()=>void cancel()}>{tr('取消')}</button> : !privateBusy && <button style={button} onClick={() => setNotice('')}>{tr('关闭')}</button>}
    </div>, host.current)}
  </div>
}
