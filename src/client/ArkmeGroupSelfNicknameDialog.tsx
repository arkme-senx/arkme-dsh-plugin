import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useRef, useState } from 'react'
import type { ArkmeGroupSelfNickname, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeConversationMembers } from './conversation-members-store.js'
import { arkmeTheme } from './arkme-theme.js'

export function ArkmeGroupSelfNicknameDialog(props: {
  source: ArkmeSourceItem
  accountScope: string | undefined
  onClose: () => void
  onSaved: () => void
}) {
  useArkmeLocale()
  const [nickname, setNickname] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const pending = useRef(false)
  const lifetime = useRef<AbortController>()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    setLoading(true)
    setError('')
    void callArkme<ArkmeGroupSelfNickname>('group.self-nickname', { sourceRef: props.source.sourceRef }, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setNickname(result.nickname); setLoaded(true)
      })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '读取失败，请重试') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [props.source.sourceRef, props.accountScope, attempt])
  useEffect(() => { if (loaded) input.current?.focus() }, [loaded])
  const value = nickname.trim()
  const valid = value.length > 0 && [...value].length <= 10
  const save = async () => {
    if (!loaded || !valid || pending.current) return
    const controller = lifetime.current
    if (!controller || controller.signal.aborted) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await callArkme<ArkmeGroupSelfNickname>('group.self-nickname.set', {
        sourceRef: props.source.sourceRef, nickname: value,
      }, controller.signal)
      if (controller.signal.aborted) return
      arkmeConversationMembers.patchSelfNickname(props.accountScope, props.source, result.memberRef, result.nickname)
      props.onSaved(); props.onClose()
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试')
    } finally {
      pending.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return <ArkmeConfirmDialog titleId="arkme-group-self-nickname-title" title={tr("修改我在本群聊的昵称")}
    description={tr("仅在当前群聊中使用，最多10个字。")} confirmLabel={tr("保存")} busyLabel={tr("保存中…")}
    busy={busy} confirmDisabled={!loaded || !valid || loading} error={error} onClose={props.onClose} onConfirm={() => { void save() }}>
    {loading && <p role="status">{tr("正在读取昵称…")}</p>}
    {!loading && !loaded && <button data-arkme-feedback="neutral" type="button" onClick={() => { setAttempt(current => current + 1) }}>{tr("重试")}</button>}
    {loaded && <><input ref={input} aria-label={tr("我在本群聊的昵称")} value={nickname} disabled={busy}
      aria-describedby="arkme-group-self-nickname-count" aria-invalid={!valid}
      style={{ width: '100%', boxSizing: 'border-box', marginTop: 16, padding: '10px 12px', borderRadius: 8,
        border: '1px solid ' + arkmeTheme.border, background: arkmeTheme.layer1, color: arkmeTheme.text, font: 'inherit' }}
      onChange={event => { setNickname(event.target.value); setError('') }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save() } }}
    /><p id="arkme-group-self-nickname-count" style={{ margin: '6px 0 0', fontSize: 12, color: arkmeTheme.secondary }}>
      {[...value].length}/10{value === '' ? ' · 昵称不能为空' : [...value].length > 10 ? ' · 昵称不能超过10个字' : ''}
    </p></>}
  </ArkmeConfirmDialog>
}
