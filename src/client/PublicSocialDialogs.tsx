import { useEffect, useRef, useState } from 'react'
import type { PublicGroupSettings, PublicPerson } from '../public-social-contract.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr, useArkmeLocale } from './locale.js'
import { publicSocialStyles as s } from './public-social-styles.js'

function message(error: unknown): string { return error instanceof Error ? error.message : tr('操作失败，请重试') }

export function PublicPersonListingDialog({ accountScope, onClose, onSaved }: { accountScope: string; onClose(): void; onSaved(person: PublicPerson): void }) {
  useArkmeLocale()
  const [person, setPerson] = useState<PublicPerson>()
  const [introduction, setIntroduction] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const request = useRef<AbortController>(), write = useRef<AbortController>(), locked = useRef(false)
  useEffect(() => {
    const controller = new AbortController(); request.current = controller; setLoading(true); setError('')
    void callArkme<PublicPerson>('social.people.read', { accountScope }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setPerson(value); setIntroduction(value.introduction)
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); write.current?.abort() }
  }, [accountScope, revision])
  const save = (listed: boolean) => {
    if (locked.current || loading || !person) return
    const controller = new AbortController(); write.current = controller; locked.current = true; setBusy(true); setError('')
    void callArkme<PublicPerson>('social.people.listing.set', { accountScope, isListed: listed, introduction }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      onSaved(value); onClose()
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) }).finally(() => { locked.current = false; if (!controller.signal.aborted) setBusy(false) })
  }
  return <ArkmeConfirmDialog titleId="arkme-public-person-title" title={tr('我的公开展示')} busy={busy} error={error} onClose={onClose}
    description={tr('展示后，其他用户可以在“找人聊聊”中找到你并发起私聊。你可以随时下架。')}
    confirmLabel={tr(person?.isListed ? '保存修改' : '展示自己')} busyLabel={tr('保存中…')} confirmDisabled={loading || !person || Array.from(introduction).length > 500} onConfirm={() => save(true)}>
    {loading ? <p role="status" style={s.secondary}>{tr('正在读取公开资料…')}</p> : person ? <>
      <p style={s.secondary}>{person.displayName || tr('使用当前账号的公开昵称和头像')}</p>
      <label style={s.label}>{tr('聊天介绍（选填）')}<textarea aria-label={tr('聊天介绍')} style={s.textarea} value={introduction} disabled={busy} maxLength={1000} onChange={e => setIntroduction(e.currentTarget.value)} placeholder={tr('想聊什么，或者愿意分享什么？')} /></label>
      <p style={{ ...s.secondary, textAlign: 'right' }}>{Array.from(introduction).length}/500</p>
      {person.isListed && <button type="button" data-arkme-feedback="neutral" style={s.button} disabled={busy} onClick={() => save(false)}>{tr('下架我的展示')}</button>}
    </> : <button type="button" style={s.button} onClick={() => setRevision(v => v + 1)}>{tr('重试')}</button>}
  </ArkmeConfirmDialog>
}

export function PublicGroupSettingsDialog({ accountScope, sourceRef, onClose, onSaved }: { accountScope: string; sourceRef: string; onClose(): void; onSaved?(): void }) {
  useArkmeLocale()
  const [settings, setSettings] = useState<PublicGroupSettings>()
  const [isPublic, setPublic] = useState(false), [isShown, setShown] = useState(false), [introduction, setIntroduction] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const write = useRef<AbortController>(), locked = useRef(false)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('')
    void callArkme<PublicGroupSettings>('social.groups.settings', { accountScope, sourceRef }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setSettings(value); setPublic(value.isPublic); setShown(value.isShown); setIntroduction(value.introduction)
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); write.current?.abort() }
  }, [accountScope, sourceRef, revision])
  const save = () => {
    if (!settings || loading || locked.current) return
    const controller = new AbortController(); write.current = controller; locked.current = true; setBusy(true); setError('')
    const operation = settings.canManage ? 'social.groups.settings.set' : 'social.groups.showcase.set'
    void callArkme<PublicGroupSettings>(operation, { accountScope, sourceRef, ...(settings.canManage ? { isPublic, introduction } : { isShown }) }, controller.signal).then(() => {
      if (!controller.signal.aborted) { onSaved?.(); onClose() }
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) }).finally(() => { locked.current = false; if (!controller.signal.aborted) setBusy(false) })
  }
  return <ArkmeConfirmDialog titleId="arkme-public-group-title" title={tr('公开与展示')} busy={busy} error={error} onClose={onClose}
    description={tr('公开群资料可被其他用户发现。聊天记录仍遵循原有权限。')} confirmLabel={tr('保存')} busyLabel={tr('保存中…')}
    confirmDisabled={loading || !settings || (!settings.canManage && !settings.isPublic) || Array.from(introduction).length > 500} onConfirm={save}>
    {loading ? <p role="status" style={s.secondary}>{tr('正在读取群公开设置…')}</p> : settings ? settings.canManage ? <>
      <label style={s.check}><input type="checkbox" checked={isPublic} disabled={busy} onChange={e => setPublic(e.currentTarget.checked)} />{tr('公开群聊')}</label>
      <p style={s.secondary}>{tr('公开后会出现在群聊目录和你创建的公开群中。')}</p>
      <label style={s.label}>{tr('群介绍（选填）')}<textarea aria-label={tr('群介绍')} style={s.textarea} value={introduction} disabled={busy} maxLength={1000} onChange={e => setIntroduction(e.currentTarget.value)} /></label>
      <p style={{ ...s.secondary, textAlign: 'right' }}>{Array.from(introduction).length}/500</p>
    </> : <>
      <label style={s.check}><input type="checkbox" checked={isShown} disabled={busy || !settings.isPublic} onChange={e => setShown(e.currentTarget.checked)} />{tr('在我的世界展示此群')}</label>
      <p style={s.secondary}>{tr(settings.isPublic ? '其他人可以从你的世界发现并申请加入此群。' : '此群目前未公开，公开后才可以展示在个人世界。')}</p>
    </> : <button type="button" style={s.button} onClick={() => setRevision(v => v + 1)}>{tr('重试')}</button>}
  </ArkmeConfirmDialog>
}
