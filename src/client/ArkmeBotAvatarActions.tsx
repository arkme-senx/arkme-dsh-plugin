import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeBotList, ArkmeBotSummary } from '../types.js'
import type { ArkmeGroupBotItem, ArkmeGroupBotList, ArkmeGroupBotMutationResult } from '../tools/ports/bots.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeMemberRecordCountLabel } from './ArkmeChatMemberActions.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { callArkme } from './api.js'

export interface ArkmeBotAvatarIdentity {
  itemUid: string
  name: string
  directoryKey?: string
  avatarRef?: string
}

export interface ArkmeBotAvatarResolution {
  group?: ArkmeGroupBotItem
  personal?: ArkmeBotSummary
}

export function arkmeGroupBotAvatarIdentity(bot: ArkmeGroupBotItem): ArkmeBotAvatarIdentity {
  return {
    itemUid: `group-bot:${bot.directoryKey || bot.botRef}`, name: bot.name,
    ...(bot.directoryKey === undefined ? {} : { directoryKey: bot.directoryKey }),
    ...(bot.avatarRef === undefined ? {} : { avatarRef: bot.avatarRef }),
  }
}

const botResolutionCache = new Map<string, { value: ArkmeBotAvatarResolution; expiresAt: number }>()
const BOT_RESOLUTION_CACHE_MILLIS = 60_000

export function arkmeBotAvatarResolutionCacheKey(accountKey: string, sourceRef: string, directoryKey: string): string {
  return JSON.stringify([accountKey, sourceRef, directoryKey])
}

export function arkmeInvalidateBotAvatarResolution(accountKey: string, sourceRef: string, directoryKey?: string): void {
  if (directoryKey !== undefined) {
    botResolutionCache.delete(arkmeBotAvatarResolutionCacheKey(accountKey, sourceRef, directoryKey))
    return
  }
  const prefix = `${JSON.stringify([accountKey, sourceRef]).slice(0, -1)},`
  for (const key of botResolutionCache.keys()) if (key.startsWith(prefix)) botResolutionCache.delete(key)
}

export function arkmeResolveBotAvatar(
  directoryKey: string | undefined,
  groupBots: readonly ArkmeGroupBotItem[],
  personalBots: readonly ArkmeBotSummary[],
): ArkmeBotAvatarResolution {
  if (!directoryKey) return {}
  const group = groupBots.find(bot => bot.directoryKey === directoryKey)
  const personal = personalBots.find(bot => bot.directoryKey === directoryKey)
  return {
    ...(group === undefined ? {} : { group }),
    ...(personal === undefined ? {} : { personal }),
  }
}

function useBotAvatarResolution(props: {
  accountKey: string
  sourceRef: string
  identity: ArkmeBotAvatarIdentity
}) {
  const [resolution, setResolution] = useState<ArkmeBotAvatarResolution>()
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const directoryKey = props.identity.directoryKey
    if (!directoryKey) { setResolution({}); setLoading(false); return }
    const cacheKey = arkmeBotAvatarResolutionCacheKey(props.accountKey, props.sourceRef, directoryKey)
    const cached = botResolutionCache.get(cacheKey)
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      setResolution(cached.value)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setResolution(undefined)
    setLoading(true)
    void Promise.allSettled([
      callArkme<ArkmeGroupBotList>('group.bots', { sourceRef: props.sourceRef }, controller.signal),
      callArkme<ArkmeBotList>('bots.list', undefined, controller.signal),
    ]).then(results => {
      if (controller.signal.aborted) return
      const groupBots = results[0].status === 'fulfilled' ? results[0].value.items : []
      const personalBots = results[1].status === 'fulfilled' ? results[1].value.items : []
      const next = arkmeResolveBotAvatar(directoryKey, groupBots, personalBots)
      // A failed group request must not cache a missing membership/permission.
      if (results.every(result => result.status === 'fulfilled')) {
        botResolutionCache.set(cacheKey, { value: next, expiresAt: Date.now() + BOT_RESOLUTION_CACHE_MILLIS })
        if (botResolutionCache.size > 100) botResolutionCache.delete(botResolutionCache.keys().next().value!)
      }
      setResolution(next)
      setLoading(false)
    })
    return () => controller.abort()
  }, [props.accountKey, props.identity.directoryKey, props.sourceRef])
  return { resolution, loading }
}

