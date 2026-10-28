import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeSourceItem, ArkmeTeam } from '../types.js'
import type { TeamGroupPending } from '../team-group-contract.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { TeamGroupPendingNotice } from './TeamGroupControls.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'

type Target = { mode: 'create'; teamJotmoId: string } | { mode: 'link'; source: ArkmeSourceItem }
type Props = { accountKey: string; target: Target; onClose(): void }
const errorText = (error: unknown) => error instanceof Error ? error.message : tr('加载失败，请重试')

export function TeamInternalGroupDialog(props: Props) {
  return <ScopedDialog key={JSON.stringify([props.accountKey, props.target.mode,
    props.target.mode === 'create' ? props.target.teamJotmoId : props.target.source.sourceRef])} {...props} />
}

function ScopedDialog({ accountKey, target, onClose }: Props) {
  useArkmeLocale()
  const [teams, setTeams] = useState<ArkmeTeam[]>(), [teamId, setTeamId] = useState(''), [name, setName] = useState('')
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inFlight = useRef<AbortController>(), requestUid = useRef('')
  useEffect(() => () => inFlight.current?.abort(), [])
  // Disabling the clicked footer button can send browser focus to <body>.
  // Retain focus inside the dialog so Escape/Tab still work during the request.
  useEffect(() => { if (busy || pending) bodyRef.current?.focus({ preventScroll: true }) }, [busy, pending])
  const requestedTeam = target.mode === 'create' ? target.teamJotmoId : undefined
  useEffect(() => {
    const controller = new AbortController()
    setLoadError('')
    void callArkme<ArkmeTeam[]>('team.app.teams', { expectedAccountKey: accountKey }, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (!Array.isArray(result)) throw new Error(tr('团队状态返回异常，请重试'))
      const selected = requestedTeam ? result.find(team => team.jotmoId === requestedTeam) : result.length === 1 ? result[0] : undefined
      if (requestedTeam && !selected) throw new Error(tr('当前团队已不可访问'))
      setTeams(result)
      if (selected) { setTeamId(selected.jotmoId); if (requestedTeam) setName(current => current || tr('{v0}内部群', { v0: selected.name })) }
    }).catch(caught => { if (!controller.signal.aborted) setLoadError(errorText(caught)) })
    return () => controller.abort()
  }, [accountKey, requestedTeam, revision])
  const team = teams?.find(value => value.jotmoId === teamId)
  const canManage = team?.currentUserRole === 'owner' || team?.currentUserRole === 'admin'
  const disabled = !team || !canManage || !!loadError || busy || pending || (target.mode === 'create' && !name.trim())
  const reset = () => { requestUid.current = ''; setPending(false); setError('') }
  const prepare = async () => {
    if (disabled || !team || inFlight.current) return
    const controller = new AbortController(); inFlight.current = controller
    requestUid.current ||= crypto.randomUUID()
    setBusy(true); setError('')
    try {
      const result = await callArkme<TeamGroupPending>('team.app.internal-group.prepare', {
        expectedAccountKey: accountKey, teamRef: team.teamRef, requestUid: requestUid.current, mode: target.mode,
        ...(target.mode === 'create' ? { name: name.trim() } : { sourceRef: target.source.sourceRef }),
      }, controller.signal)
      if (controller.signal.aborted) return
      if (result.state !== 'backend_pending') throw new Error(tr('内部群状态返回异常，请重试'))
      setPending(true)
    } catch (caught) { if (!controller.signal.aborted) setError(errorText(caught)) }
    finally { if (inFlight.current === controller) inFlight.current = undefined; if (!controller.signal.aborted) setBusy(false) }
  }
  return <TeamFeatureDialog title={tr(target.mode === 'create' ? '创建团队内部群' : '关联为团队内部群')}
    teamName={target.mode === 'link' ? target.source.displayName : team?.name ?? tr('团队')} onClose={onClose}
    footer={<button type="button" disabled={disabled} style={{ opacity: disabled ? .5 : 1, cursor: disabled ? 'default' : 'pointer' }} onClick={() => { void prepare() }}>
      {tr(busy ? '正在检查…' : target.mode === 'create' ? '检查创建条件' : '查看关联影响')}
    </button>}>
    <div ref={bodyRef} tabIndex={-1} style={styles.body}>
      <p style={styles.copy}>{tr('成员随团队自动同步：加入团队后自动入群，离开团队后自动移出。')}</p>
      <p style={styles.copy}>{tr('群内按本人身份发言，不需要选择个人或团队身份。')}</p>
      {!teams && !loadError && <p role="status">{tr('正在加载我的团队…')}</p>}
      {loadError && <p role="alert">{loadError} <button type="button" onClick={() => setRevision(value => value + 1)}>{tr('重试')}</button></p>}
      {teams && target.mode === 'link' && <label style={styles.label}>{tr('关联团队')}
        <select style={styles.input} value={teamId} disabled={busy} onChange={event => { setTeamId(event.target.value); reset() }}>
          <option value="">{tr('请选择团队')}</option>
          {teams.map(value => <option key={value.jotmoId} value={value.jotmoId}>{value.name}</option>)}
        </select>
      </label>}
      {teams?.length === 0 && <p>{tr('你尚未加入团队')}</p>}
      {team && target.mode === 'create' && <label style={styles.label}>{tr('群名称')}
        <input style={styles.input} value={name} maxLength={120} disabled={busy} onChange={event => { setName(event.target.value); reset() }} />
      </label>}
      {team && !canManage && <p role="status">{tr('仅团队所有者或管理员可创建或关联内部群。')}</p>}
      <p style={styles.copy}>{tr(target.mode === 'link'
        ? '确认关联前，将先展示需新增、移出的成员和历史消息可见范围，再由你确认。'
        : '创建前会核对团队成员范围与权限；创建成功后不需要再手动维护群成员。')}</p>
      <TeamGroupPendingNotice>{tr(pending
        ? target.mode === 'create' ? '尚未创建群聊，当前填写内容已保留。' : '尚未关联团队，原群成员和历史消息保持不变。'
        : '目前无法取得成员变更预览，不能创建或关联内部群。')}</TeamGroupPendingNotice>
      {error && <p role="alert" style={{ color: arkmeTheme.danger }}>{error}</p>}
    </div>
  </TeamFeatureDialog>
}

const styles: Record<string, CSSProperties> = {
  body: { display: 'grid', gap: 14, padding: 20, fontSize: 13, outline: 'none' },
  copy: { margin: 0, color: arkmeTheme.secondary, lineHeight: 1.7 },
  label: { display: 'grid', gap: 8 },
  input: { width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '9px 12px', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 8, background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit' },
}
