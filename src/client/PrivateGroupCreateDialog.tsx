import { useEffect, useRef, useState } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { PRIVATE_GROUP_MAX_PEOPLE, type PrivateGroupContext, type PrivateGroupPeoplePage, type PrivateGroupPerson, type PrivateGroupMatch, type PrivateGroupCreateInput, type PrivateGroupCreateResult } from '../private-group-create-contract.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { tr, useArkmeLocale } from './locale.js'
import { publicSocialStyles as s } from './public-social-styles.js'
import { arkmeTheme as t } from './arkme-theme.js'

type Props = { accountScope: string; source: ArkmeSourceItem; onClose(): void; onCreated(source: ArkmeSourceItem): void | Promise<void> }
type Check = { key: string; status: 'checking' } | { key: string; status: 'ready'; matches: PrivateGroupMatch[] } | { key: string; status: 'failed'; message: string }
const message = (error: unknown) => error instanceof Error ? error.message : tr('操作失败，请重试')

export function PrivateGroupCreateDialog(props: Props) {
  return <PrivateGroupCreateForm key={`${props.accountScope}:${props.source.sourceRef}`} {...props} />
}

function PrivateGroupCreateForm({ accountScope, source, onClose, onCreated }: Props) {
  useArkmeLocale()
  const [context, setContext] = useState<PrivateGroupContext>()
  const [people, setPeople] = useState<PrivateGroupPerson[]>([]), [selected, setSelected] = useState<PrivateGroupPerson[]>([])
  const [query, setQuery] = useState(''), [title, setTitle] = useState(''), [isPublic, setPublic] = useState(true)
  const [loading, setLoading] = useState(true), [peopleError, setPeopleError] = useState(''), [peopleIncomplete, setPeopleIncomplete] = useState(false)
  const [revision, setRevision] = useState(0), [checkRevision, setCheckRevision] = useState(0), [check, setCheck] = useState<Check>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [frozen, setFrozen] = useState(false)
  const [duplicateConsentRequired, setDuplicateConsentRequired] = useState(false)
  const [uncheckedConsentRequired, setUncheckedConsentRequired] = useState(false)
  const write = useRef<AbortController>(), locked = useRef(false), requestUid = useRef(crypto.randomUUID())
  const attempt = useRef<PrivateGroupCreateInput>(), created = useRef<ArkmeSourceItem>()
  const base = { accountScope, sourceRef: source.sourceRef }
  const selectionKey = JSON.stringify(selected.map(person => person.personRef).sort())
  const suggestedTitle = [context?.peerName ?? source.displayName, ...selected.map(person => person.displayName)].join('、')
  const effectiveTitle = title.trim() || Array.from(suggestedTitle).slice(0, 80).join('')

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setPeopleError(''); setPeopleIncomplete(false)
    void callArkme<PrivateGroupContext>('group.private.context', base, controller.signal).then(value => { if (!controller.signal.aborted) setContext(value) })
      .catch(e => { if (!controller.signal.aborted) setPeopleError(message(e)) })
    void (async () => {
      let cursor: string | undefined
      const visited = new Set<string>()
      for (let page = 0; page < 40; page++) {
        const result = await callArkme<PrivateGroupPeoplePage>('group.private.people', { ...base, ...(cursor ? { cursor } : {}) }, controller.signal)
        if (controller.signal.aborted) return
        setPeople(old => page === 0 ? result.items : [...old, ...result.items.filter(person => !old.some(v => v.personRef === person.personRef))])
        if (!result.hasMore) { setPeopleIncomplete(result.incomplete); return }
        if (!result.nextCursor || visited.has(result.nextCursor)) throw new Error(tr('联系人列表未加载完整，请刷新重试'))
        visited.add(result.nextCursor); cursor = result.nextCursor
      }
      setPeopleIncomplete(true)
    })().catch(e => { if (!controller.signal.aborted) setPeopleError(message(e)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [accountScope, source.sourceRef, revision])
  useEffect(() => () => { write.current?.abort() }, [])
  useEffect(() => {
    if (selected.length === 0) { setCheck(undefined); return }
    const controller = new AbortController()
    setCheck({ key: selectionKey, status: 'checking' })
    const timer = setTimeout(() => {
      void callArkme<PrivateGroupMatch[]>('group.private.matches', { ...base, personRefs: selected.map(person => person.personRef) }, controller.signal)
        .then(matches => { if (!controller.signal.aborted) setCheck({ key: selectionKey, status: 'ready', matches }) })
        .catch(e => { if (!controller.signal.aborted) setCheck({ key: selectionKey, status: 'failed', message: message(e) }) })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [accountScope, source.sourceRef, selectionKey, checkRevision])

  const currentCheck = check?.key === selectionKey ? check : undefined
  const matches = currentCheck?.status === 'ready' ? currentCheck.matches : []
  const checking = selected.length > 0 && (currentCheck === undefined || currentCheck.status === 'checking')
  const disabled = !context || selected.length === 0 || checking || Array.from(effectiveTitle).length > 80 || effectiveTitle === ''
  const primaryLabel = created.current ? '打开已创建的群' : duplicateConsentRequired ? '仍然新建群聊' : uncheckedConsentRequired ? '仍然创建群聊' : frozen ? '重试确认创建结果' : matches.length > 0 ? '仍然新建群聊' : currentCheck?.status === 'failed' ? '仍然创建群聊' : '创建群聊'
  const open = async (target: ArkmeSourceItem) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    const controller = new AbortController(); write.current = controller
    try { await onCreated(target); if (!controller.signal.aborted) onClose() }
    catch (e) { if (!controller.signal.aborted) setError(message(e)) }
    finally { if (write.current === controller) { locked.current = false; if (!controller.signal.aborted) setBusy(false) } }
  }
  const submit = () => {
    if (locked.current || disabled) return
    if (created.current) { void open(created.current); return }
    const input: PrivateGroupCreateInput = frozen && attempt.current ? { ...attempt.current, ...(duplicateConsentRequired ? { allowDuplicate: true } : {}), ...(uncheckedConsentRequired ? { allowUnchecked: true } : {}) } : {
      ...base, personRefs: selected.map(person => person.personRef), title: effectiveTitle, isPublic, clientMutationId: requestUid.current,
      allowDuplicate: matches.length > 0, allowUnchecked: currentCheck?.status === 'failed',
    }
    attempt.current = input
    const controller = new AbortController(); write.current = controller; locked.current = true; setBusy(true); setError(''); setNotice(''); setDuplicateConsentRequired(false); setUncheckedConsentRequired(false)
    void callArkme<PrivateGroupCreateResult>('group.private.create', { ...input }, controller.signal).then(async result => {
      if (controller.signal.aborted) return
      if (result.status === 'matches') {
        setCheck({ key: selectionKey, status: 'ready', matches: result.matches }); setDuplicateConsentRequired(true); setNotice(tr('发现已有群聊，可以直接打开，也可以选择另建。')); return
      }
      created.current = result.source; setFrozen(true)
      await onCreated(result.source)
      if (!controller.signal.aborted) onClose()
    }).catch(e => {
      if (controller.signal.aborted) return
      const code = (e as { body?: { code?: string } })?.body?.code
      if (code === 'group-create-outcome-unknown') setFrozen(true)
      if (code === 'private-group-check-failed') { setCheck({ key: selectionKey, status: 'failed', message: message(e) }); setUncheckedConsentRequired(true) }
      setError(message(e))
    }).finally(() => { if (write.current === controller) { locked.current = false; if (!controller.signal.aborted) setBusy(false) } })
  }
  const toggle = (person: PrivateGroupPerson) => {
    if (busy || frozen) return
    setSelected(old => old.some(p => p.personRef === person.personRef) ? old.filter(p => p.personRef !== person.personRef) : old.length >= PRIVATE_GROUP_MAX_PEOPLE - 2 ? old : [...old, person])
    setNotice(''); setError(''); setDuplicateConsentRequired(false); setUncheckedConsentRequired(false)
  }
  const filtered = people.filter(person => (person.searchText || person.displayName).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const chip = (name: string, avatarRef?: string, person?: PrivateGroupPerson) => <span key={person?.personRef ?? name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: t.layer2, borderRadius: 20, maxWidth: '100%' }}>
    <ArkmeUserAvatar avatarRef={avatarRef} {...(person?.avatarFallback ? { fallback: person.avatarFallback } : {})} size={24} /><span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{name}</span>
    {person && <button type="button" style={{ border: 0, background: 'transparent', color: t.secondary, cursor: 'pointer' }} aria-label={tr('移除 {v0}', { v0: name })} disabled={busy || frozen} onClick={() => toggle(person)}>×</button>}
  </span>

  return <ArkmeConfirmDialog titleId="arkme-private-group-title" title={tr('发起群聊')} description={tr('已带入你和当前私聊对象，再选择至少一人即可建群。新成员从新群开始聊天。')}
    dialogStyle={{ width: 'min(780px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }} busy={busy} error={error} onClose={onClose}
    confirmLabel={tr(primaryLabel)} busyLabel={tr('正在处理…')} confirmDisabled={disabled} onConfirm={submit}>
    <div style={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', marginTop: 4 }}>
    <div style={{ ...s.actions, margin: '16px 0 20px' }}>{chip(tr('我'))}{chip(context?.peerName ?? source.displayName, context?.peerAvatarRef)}{selected.map(person => chip(person.displayName, person.avatarRef, person))}<span style={s.secondary}>{tr('已选 {v0} 人', { v0: selected.length + 2 })}</span></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
      <section style={{ flex: '1 1 290px', minWidth: 0 }} aria-label={tr('选择群成员')}>
        <input style={s.input} aria-label={tr('搜索联系人或最近聊天')} placeholder={tr('搜索联系人或最近聊天')} value={query} disabled={busy || frozen} onChange={event => setQuery(event.currentTarget.value)} />
        <div style={{ maxHeight: 310, overflowY: 'auto', marginTop: 10 }} aria-busy={loading}>
          {filtered.map(person => {
            const checked = selected.some(p => p.personRef === person.personRef)
            return <button type="button" key={person.personRef} aria-label={tr('选择成员：{v0}', { v0: person.displayName })} aria-pressed={checked} disabled={busy || frozen || !checked && selected.length >= PRIVATE_GROUP_MAX_PEOPLE - 2} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 8px', border: 0, borderRadius: 8, background: checked ? t.accentSoft : 'transparent', color: t.text, cursor: 'pointer', font: 'inherit', fontSize: 14 }} onClick={() => toggle(person)}>
              <ArkmeUserAvatar avatarRef={person.avatarRef} {...(person.avatarFallback ? { fallback: person.avatarFallback } : {})} size={32} /><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{person.displayName}</span><span aria-hidden>{checked ? '✓' : '○'}</span>
            </button>
          })}
          {loading && <p role="status" style={s.secondary}>{tr('正在读取联系人和最近聊天…')}</p>}
          {!loading && filtered.length === 0 && <p style={s.secondary}>{tr(peopleError || peopleIncomplete ? '已加载的联系人中没有匹配结果' : '没有找到匹配的联系人')}</p>}
          {(peopleError || peopleIncomplete) && <p role="status" style={s.secondary}>{peopleError || tr('部分联系人暂未加载完整')} <button type="button" style={s.button} disabled={busy || frozen} onClick={() => setRevision(v => v + 1)}>{tr('刷新联系人')}</button></p>}
        </div>
      </section>
      <section style={{ flex: '1 1 290px', minWidth: 0, padding: 14, border: `1px solid ${t.borderSoft}`, borderRadius: 12, background: t.layer1 }} aria-label={tr('已有群聊检查')}>
        <h3 style={s.name}>{tr('已有群聊')}</h3>
        {selected.length === 0 && <p style={s.secondary}>{tr('选择其他成员后，检查是否已有相同成员的群。')}</p>}
        {checking && <p role="status" style={s.secondary}>{tr('正在检查已有群聊…')}</p>}
        {currentCheck?.status === 'failed' && <div role="alert"><p style={{ ...s.secondary, color: t.danger }}>{tr('已有群聊尚未检查完整')}</p><p style={s.secondary}>{currentCheck.message}</p><button type="button" style={s.button} disabled={busy} onClick={() => { setUncheckedConsentRequired(false); setError(''); setCheckRevision(v => v + 1) }}>{tr('重新检查')}</button><p style={s.secondary}>{tr('你也可以选择仍然创建群聊。')}</p></div>}
        {currentCheck?.status === 'ready' && matches.length === 0 && <p role="status" style={s.secondary}>{tr('未找到包含全部已选成员的已有群聊')}</p>}
        <div style={{ maxHeight: 230, overflowY: 'auto' }}>{matches.map(match => <article key={match.source.sourceRef} style={{ padding: '12px 0', borderBottom: `1px solid ${t.borderSoft}` }}>
          <strong style={s.name}>{match.source.displayName}</strong><p style={s.secondary}>{tr(match.kind === 'exact' ? '成员完全相同 · {v0} 人' : '包含全部已选成员，另有 {v0} 人', { v0: match.kind === 'exact' ? match.memberCount : match.extraCount })}</p>
          <button type="button" style={{ ...s.button, ...s.primary }} disabled={busy} onClick={() => { void open(match.source) }}>{tr('打开群聊')}</button>
        </article>)}</div>
        {notice && <p role="status" style={s.secondary}>{notice}</p>}
      </section>
    </div>
    <label style={s.label}>{tr('群聊名称（可选）')}<input style={s.input} aria-label={tr('群聊名称')} value={title} placeholder={suggestedTitle} disabled={busy || frozen} maxLength={160} onChange={event => setTitle(event.currentTarget.value)} /></label>
    <label style={s.check}><input type="checkbox" checked={isPublic} disabled={busy || frozen} onChange={event => setPublic(event.currentTarget.checked)} />{tr('公开群聊')}</label>
    {frozen && !created.current && <p role="status" style={s.secondary}>{tr('创建结果待确认，重试将沿用本次成员和请求，不会另起一次创建。')}</p>}
    </div>
  </ArkmeConfirmDialog>
}
