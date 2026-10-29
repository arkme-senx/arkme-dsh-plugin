// @vitest-environment jsdom
import { act, createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it, vi } from 'vitest'
import { installHarnessHistoryConversation } from '../src/client/harness-history-conversation.js'
import { installHarnessSessionDropdown } from '../src/client/harness-session-dropdown.js'
import { installHarnessTrajectoryMenu } from '../src/client/harness-trajectory-menu.js'

it('keeps local header layout, trajectory navigation and draft intact with the history slot owner installed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const core = new SlotCore()
  type Props = { renderSlot(name: string, owner: object): ReactNode }
  const register = core.register.bind(core) as (options: object, component: ComponentType<Props>) => () => void
  const releases: Array<() => void> = []
  const child = { kind: 'single', scope: 'session-maybe' }
  releases.push(register({ name: 'root', children: { 'main.conversation': child } }, () => null))
  releases.push(register({ name: 'main.conversation', children: {
    'conversation.session.header': child, 'conversation.composer.bar': child,
    'conversation.chat.node': { kind: 'keyed', scope: 'session-maybe' },
  } }, ({ renderSlot }) => <><header><div data-conversation-header-leading />{renderSlot('conversation.session.header', {})}</header><textarea defaultValue="未发送草稿" /></>))
  releases.push(register({ name: 'conversation.session.header', children: {
    'conversation.session.header.actions': child, 'conversation.session.header.utilities': child,
  } }, ({ renderSlot }) => <>
    <div><div><nav><span><span>测试</span></span></nav><div>{renderSlot('conversation.session.header.actions', {})}</div></div>
      <div>{renderSlot('conversation.session.header.utilities', {})}</div></div>
    <div role="tablist" data-conversation-tabs><button role="tab" aria-selected="true">对话</button><button role="tab" aria-selected="false">轨迹</button></div>
  </>))
  releases.push(register({ name: 'conversation.session.header.actions' }, () => <span>标准模式 · 9 次对话</span>))
  releases.push(register({ name: 'conversation.session.header.utilities' }, () => <span><button aria-haspopup="menu" aria-label="更多操作">…</button></span>))
  const surface = document.createElement('section')
  const stopHistory = installHarnessHistoryConversation({ slots: core } as never, surface)
  // Public slot rendering contract: each selected entry gets its own child-render
  // binding, and each outlet has one display:contents data-slot anchor.
  const render = (name: string, owner: object): ReactNode => {
    const entry = core.entriesOfSlot(name as never).slice().sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
    return <div data-slot={name} style={{ display: 'contents' }}>{entry && createElement(entry.component as ComponentType<Props>, {
      ...owner, renderSlot: (childName, childOwner) => {
        expect(Object.hasOwn(entry.children ?? {}, childName)).toBe(true)
        return render(childName, childOwner)
      },
    })}</div>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  let stopDropdown = () => {}, stopTrajectory = () => {}
  try {
    await act(async () => root.render(<div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0px, 1fr) 0px' }}>
      <div><div data-slot="sidebar"><div><div><button aria-label="收起侧边栏" /></div><button aria-label="新建会话" /><div data-slot="sidebar.workspaces" /></div></div></div>
      <div>{render('main.conversation', {})}</div><div data-rightbar-col />
    </div>))
    const draft = host.querySelector('textarea')!
    stopDropdown = installHarnessSessionDropdown(document)
    stopTrajectory = installHarnessTrajectoryMenu(document)
    expect(host.querySelector('[data-arkme-session-title-row]')).not.toBeNull()
    expect(host.querySelector('[data-arkme-session-identity]')?.hasAttribute('data-arkme-session-fallback')).toBe(false)
    expect(host.querySelector('[data-arkme-session-summary]')?.textContent).toBe('标准模式 · 9 次对话')
    expect(getComputedStyle(host.querySelector('[role="tablist"]')!).display).toBe('none')
    expect(host.querySelector('[data-arkme-harness-return]')).not.toBeNull()
    expect(host.querySelector('textarea')).toBe(draft)
    expect(draft.value).toBe('未发送草稿')
    stopTrajectory(); stopDropdown()
    expect(host.querySelector('[role="tablist"]')?.hasAttribute('data-arkme-harness-view-tabs')).toBe(false)
  } finally {
    stopTrajectory(); stopDropdown()
    await act(async () => root.unmount())
    stopHistory(); releases.reverse().forEach(release => release())
    host.remove(); vi.unstubAllGlobals()
  }
})