export function ArkmeBotAvatarActionMenu(props: {
  accountKey: string
  sourceRef: string
  identity: ArkmeBotAvatarIdentity
  hoverAnchor?: HTMLElement | undefined
  hoverSide?: 'left' | 'right' | undefined
  position: { left: number; top: number }
  onMention(botRef: string, name: string): void
  onRecords(mode: 'mentioned' | 'owner'): void
  canRemove: boolean
  onRemove(bot: ArkmeGroupBotItem): void
  onClose(): void
}) {
  const { resolution, loading } = useBotAvatarResolution(props)
  const group = resolution?.group
  const canMention = group?.installed === true && group.provider === 'openclaw'
  const mentionLabel = `@${group?.name || props.identity.name}`
  return <ArkmeActionMenu
    label={tr('{v0} 的 Bot 操作', { v0: props.identity.name })}
    hoverAnchor={props.hoverAnchor}
    align={props.hoverSide === 'left' ? 'end' : 'start'}
    autoFocus={props.hoverAnchor === undefined}
    point={{ x: props.position.left, y: props.position.top }}
    onClose={props.onClose}
    actions={[
      loading && { type: 'label', id: 'loading', text: tr('正在加载 Bot 操作…') },
      { id: 'mention', label: <span title={group?.provider === 'webhook' ? tr('通知型 Bot 暂不支持 @ 对话') : undefined}>{mentionLabel}</span>,
        disabled: !canMention, onSelect: () => { if (canMention) props.onMention(group.botRef, group.name) } },
      { id: 'mentioned-records', label: <ArkmeMemberRecordCountLabel label="@TA的快记" />,
        disabled: !props.identity.directoryKey, onSelect: () => props.onRecords('mentioned') },
      { id: 'owner-records', label: <ArkmeMemberRecordCountLabel label="看TA的快记" />,
        disabled: !props.identity.directoryKey, onSelect: () => props.onRecords('owner') },
      props.canRemove && group?.installed === true && { id: 'remove', label: tr('移出群聊'), danger: true,
        onSelect: () => props.onRemove(group) },
      !loading && group === undefined && resolution?.personal === undefined
        && { type: 'label', id: 'unavailable', text: tr('该 Bot 暂不可用') },
    ]}
  />
}

export function ArkmeBotRemoveDialog(props: {
  sourceRef: string
  bot: ArkmeGroupBotItem
  onRemoved(result: ArkmeGroupBotMutationResult): void
  onClose(): void
}) {
  useArkmeLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController>()
  const busyRef = useRef(false)
  useEffect(() => () => { requestRef.current?.abort() }, [])
  return <ArkmeConfirmDialog
    titleId="arkme-bot-remove-title"
    title={tr('移出群聊？')}
    description={tr('{v0} 将从当前群聊移除，历史消息保留。', { v0: props.bot.name })}
    error={error}
    busy={busy}
    confirmLabel={tr('确认移除')}
    busyLabel={tr('移除中…')}
    confirmTone="danger"
    onClose={props.onClose}
    onConfirm={() => {
      if (busyRef.current) return
      const controller = new AbortController()
      requestRef.current = controller
      busyRef.current = true
      setBusy(true)
      setError('')
      void callArkme<ArkmeGroupBotMutationResult>('group.bot.remove', {
        sourceRef: props.sourceRef, botRef: props.bot.botRef,
      }, controller.signal).then(result => {
        if (!controller.signal.aborted) props.onRemoved(result)
      }).catch(caught => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('移除失败，请稍后重试'))
      }).finally(() => {
        if (requestRef.current === controller) requestRef.current = undefined
        busyRef.current = false
        if (!controller.signal.aborted) setBusy(false)
      })
    }}
  />
}

const cardStyles: Record<string, CSSProperties> = {
  scrim: { position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center', padding: 20,
    background: 'rgba(25, 28, 34, .12)', boxSizing: 'border-box' },
  card: { width: 300, maxWidth: '100%', minHeight: 270, display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '28px 18px 18px', boxSizing: 'border-box', borderRadius: 9,
    background: arkmeTheme.layer2, boxShadow: '0 18px 48px rgba(22, 26, 32, .28)' },
  name: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    margin: '10px 0 0', color: arkmeTheme.text, fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  meta: { margin: '3px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px' },
  description: { width: '100%', margin: '16px 0 0', color: arkmeTheme.secondary, fontSize: 13,
    lineHeight: '20px', textAlign: 'center', overflowWrap: 'anywhere' },
  action: { width: '100%', height: 44, marginTop: 'auto', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 8, background: arkmeTheme.elevated, color: arkmeTheme.text,
    fontSize: 15, fontWeight: 600, cursor: 'pointer' },
}

export function ArkmeBotAvatarProfileCard(props: {
  accountKey: string
  sourceRef: string
  identity: ArkmeBotAvatarIdentity
  onChat(bot: ArkmeBotSummary): void
  onClose(): void
}) {
  useArkmeLocale()
  const { resolution, loading } = useBotAvatarResolution(props)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  const bot = resolution?.personal ?? resolution?.group
  const name = bot?.name || props.identity.name
  const avatarRef = bot?.avatarRef || props.identity.avatarRef
  return <div style={cardStyles.scrim} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) props.onClose()
  }}>
    <section style={cardStyles.card} role="dialog" aria-modal="true" aria-label={tr('{v0} 的 Bot 资料', { v0: name })}>
      <ArkmeUserAvatar senderKind="bot" {...(avatarRef === undefined ? {} : { avatarRef })}
        size={88} label={tr('{v0} 的头像', { v0: name })} />
      <h3 style={cardStyles.name}>{name}</h3>
      <p style={cardStyles.meta}>{bot?.provider === 'openclaw' ? 'OpenClaw Bot'
        : bot?.provider === 'webhook' ? 'Webhook Bot' : 'Bot'}</p>
      <p style={cardStyles.description}>{loading ? tr('正在加载 Bot 操作…') : bot === undefined ? tr('该 Bot 暂不可用')
        : bot.description?.trim() || tr('暂无简介')}</p>
      {resolution?.personal?.directChatAvailable === true && <button data-arkme-feedback="neutral"
        type="button" style={cardStyles.action} onClick={() => { if (resolution.personal) props.onChat(resolution.personal) }}>{tr('发送消息')}</button>}
    </section>
  </div>
}
