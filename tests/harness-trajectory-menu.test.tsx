// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installHarnessTrajectoryMenu } from '../src/client/harness-trajectory-menu.js'
import { apply } from '../src/client/harness-trajectory-client.js'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const nativeSelection = vi.fn()
const nativeDownload = vi.fn()
const cleanups: Array<() => void> = []
const roots: Root[] = []

function HeaderFixture({ extraView = false, more = true, english = false, initial = 'chat' }: {
  extraView?: boolean; more?: boolean; english?: boolean; initial?: string
}) {
  const [view, setView] = useState(initial)
  const [open, setOpen] = useState(false)
  return <>
    <div data-slot="conversation.session.header"><header>
      <div><span data-native-title>Conversation title</span><span>标准模式</span>
        <div data-slot="conversation.session.header.utilities">
          {more && <Menu open={open} align="end" dense onClose={() => { setOpen(false) }}
            items={[{ id: 'download', label: 'Download session log' }]}
            onSelect={id => { nativeDownload(id); setOpen(false) }}
            anchor={<button type="button" aria-label={english ? 'More actions' : '更多操作'}
              aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open) }}>…</button>}
          />}
        </div>
      </div>
      <div role="tablist">
        {[['chat', english ? 'Chat' : '对话'], ['trajectory', english ? 'Trajectory' : '轨迹'],
          ...(extraView ? [['new-official-view', 'New official view']] : [])].map(([id, title]) =>
          <button key={id} type="button" role="tab" aria-selected={view === id}
            onClick={() => { nativeSelection(id); setView(id!) }}>{title}</button>)}
      </div>
    </header></div>
    <div data-native-view={view}>Official view: {view}</div>
    <textarea aria-label="draft" defaultValue="unsent draft" />
  </>
}

async function mount(props: Parameters<typeof HeaderFixture>[0] = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => { root.render(<HeaderFixture {...props} />) })
  return { root, host }
}
async function install() {
  let dispose!: () => void
  await act(async () => { dispose = installHarnessTrajectoryMenu(document) })
  cleanups.push(dispose)
  return dispose
}
const tabs = () => document.querySelector<HTMLElement>('[role="tablist"]')!
const more = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
const back = () => document.querySelector<HTMLButtonElement>('[data-arkme-harness-return]')!
const viewItem = () => document.querySelector<HTMLButtonElement>('[data-arkme-harness-trajectory-item] button')!
async function click(element: HTMLElement) { await act(async () => { element.click() }) }

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks() })
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  document.body.replaceChildren()
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
})

