import { IdentityCopyLinkButton } from './IdentityCopyLinkButton.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { publicGroupJoinLabel, type PublicGroup, type PublicGroupJoinResult, type PublicGroupPage, type PublicPeoplePage, type PublicPerson, type PublicSocialTab } from '../public-social-contract.js'
import { callArkme } from './api.js'
import { tr, useArkmeLocale } from './locale.js'
import { publicSocialStyles as s } from './public-social-styles.js'
import { PublicPersonListingDialog } from './PublicSocialDialogs.js'

export type PublicWorldTab = 'all' | 'mine' | PublicSocialTab
function errorText(error: unknown): string { return error instanceof Error ? error.message : tr('读取失败，请重试') }
const tabs: Array<[PublicWorldTab, string]> = [['all', '世界'], ['mine', '我的世界'], ['groups', '公开群聊'], ['people', '找人聊聊']]

export function PublicSocialDirectory({ accountScope, mode, currentUserId, profileUserId, profileName, initialGroupUid, onTabChange, onBack, backLabel = '返回世界', onCreateGroup, onSourceActivated, onOpenWorld, embedded = false, refreshKey = 0, active = true }: {
  accountScope: string; mode: PublicSocialTab; currentUserId?: number | undefined; profileUserId?: number | undefined; profileName?: string | undefined; initialGroupUid?: string | undefined
  onTabChange?(tab: PublicWorldTab): void; onBack?(): void; backLabel?: string; onCreateGroup?(): void
  onSourceActivated?: ((source: ArkmeSourceItem) => void | Promise<void>) | undefined; onOpenWorld?(person: PublicPerson): void
  embedded?: boolean; refreshKey?: number; active?: boolean
}) {
  useArkmeLocale()
  const activeRef = useRef(active)
  activeRef.current = active
  const [search, setSearch] = useState(''), [query, setQuery] = useState('')
  const [groups, setGroups] = useState<PublicGroup[]>([]), [people, setPeople] = useState<PublicPerson[]>([])
  const [cursor, setCursor] = useState<string | number>(), [hasMore, setHasMore] = useState(false)
  const [selected, setSelected] = useState<string | number | undefined>(initialGroupUid)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState<string | number>(), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [editorOpen, setEditorOpen] = useState(false), [ownListing, setOwnListing] = useState<PublicPerson>()
  const read = useRef<AbortController>(), write = useRef<AbortController>(), requestIds = useRef(new Map<string, string>())
  const load = useCallback((next?: string | number) => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller
    setLoading(true); setError('')
    const operation = mode === 'groups' ? 'social.groups.query' : 'social.people.query'
    void callArkme<PublicGroupPage | PublicPeoplePage>(operation, { accountScope, query, ...(next === undefined ? {} : { cursor: next }), ...(profileUserId ? { userId: profileUserId } : {}) }, controller.signal).then(page => {
      if (read.current !== controller || controller.signal.aborted) return
      if (mode === 'groups') { const items = (page as PublicGroupPage).items; setGroups(old => next === undefined ? items : [...old, ...items.filter(i => !old.some(v => v.chatSessionUid === i.chatSessionUid))]) }
      else { const items = (page as PublicPeoplePage).items; setPeople(old => next === undefined ? items : [...old, ...items.filter(i => !old.some(v => v.userId === i.userId))]) }
      setCursor(page.nextCursor); setHasMore(page.hasMore)
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)) }).finally(() => { if (read.current === controller && !controller.signal.aborted) setLoading(false) })
  }, [accountScope, mode, profileUserId, query])
  useEffect(() => { setGroups([]); setPeople([]); setCursor(undefined); setHasMore(false); load(); return () => { read.current?.abort() } }, [load])
  const refreshedKey = useRef(refreshKey)
  useEffect(() => {
    if (refreshedKey.current === refreshKey) return
    refreshedKey.current = refreshKey
    load()
  }, [refreshKey, load])
  useEffect(() => {
    setBusy(undefined); setNotice(''); setOwnListing(undefined); requestIds.current.clear()
    return () => { write.current?.abort(); write.current = undefined }
  }, [accountScope, mode, profileUserId])
  useEffect(() => {
    if (mode !== 'people') return
    const controller = new AbortController()
    void callArkme<PublicPerson>('social.people.read', { accountScope }, controller.signal).then(value => { if (!controller.signal.aborted) setOwnListing(value) }).catch(() => {})
    return () => controller.abort()
  }, [accountScope, mode])
  const join = (group: PublicGroup) => {
    if (write.current || group.joinMode === 2 && group.joinRequest?.status === 1 && !group.hasJoined) return
    let requestUid = group.joinRequest?.status !== 3 ? group.joinRequest?.requestUid : undefined
    requestUid ??= requestIds.current.get(group.chatSessionUid)
    if (!requestUid || group.joinRequest?.status === 3 && requestUid === group.joinRequest.requestUid) requestUid = crypto.randomUUID()
    requestIds.current.set(group.chatSessionUid, requestUid)
    const controller = new AbortController(); write.current = controller; setBusy(group.chatSessionUid); setError(''); setNotice('')
    const operation = group.hasJoined ? 'social.groups.open' : 'social.groups.join'
    void callArkme<PublicGroupJoinResult | ArkmeSourceItem>(operation, { accountScope, chatSessionUid: group.chatSessionUid, ...(group.hasJoined ? {} : { requestUid }) }, controller.signal).then(async response => {
      if (controller.signal.aborted) return
      if (group.hasJoined) { if (activeRef.current) await onSourceActivated?.(response as ArkmeSourceItem); return }
      const result = response as PublicGroupJoinResult
      requestIds.current.delete(group.chatSessionUid)
      setGroups(items => items.map(item => item.chatSessionUid === group.chatSessionUid ? result.group : item))
      if (result.source) { if (activeRef.current) await onSourceActivated?.(result.source) }
      else setNotice(tr('入群申请已提交，可以刷新查看审批状态。'))
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)) }).finally(() => { if (write.current === controller) { write.current = undefined; if (!controller.signal.aborted) setBusy(undefined) } })
  }
  const chat = (person: PublicPerson) => {
    if (write.current || person.userId === currentUserId) return
    const controller = new AbortController(); write.current = controller; setBusy(person.userId); setError(''); setNotice('')
    void callArkme<ArkmeSourceItem>('social.people.chat', { accountScope, userId: person.userId }, controller.signal).then(async source => {
      if (!controller.signal.aborted && activeRef.current) await onSourceActivated?.(source)
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)) }).finally(() => { if (write.current === controller) { write.current = undefined; if (!controller.signal.aborted) setBusy(undefined) } })
  }
  const groupAction = (group: PublicGroup) => <button type="button" data-arkme-feedback="primary" style={{ ...s.button, ...s.primary, ...(busy !== undefined || group.joinMode === 2 && group.joinRequest?.status === 1 && !group.hasJoined ? s.disabled : {}) }} disabled={busy !== undefined || group.joinMode === 2 && group.joinRequest?.status === 1 && !group.hasJoined} onClick={() => join(group)}>{busy === group.chatSessionUid ? tr('处理中…') : tr(publicGroupJoinLabel(group))}</button>
  const personAction = (person: PublicPerson) => <button type="button" data-arkme-feedback="primary" style={{ ...s.button, ...s.primary, ...(busy !== undefined || person.userId === currentUserId ? s.disabled : {}) }} disabled={busy !== undefined || person.userId === currentUserId} onClick={() => chat(person)}>{busy === person.userId ? tr('正在打开…') : tr(person.userId === currentUserId ? '这是你' : '发消息')}</button>
  const selectedGroup = groups.find(g => g.chatSessionUid === selected), selectedPerson = people.find(p => p.userId === selected)
  const empty = mode === 'groups' ? groups.length === 0 : people.length === 0
  return <section style={{ ...s.root, ...(embedded ? { maxWidth: 'none', margin: 0, padding: '10px 0 0' } : {}) }} aria-label={tr(mode === 'groups' ? '公开群聊目录' : '找人聊聊')} data-arkme-public-social={mode}>
    <header style={{ ...s.header, ...(embedded ? { justifyContent: 'flex-end', maxWidth: 640 } : {}) }}>
      {onBack && <button type="button" style={s.button} onClick={onBack}>{tr(backLabel)}</button>}
      {!embedded && <h1 style={s.title}>{profileUserId ? tr('{v0}的公开群聊', { v0: profileName || tr('我') }) : tr(mode === 'groups' ? '公开群聊' : '找人聊聊')}</h1>}
      <div style={{ marginLeft: 'auto', ...s.actions }}>
        {!embedded && <button type="button" style={s.button} disabled={loading} onClick={() => load()}>{tr('刷新')}</button>}
        {mode === 'people' ? <button type="button" data-arkme-feedback="primary" style={{ ...s.button, ...s.primary }} onClick={() => setEditorOpen(true)}>{tr(ownListing?.isListed ? '管理我的展示' : '展示自己')}</button> : onCreateGroup && <button type="button" style={{ ...s.button, ...s.primary }} onClick={onCreateGroup}>{tr('创建群聊')}</button>}
      </div>
    </header>
    {!embedded && !profileUserId && onTabChange && <nav style={s.tabs} aria-label={tr('世界范围')}>{tabs.map(([key, label]) => <button type="button" key={key} style={{ ...s.tab, ...(key === mode ? s.selectedTab : {}) }} aria-current={key === mode ? 'page' : undefined} onClick={() => onTabChange(key)}>{tr(label)}</button>)}</nav>}
    <form style={{ ...s.search, ...(embedded ? { maxWidth: 640 } : {}) }} onSubmit={e => { e.preventDefault(); if (query === search.trim()) load(); else setQuery(search.trim()) }}>
      <input style={s.input} value={search} maxLength={100} aria-label={tr(mode === 'groups' ? '搜索公开群聊' : '搜索公开用户')} placeholder={tr(mode === 'groups' ? '搜索群名称或介绍' : '搜索昵称或聊天介绍')} onChange={e => setSearch(e.currentTarget.value)} />
      <button type="submit" style={s.button}>{tr('搜索')}</button>
    </form>
    {notice && <div role="status" style={s.notice}>{notice}</div>}
    {error && <div role="alert" style={{ ...s.notice, ...s.error }}><span>{error}</span><button type="button" style={{ ...s.button, marginLeft: 10 }} disabled={loading} onClick={() => load()}>{tr('刷新目录')}</button></div>}
    <div style={s.layout}>
      <div style={{ ...s.list, ...(embedded ? { flex: '0 1 640px' } : {}) }} aria-busy={loading}>
        {loading && empty && <p role="status" style={s.notice}>{tr('正在读取公开目录…')}</p>}
        {!loading && !error && empty && <p style={s.notice}>{tr(query ? '没有找到匹配的结果' : mode === 'groups' ? '暂时没有可展示的公开群聊' : '暂时没有用户公开展示，欢迎先展示自己')}</p>}
        {mode === 'groups' ? groups.map(group => <article key={group.chatSessionUid} style={{ ...s.row, ...(selected === group.chatSessionUid ? s.rowSelected : {}) }}>
          <span style={s.avatar} aria-hidden>群</span><div style={s.identity}><h2 style={s.name}>{group.title}</h2><p style={s.description}>{group.introduction || tr('暂无群介绍')}</p><div style={s.actions}><button type="button" style={s.button} onClick={() => setSelected(group.chatSessionUid)} aria-label={tr('查看群聊：{v0}', { v0: group.title })}>{tr('查看详情')}</button>{groupAction(group)}</div></div>
        </article>) : people.map(person => <article key={person.userId} style={{ ...s.row, ...(selected === person.userId ? s.rowSelected : {}) }}>
          <span style={s.avatar}>{person.avatarUrl ? <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (person.displayName || tr('即我用户')).slice(0, 1)}</span>
          <div style={s.identity}><h2 style={s.name}>{person.displayName || tr('即我用户')}</h2><p style={s.description}>{person.introduction || tr('愿意认识新朋友')}</p><div style={s.actions}><button type="button" style={s.button} onClick={() => setSelected(person.userId)} aria-label={tr('查看用户：{v0}', { v0: person.displayName || tr('即我用户') })}>{tr('查看详情')}</button>{personAction(person)}</div></div>
        </article>)}
        {hasMore && <button type="button" style={s.button} disabled={loading} onClick={() => load(cursor)}>{tr(loading ? '加载中…' : '加载更多')}</button>}
      </div>
      {(selectedGroup || selectedPerson) && <aside style={s.detail} aria-label={tr('公开资料详情')}><button type="button" style={{ ...s.button, float: 'right' }} onClick={() => setSelected(undefined)} aria-label={tr('关闭详情')}>×</button>
        {selectedGroup ? <><h2 style={s.name}>{selectedGroup.title}</h2><p style={s.description}>{selectedGroup.introduction || tr('暂无群介绍')}</p><p style={s.secondary}>{tr(selectedGroup.joinMode === 2 ? '加入此群需要审批' : '此群允许直接加入')}</p>{groupAction(selectedGroup)}{selectedGroup.joinRequest?.status === 1 && <p style={s.secondary}>{tr('申请正在等待审批，刷新后可查看最新状态。')}</p>}</> : selectedPerson && <><h2 style={s.name}>{selectedPerson.displayName || tr('即我用户')}</h2><p style={s.description}>{selectedPerson.introduction || tr('愿意认识新朋友')}</p><div style={s.actions}>{onOpenWorld && <button type="button" style={s.button} onClick={() => onOpenWorld(selectedPerson)}>{tr('看看 TA 的世界')}</button>}{personAction(selectedPerson)}<IdentityCopyLinkButton accountScope={accountScope} target={{ kind: 'person', userId: selectedPerson.userId }} label="复制个人链接" /></div></>}
      </aside>}
    </div>
    {editorOpen && active && <PublicPersonListingDialog accountScope={accountScope} onClose={() => setEditorOpen(false)} onSaved={person => { setOwnListing(person); load(); setNotice(tr(person.isListed ? '公开展示已保存' : '已下架我的展示')) }} />}
  </section>
}

