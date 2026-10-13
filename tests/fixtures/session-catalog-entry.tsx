import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DshAccountSession } from '../../src/dsh-remote/account-session-types.js'

const surface = window.frameElement!.parentElement!
const old: DshAccountSession = { runtimeRef: 'old', sessionRef: 'same', title: '验收对话', updatedAt: 1700000000000, workspaceRef: '', workspaceName: '未分组', capabilities: ['session.native'], running: false, blank: false, archived: false, origin: '', desktopName: '旧电脑', sameDesktop: false, runtimeName: 'web', presence: 'offline', local: false, projectionAsOfSeq: 90, historyCompleteThroughSeq: 90 }
const local = { ...old, runtimeRef: 'local', desktopName: '本机', updatedAt: 1700100000000, presence: 'online' as const, local: true, projectionAsOfSeq: 12, historyCompleteThroughSeq: -2 }
const row: DshAccountSession = { ...local, logicalSessionRef: 'same', sources: [local, old] }
const independent: DshAccountSession = { ...old, sessionRef: 'different', logicalSessionRef: 'different', title: '另一个独立会话', sources: [{ ...old, sessionRef: 'different', title: '另一个独立会话' }] }
window.fetch = async (_url, init) => {
  const { operation } = JSON.parse(String(init?.body))
  if (operation !== 'remote.sessions.list') throw new Error('fixture only supports directory reads')
  return Response.json({ ok: true, value: { contractVersion: 1, catalogVersion: 2, localRuntimeRef: 'local', items: [row, independent] } })
}
const { AccountSessionBrowser } = await import('../../src/client/harness-account-sessions.js')
const localRow = { id: 'same', title: '验收对话', displayTitle: '验收对话', updatedAt: local.updatedAt, running: false, blank: false }
const original = { ids: ['same', 'arkme:old:same'], byId: { same: localRow, 'arkme:old:same': { ...localRow, id: 'arkme:old:same' } }, current: 'same' }
const Native = (props: any) => {
  const state = props.useSessions((s: any) => s)
  return <nav aria-label="DSH 会话">{state.ids.map((id: string) => <button key={id} data-session-id={id} onClick={() => props.open(id)}>{state.byId[id].displayTitle}</button>)}</nav>
}
function App() {
  const [opened, setOpened] = useState('')
  return <><h1>会话目录验收</h1><AccountSessionBrowser {...{
    Native, surface, open: setOpened, useSessions: (select: any) => select(original),
    useWorkspaces: (select: any) => select({ items: [], archivedSessionIds: [] }),
    useStore: (select: any) => select({ orderBy: 'updated', sessionOrderByAccount: {} }),
    startSession() {}, renameSession: async () => {}, archiveSession: async () => {}, forkSession() {}, renderSlot: () => null,
  } as any} /><output data-opened>{opened}</output></>
}
createRoot(document.getElementById('root')!).render(createElement(App))
