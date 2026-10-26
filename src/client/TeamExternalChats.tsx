import { useEffect, useRef, useState } from 'react'
import type { ArkmeTeam } from '../types.js'
import type { ExternalChatDirectory, ExternalChatShare } from '../team-external-chat-contract.js'
import { callArkme } from './api.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'
import { tr, useArkmeLocale } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { saveExternalChatWithDeadline as saveWithDeadline, externalChatWriteUncertain as shareResultUncertain } from './team-external-chat-request.js'
export { TeamExternalChats } from './TeamExternalChatBrowser.js'

const failure = (error: unknown) => error instanceof Error ? error.message : '加载失败，请重试'
const teamKey = (team: ArkmeTeam) => team.key ?? team.teamRef
const sharedWith = (share: ExternalChatShare, team: ArkmeTeam) => team.key ? share.teamKey === team.key : share.teamRef === team.teamRef

export function SharePrivateChat(props: {sourceRef: string; name: string; onClose(): void}) {
  return <ScopedSharePrivateChat key={props.sourceRef} {...props}/>
}
function ScopedSharePrivateChat({sourceRef, name, onClose}: {sourceRef: string; name: string; onClose(): void}) {
  useArkmeLocale()
  const [teams, setTeams] = useState<ArkmeTeam[]>([])
  const [shares, setShares] = useState<ExternalChatShare[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const [error, setError] = useState('')
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const request = useRef<AbortController>()
  const savingRef = useRef(false)
  async function load() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setReady(false); setError(''); setSaveErrors({}); setSaved(false)
    try {
      const [teams, shares] = await withArkmeReadDeadline(signal => Promise.all([
        callArkme<ArkmeTeam[]>('team.app.teams', {}, signal),
        callArkme<ExternalChatDirectory>('team.app.external.mine', {sourceRef}, signal),
      ]), controller.signal)
      if (!controller.signal.aborted) {
        setTeams(teams); setShares(shares.items)
        setSelected(new Set(teams.filter(team => shares.items.some(share => sharedWith(share, team))).map(teamKey)))
        setReady(true); setNeedsReload(false)
      }
    } catch (error) {if (!controller.signal.aborted) setError(failure(error))}
    finally {if (!controller.signal.aborted) setLoading(false)}
  }
  useEffect(() => {void load(); return () => request.current?.abort()}, [sourceRef])
  const changes = teams.filter(team => selected.has(teamKey(team)) !== shares.some(share => sharedWith(share, team)))
  const additions = changes.filter(team => selected.has(teamKey(team))).length
  async function save() {
    if (savingRef.current || needsReload || !ready || !changes.length) return
    savingRef.current = true
    const controller = new AbortController()
    request.current = controller
    setSaving(true); setSaved(false); setSaveErrors({})
    const failures: Record<string, string> = {}
    try {
      for (const team of changes) {
        if (controller.signal.aborted) return
        const existing = shares.find(share => sharedWith(share, team))
        try {
          if (existing) {
            await saveWithDeadline(signal => callArkme('team.app.external.unshare', {shareRef: existing.ref}, signal), controller.signal)
            if (!controller.signal.aborted) setShares(values => values.filter(value => value.key !== existing.key))
          } else {
            const next = await saveWithDeadline(signal => callArkme<ExternalChatDirectory>('team.app.external.share', {teamRef: team.teamRef, sourceRef}, signal), controller.signal)
            if (!controller.signal.aborted) setShares(values => [...values.filter(share => !sharedWith(share, team)), ...next.items])
          }
          if (!controller.signal.aborted) setHasSaved(true)
        } catch (error) {
          if (controller.signal.aborted) return
          if (shareResultUncertain(error)) {
            failures[teamKey(team)] = tr('保存结果尚未确认，请重新加载后核对。')
            setNeedsReload(true)
            break
          }
          failures[teamKey(team)] = failure(error)
        }
      }
      if (!controller.signal.aborted) {setSaveErrors(failures); setSaved(Object.keys(failures).length === 0)}
    } finally {
      savingRef.current = false
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  const failed = Object.keys(saveErrors).length > 0
  return <TeamFeatureDialog className="arkme-team-external-dialog arkme-private-chat-share-dialog" title={tr('共享到团队')} teamName={name} onClose={onClose} busy={saving}
    footer={<>
      <span className="arkme-private-chat-share-summary" role="status">{saving ? tr('正在保存…') : needsReload ? tr('保存结果待核对') : saved ? tr('共享设置已更新') : ready ? tr('已共享到 {count} 个团队', {count: shares.length}) : ''}</span>
      {!saved && <button type="button" className="arkme-contact-remark-cancel" disabled={saving} onClick={onClose}>{tr(hasSaved || needsReload ? '关闭' : '取消')}</button>}
      <button type="button" className="arkme-contact-remark-confirm" disabled={saving || loading || (!needsReload && !saved && (!ready || !changes.length))} onClick={() => needsReload ? void load() : saved ? onClose() : void save()}>
        {tr(saving ? '保存中…' : needsReload ? '重新加载' : saved ? '完成' : failed ? '重试保存' : additions ? '确认共享' : '保存更改')}
      </button>
    </>}>
    <p className="arkme-private-chat-share-disclosure">{tr('团队成员可只读查看全部历史和新消息。')}</p>
    {error && <p className="arkme-private-chat-share-error" role="alert">{error} <button type="button" onClick={() => void load()}>{tr('重试')}</button></p>}
    {loading && <p className="arkme-private-chat-share-empty" role="status">{tr('正在加载团队…')}</p>}
    {ready && !teams.length && <p className="arkme-private-chat-share-empty">{tr('你尚未加入团队')}</p>}
    {ready && teams.length > 0 && <fieldset className="arkme-private-chat-share-teams" disabled={saving || needsReload}>
      <legend>{tr('选择团队')}</legend>
      {teams.map(team => {
        const key = teamKey(team), checked = selected.has(key), shared = shares.some(share => sharedWith(share, team))
        return <label key={key} className="arkme-private-chat-share-team" data-selected={checked}>
          <input type="checkbox" checked={checked} onChange={() => {
            if (savingRef.current || needsReload) return
            setSelected(values => {const next = new Set(values); if (next.has(key)) next.delete(key); else next.add(key); return next})
            setSaved(false); setSaveErrors({})
          }}/>
          <span className="arkme-private-chat-share-avatar" aria-hidden="true">{[...team.name][0]}</span>
          <span className="arkme-private-chat-share-name">{team.name}</span>
          <span className="arkme-private-chat-share-state">{tr(checked ? shared ? '已共享' : '待共享' : shared ? '待取消' : '未共享')}</span>
        </label>
      })}
    </fieldset>}
    {failed && <div className="arkme-private-chat-share-error" role="alert">
      <p>{tr(hasSaved ? '部分更改已保存，请重试未成功的团队。' : '未能保存更改，请重试。')}</p>
      {teams.filter(team => saveErrors[teamKey(team)]).map(team => <p key={teamKey(team)}>{team.name}：{saveErrors[teamKey(team)]}</p>)}
    </div>}
  </TeamFeatureDialog>
}