export function PublicWorldGroups({ accountScope, userId, onOpen }: { accountScope: string; userId: number; onOpen(chatSessionUid?: string): void }) {
  useArkmeLocale()
  const [page, setPage] = useState<PublicGroupPage>(), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setPage(undefined); setError('')
    void callArkme<PublicGroupPage>('social.groups.query', { accountScope, userId }, controller.signal).then(value => { if (!controller.signal.aborted) setPage(value) }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)) })
    return () => controller.abort()
  }, [accountScope, userId, revision])
  return <section style={s.shelf} aria-label={tr('公开群聊')}><header style={{ ...s.header, marginBottom: 8 }}><h2 style={s.name}>{tr('公开群聊')}</h2><button type="button" style={{ ...s.button, marginLeft: 'auto' }} onClick={() => onOpen()}>{tr('查看全部')}</button></header>
    {!page && !error && <p role="status" style={s.secondary}>{tr('正在读取公开群聊…')}</p>}
    {error && <p role="alert" style={s.secondary}>{error} <button type="button" style={s.button} onClick={() => setRevision(v => v + 1)}>{tr('重试')}</button></p>}
    {page && page.items.length === 0 && <p style={s.secondary}>{tr('暂时没有可展示的公开群聊')}</p>}
    {page?.items.slice(0, 3).map(group => <button type="button" key={group.chatSessionUid} style={{ ...s.button, display: 'block', width: '100%', textAlign: 'left', marginTop: 8 }} onClick={() => onOpen(group.chatSessionUid)}>{group.title}</button>)}
  </section>
}