describe('native Harness trajectory navigation', () => {
  it('adds to the native menu, runs native view actions, returns focus, and leaves the draft and other actions intact', async () => {
    await mount()
    const title = document.querySelector('[data-native-title]')
    const nativeTabs = tabs()
    const originalChat = nativeTabs.firstElementChild
    const draft = document.querySelector('textarea')!
    draft.value = 'edited unsent draft'
    await install()
    expect(getComputedStyle(nativeTabs).display).toBe('none')
    expect(back().hidden).toBe(true)
    await click(more())
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
    expect(viewItem().textContent).toBe('查看轨迹')
    await click(viewItem())
    expect(nativeSelection).toHaveBeenLastCalledWith('trajectory')
    expect(nativeDownload).not.toHaveBeenCalled()
    expect(document.querySelector('[data-native-view]')?.getAttribute('data-native-view')).toBe('trajectory')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(back().hidden).toBe(false)
    expect(document.activeElement).toBe(back())
    await click(back())
    expect(nativeSelection).toHaveBeenLastCalledWith('chat')
    expect(document.activeElement).toBe(more())
    expect(back().hidden).toBe(true)
    expect(document.querySelector('textarea')).toBe(draft)
    expect(draft.value).toBe('edited unsent draft')
    expect(tabs().firstElementChild).toBe(originalChat)
    expect(document.querySelector('[data-native-title]')).toBe(title)
    await click(more())
    await click(document.querySelector<HTMLElement>('[role="menuitem"]')!)
    expect(nativeDownload).toHaveBeenCalledExactlyOnceWith('download')
  })

  it('keeps native Escape dismissal and ordinary keyboard-focusable menu buttons', async () => {
    await mount(); await install(); await click(more())
    expect(viewItem().tagName).toBe('BUTTON')
    viewItem().focus()
    expect(document.activeElement).toBe(viewItem())
    await act(async () => { viewItem().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(more())
    expect(nativeSelection).not.toHaveBeenCalled()
  })

  it('offers a return action for an already-selected trajectory and English native labels', async () => {
    await mount({ initial: 'trajectory', english: true }); await install()
    expect(back().hidden).toBe(false)
    expect(back().textContent).toBe('← Back to chat')
    await click(more())
    expect(viewItem().textContent).toBe('View trajectory')
    await click(back())
    expect(nativeSelection).toHaveBeenLastCalledWith('chat')
  })

  it('leaves navigation visible when the native menu is unavailable', async () => {
    await mount({ more: false }); await install()
    expect(tabs().hasAttribute('data-arkme-harness-view-tabs')).toBe(false)
    expect(back()).toBeNull()
  })

  it('preserves new official views and restores the native row if one appears later', async () => {
    const { root } = await mount(); await install()
    await act(async () => { root.render(<HeaderFixture extraView />) })
    expect(tabs().hasAttribute('data-arkme-harness-view-tabs')).toBe(false)
    expect(back()).toBeNull()
    expect(tabs().children).toHaveLength(3)
    await click(tabs().lastElementChild as HTMLElement)
    expect(nativeSelection).toHaveBeenLastCalledWith('new-official-view')
  })

  it('restores the original tabs if the native menu becomes an unsupported portal', async () => {
    await mount(); await install(); await click(more())
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    const parent = menu.parentElement!
    await act(async () => { document.body.append(menu) })
    expect(tabs().hasAttribute('data-arkme-harness-view-tabs')).toBe(false)
    expect(back()).toBeNull()
    expect(viewItem()).toBeNull()
    // Restore the fixture's native node before React's own teardown.
    parent.append(menu)
  })

  it('tracks late-mounted and replaced session headers without duplicate controls', async () => {
    await install()
    const { root } = await mount()
    await click(more())
    await act(async () => {
      document.querySelector('[data-native-title]')!.textContent = 'Updated upstream title'
    })
    expect(document.querySelectorAll('[data-arkme-harness-return]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-arkme-harness-trajectory-item]')).toHaveLength(1)
    await act(async () => { root.render(<HeaderFixture key="another-session" />) })
    expect(back().hidden).toBe(true)
    expect(viewItem()).toBeNull()
    await click(more()); await click(viewItem())
    expect(nativeSelection).toHaveBeenLastCalledWith('trajectory')
  })

  it('removes only Arkme additions on unload and preserves the original native styles', async () => {
    await mount()
    tabs().style.padding = '7px'
    const dispose = await install()
    await click(more())
    const nativeItem = document.querySelector('[role="menuitem"]')
    dispose(); dispose()
    expect(tabs().hasAttribute('data-arkme-harness-view-tabs')).toBe(false)
    expect(tabs().style.padding).toBe('7px')
    expect(back()).toBeNull(); expect(viewItem()).toBeNull()
    expect(document.querySelector('[role="menuitem"]')).toBe(nativeItem)
    expect(document.querySelector('style[data-arkme-harness-trajectory]')).toBeNull()
  })

  it('ignores other tab lists and menus outside the conversation header', async () => {
    document.body.innerHTML = '<aside><div role="tablist"><button role="tab">对话</button><button role="tab">轨迹</button></div><div role="menu">Other menu</div></aside>'
    const aside = document.querySelector('aside')!
    const before = aside.innerHTML
    await mount(); await install(); await click(more())
    expect(aside.innerHTML).toBe(before)
  })

  it('does not apply the client to standalone official Harness pages', () => {
    const effect = vi.fn()
    apply({ effect } as unknown as ClientContext)
    expect(effect).not.toHaveBeenCalled()
    window.history.replaceState(null, '', '/arkme-self/harness-frame?arkme-harness-embed=1')
    apply({ effect } as unknown as ClientContext)
    expect(effect).toHaveBeenCalledOnce()
  })
})
