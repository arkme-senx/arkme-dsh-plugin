// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/client/api.js', () => ({ callArkme: async () => ({ profile: { userId: props.auth?.userId, createdAt: Date.parse('2026-09-10T00:00:00+08:00') } }) }))
import { ArkmeHomeTour, type ArkmeHomeTourProps } from '../src/client/ArkmeHomeTour.js'
import { ArkmeHomeTourSession } from '../src/client/home-tour-session.js'

const directoryIds = ['harness', 'arko', 'send-to-self', 'official-author'] as const
const navIds = ['contacts', 'calls', 'recordings', 'calendar', 'world', 'extensions'] as const
const ids = [...directoryIds, ...navIds]
const titles = ['DeepSeek Harness', 'Arko', '发给自己', '联系作者', '联系人', '通话', '录音', '日历', '世界', '市集']
const descriptions = [
  '使用原生 AI 工作台，与模型对话、处理任务和编写代码。',
  '你的个人 AI 助手，可以结合记录回答问题，帮你整理信息。',
  '随手保存文字、图片和文件，把想法与重要内容留给自己。',
  '遇到问题或有使用建议，可以在这里直接联系作者。',
]
let root: Root
let host: HTMLDivElement
let nav: HTMLElement
let navScroll: HTMLDivElement
let harnessFrame: HTMLIFrameElement
let directory: HTMLDivElement
let previousFocus: HTMLButtonElement
let session: ArkmeHomeTourSession
let storage: Map<string, string>
let props: ArkmeHomeTourProps

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
}
async function render(changes: Partial<ArkmeHomeTourProps> = {}) {
  props = { ...props, ...changes }
  await act(async () => root.render(<StrictMode><ArkmeHomeTour {...props} /></StrictMode>))
  await settle()
}
function panel() { return document.querySelector<HTMLElement>('[data-arkme-home-tour-panel]') }
function target(id: string) { return document.querySelector<HTMLElement>(`[data-arkme-home-tour-target="${id}"]`) }
function currentTitle() { return panel()?.querySelector('h2')?.textContent }
function highlightY() {
  return document.querySelector<SVGRectElement>('.arkme-home-tour-mask mask rect[fill="black"]')?.getAttribute('y')
}
async function click(label: string) {
  const button = [...panel()!.querySelectorAll('button')].find(element => element.textContent === label || element.getAttribute('aria-label') === label)
  expect(button, `Missing tour action: ${label}`).toBeDefined()
  await act(async () => button!.click())
  await settle()
}
function setDirectoryReady(ready: boolean, account = 'prod:1') {
  directory.dataset.arkmeHomeTourAccount = account
  directory.dataset.arkmeHomeTourReady = String(ready)
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const computedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computedStyle(element))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hidden || this.style.display === 'none') return new DOMRect()
    if (this.hasAttribute('data-arkme-home-tour-viewport')) return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    if (this.dataset.arkmeHomeTourDirectory === 'root') return new DOMRect(0, 60, 260, 180)
    if (this.dataset.arkmeOwned === 'product-navigation') return new DOMRect(0, 60, 80, 180)
    const index = ids.indexOf((this.getAttribute('data-arkme-home-tour-target') ?? '') as typeof ids[number])
    return index >= 0 ? new DOMRect(index < directoryIds.length ? 284 : 8, 70 + index * 64, 56, 52) : new DOMRect(80, 80, 320, 200)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getBoundingClientRect().width })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getBoundingClientRect().height })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('scrollTo', vi.fn())
  HTMLElement.prototype.scrollIntoView = vi.fn()
  storage = new Map()
  session = new ArkmeHomeTourSession(() => ({
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value) },
  }))
  props = { auth: { status: 'authenticated', environment: 'prod', userId: 1 }, blocked: false, routeActive: true, notificationRevision: 0, session }
  previousFocus = document.createElement('button')
  previousFocus.textContent = '原页面操作'
  document.body.append(previousFocus)
  previousFocus.focus()

  directory = document.createElement('div')
  directory.dataset.arkmeHomeTourDirectory = 'root'
  directory.dataset.arkmeHomeTourScrollContainer = 'directory'
  setDirectoryReady(true)
  directory.innerHTML = directoryIds.map((id, index) => `<button data-arkme-home-tour-target="${id}">${titles[index]}</button>`).join('')
  document.body.append(directory)

  nav = document.createElement('nav')
  nav.dataset.arkmeOwned = 'product-navigation'
  navScroll = document.createElement('div')
  navScroll.dataset.arkmeHomeTourScrollContainer = 'navigation'
  navScroll.innerHTML = navIds.map((id, index) => `<button data-arkme-home-tour-target="${id}">${titles[index + directoryIds.length]}</button>`).join('')
  nav.append(navScroll)
  document.body.append(nav)

  const surface = document.createElement('section')
  surface.dataset.arkmeOwned = 'deepseek-harness-surface'
  harnessFrame = document.createElement('iframe')
  surface.append(harnessFrame)
  document.body.append(surface)
  harnessFrame.contentDocument!.body.dataset.arkmeHarnessOnboarding = 'ready'

  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('home tour browser behavior', () => {
  it('waits while the send-to-self guide owns the foreground', async () => {
    const owner = document.createElement('section')
    owner.setAttribute('data-arkme-self-tour-running', 'true')
    document.body.append(owner)
    await render(); expect(panel()).toBeNull()
    owner.removeAttribute('data-arkme-self-tour-running')
    await settle(); expect(panel()).not.toBeNull()
  })

  it('does not consume an attempt or flash while the Harness onboarding step is still deciding', async () => {
    delete harnessFrame.contentDocument!.body.dataset.arkmeHarnessOnboarding
    await render()
    expect(panel()).toBeNull()
    harnessFrame.contentDocument!.body.dataset.arkmeHarnessOnboarding = 'pending'
    await settle()
    expect(panel()).toBeNull()
    harnessFrame.contentDocument!.body.dataset.arkmeHarnessOnboarding = 'ready'
    await settle()
    expect(currentTitle()).toBe('DeepSeek Harness')
    expect(storage.size).toBe(0)
  })

  it('waits for the current Harness document after the frame is replaced', async () => {
    harnessFrame.remove()
    await render()
    expect(panel()).toBeNull()
    const replacement = document.createElement('iframe')
    document.querySelector('[data-arkme-owned="deepseek-harness-surface"]')!.append(replacement)
    await settle()
    expect(panel()).toBeNull()
    replacement.contentDocument!.body.dataset.arkmeHarnessOnboarding = 'ready'
    await settle()
    expect(panel()).not.toBeNull()
  })

  it('walks through the directory then navigation in real order without activating either surface', async () => {
    const navigate = vi.fn()
    directory.addEventListener('click', navigate)
    nav.addEventListener('click', navigate)
    await render()
    expect(panel()?.textContent).toContain('1 / 10')
    expect(panel()?.contains(document.activeElement)).toBe(true)
    expect(panel()?.textContent).not.toContain('上一步')
    for (let index = 0; index < 10; index++) {
      expect(currentTitle()).toBe(titles[index])
      expect(panel()?.textContent).toContain(`${index + 1} / 10`)
      if (index < descriptions.length) expect(panel()?.textContent).toContain(descriptions[index])
      if (index < 9) await click('下一步')
    }
    expect(directory.scrollTop).toBeGreaterThan(0)
    expect(navScroll.scrollTop).toBeGreaterThan(0)
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()
    await click('上一步')
    expect(currentTitle()).toBe('世界')
    await click('下一步')
    await click('开始使用')
    expect(panel()).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(previousFocus)
    await render({ session: new ArkmeHomeTourSession(() => ({ getItem: key => storage.get(key) ?? null, setItem: () => {} })) })
    expect(panel()).toBeNull()
  })

  it('places the card below a target when the configured panel cannot fit beside it', async () => {
    vi.stubGlobal('innerWidth', 599)
    await render()
    expect(document.querySelector('.arkme-home-tour-placement-bottom')).not.toBeNull()
  })

  it('does not let the tour library scroll the page for an off-viewport directory target', async () => {
    vi.stubGlobal('innerWidth', 320)
    vi.spyOn(target('harness')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 70, 280, 52))
    await render()
    expect(panel()).not.toBeNull()
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it.each(['跳过引导', '关闭功能引导', 'Escape'])('remembers explicit dismissal with %s', async action => {
    await render()
    if (action === 'Escape') {
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      await settle()
    } else await click(action)
    expect(panel()).toBeNull()
    expect(storage.size).toBe(1)
    await render()
    expect(panel()).toBeNull()
  })

  it('waits for authentication, owner readiness and delayed mandatory targets without consuming the visit', async () => {
    const arko = target('arko')!
    arko.remove()
    setDirectoryReady(false)
    await render({ auth: undefined })
    expect(panel()).toBeNull()
    await render({ auth: { status: 'binding-required', environment: 'prod', userId: 1 } })
    expect(panel()).toBeNull()
    await render({ auth: { status: 'authenticated', environment: 'prod', userId: 1 }, blocked: true })
    expect(panel()).toBeNull()
    await render({ blocked: false })
    expect(panel()).toBeNull()
    setDirectoryReady(true)
    directory.append(arko)
    await settle()
    expect(panel()?.textContent).toContain('1 / 10')
  })

  it('requires the initial navigation targets to remain stable before consuming the visit', async () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame
      callbacks.set(id, callback)
      return id
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { callbacks.delete(id) }))
    const flushFrame = async () => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      await act(async () => { pending.forEach(callback => callback(performance.now())) })
    }
    const tryStart = vi.spyOn(session, 'tryStart')

    await act(async () => root.render(<StrictMode><ArkmeHomeTour {...props} /></StrictMode>))
    await flushFrame()
    expect(panel()).toBeNull()
    expect(tryStart).not.toHaveBeenCalled()

    setDirectoryReady(false)
    await act(async () => {})
    await flushFrame()
    expect(tryStart).not.toHaveBeenCalled()

    setDirectoryReady(true)
    await act(async () => {})
    await flushFrame()
    expect(panel()).toBeNull()
    expect(tryStart).not.toHaveBeenCalled()
    await flushFrame()
    expect(panel()?.textContent).toContain('1 / 10')
    expect(tryStart).toHaveBeenCalledTimes(1)
  })

  it('ignores hidden retained and stale-account directories, and waits in another module', async () => {
    const stale = directory.cloneNode(true) as HTMLDivElement
    stale.dataset.arkmeHomeTourAccount = 'prod:2'
    document.body.prepend(stale)
    directory.hidden = true
    await render()
    expect(panel()).toBeNull()
    directory.hidden = false
    setDirectoryReady(false)
    await settle()
    expect(panel()).toBeNull()
    setDirectoryReady(true)
    await settle()
    expect(panel()?.textContent).toContain('1 / 10')
  })

  it('waits for a visible same-origin Harness iframe native dialog to close', async () => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const statement = iframe.contentDocument!.createElement('dialog')
    statement.setAttribute('open', '')
    statement.style.display = 'block'
    statement.textContent = '内测声明'
    iframe.contentDocument!.body.append(statement)
    await render()
    expect(panel()).toBeNull()
    statement.removeAttribute('open')
    await settle()
    expect(panel()?.textContent).toContain('1 / 10')
  })

  it.each(['内测声明', 'Internal Testing Notice'])('resumes after the real Harness div dialog %s is removed', async title => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    await render()
    await click('下一步')
    const statement = iframe.contentDocument!.createElement('div')
    statement.setAttribute('role', 'dialog')
    statement.setAttribute('aria-modal', 'true')
    statement.setAttribute('aria-label', title)
    statement.innerHTML = `<h2 tabindex="-1">${title}</h2><button>继续</button>`
    vi.spyOn(statement, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 400, 300))
    iframe.contentDocument!.body.append(statement)
    statement.querySelector('h2')!.focus()
    await settle()
    expect(panel()).toBeNull()
    expect(document.body.dataset.arkmeHomeTourRunning).toBe('true')
    expect(storage.size).toBe(0)
    statement.remove()
    await settle()
    expect(panel()?.textContent).toContain('2 / 10')
    expect(currentTitle()).toBe('Arko')
    expect(panel()?.contains(document.activeElement)).toBe(true)
  })

  it.each(['close', 'remove'] as const)('resumes the same step after a late Harness statement closes via %s', async closeMode => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    await render()
    await click('下一步')
    expect(panel()?.textContent).toContain('2 / 10')
    const statement = iframe.contentDocument!.createElement('dialog')
    statement.setAttribute('open', '')
    statement.style.display = 'block'
    statement.innerHTML = '<h2>内测声明</h2><button>继续</button>'
    iframe.contentDocument!.body.append(statement)
    statement.querySelector('button')!.focus()
    await settle()
    expect(panel()).toBeNull()
    expect(document.body.dataset.arkmeHomeTourRunning).toBe('true')
    expect(storage.size).toBe(0)
    if (closeMode === 'close') statement.removeAttribute('open')
    else statement.remove()
    await settle()
    expect(panel()?.textContent).toContain('2 / 10')
    expect(currentTitle()).toBe('Arko')
    expect(panel()?.contains(document.activeElement)).toBe(true)
  })

  it('does not resume from a first-run statement after leaving the home route', async () => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    await render()
    const statement = iframe.contentDocument!.createElement('dialog')
    statement.setAttribute('open', '')
    statement.textContent = '内测声明'
    iframe.contentDocument!.body.append(statement)
    await settle()
    await render({ routeActive: false })
    statement.remove()
    await render({ routeActive: true })
    expect(panel()).toBeNull()
    expect(document.body.hasAttribute('data-arkme-home-tour-running')).toBe(false)
    expect(storage.size).toBe(0)
  })

  it('starts with nine steps when the optional official author is absent after initialization', async () => {
    target('official-author')!.remove()
    await render()
    expect(panel()?.textContent).toContain('1 / 9')
    for (let index = 0; index < 3; index++) await click('下一步')
    expect(currentTitle()).toBe('联系人')
  })

  it('does not inject the optional author if it appears after the tour starts', async () => {
    const author = target('official-author')!
    author.remove()
    await render()
    directory.append(author)
    await settle()
    expect(panel()?.textContent).toContain('1 / 9')
    for (let index = 0; index < 3; index++) await click('下一步')
    expect(currentTitle()).toBe('联系人')
  })

  it.each([
    { phase: 'before', advances: 1, expectedTitle: 'Arko', expectedProgress: '2 / 9' },
    { phase: 'current', advances: 3, expectedTitle: '联系人', expectedProgress: '4 / 9' },
    { phase: 'after', advances: 4, expectedTitle: '联系人', expectedProgress: '4 / 9' },
  ])('removes a disappearing optional author $phase its step while retaining the stable current step', async ({ advances, expectedTitle, expectedProgress }) => {
    await render()
    for (let index = 0; index < advances; index++) await click('下一步')
    target('official-author')!.remove()
    await settle()
    expect(currentTitle()).toBe(expectedTitle)
    expect(panel()?.textContent).toContain(expectedProgress)
    if (advances === 3) expect(navScroll.scrollTop).toBeGreaterThan(0)
    expect(storage.size).toBe(0)
  })

  it('remeasures the active spotlight when an earlier optional row moves the same target node', async () => {
    const author = target('official-author')!
    const arko = target('arko')!
    const defaultRect = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this === arko ? new DOMRect(284, author.isConnected ? 190 : 126, 56, 52) : defaultRect.call(this)
    })
    await render()
    await click('下一步')
    expect(currentTitle()).toBe('Arko')
    expect(highlightY()).toBe('184')
    author.remove()
    await settle()
    expect(currentTitle()).toBe('Arko')
    expect(panel()?.textContent).toContain('2 / 9')
    expect(highlightY()).toBe('120')
  })

  it('remeasures when the active target moves before the first inspection after a step handoff', async () => {
    const author = target('official-author')!
    const arko = target('arko')!
    const defaultRect = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this === arko ? new DOMRect(284, author.isConnected ? 190 : 126, 56, 52) : defaultRect.call(this)
    })
    await render()
    const next = [...panel()!.querySelectorAll('button')].find(button => button.textContent === '下一步')!
    await act(async () => next.click())
    expect(currentTitle()).toBe('Arko')
    expect(highlightY()).toBe('184')
    author.remove()
    await settle()
    expect(currentTitle()).toBe('Arko')
    expect(panel()?.textContent).toContain('2 / 9')
    expect(highlightY()).toBe('120')
  })

  it('follows and scrolls a replacement for the active mandatory node with the same stable marker', async () => {
    await render()
    await click('下一步')
    await click('下一步')
    expect(currentTitle()).toBe('发给自己')
    directory.scrollTop = 0
    const oldSelf = target('send-to-self')!
    const replacement = oldSelf.cloneNode(true) as HTMLButtonElement
    oldSelf.replaceWith(replacement)
    await settle()
    expect(panel()).not.toBeNull()
    expect(currentTitle()).toBe('发给自己')
    expect(directory.scrollTop).toBeGreaterThan(0)
    expect(storage.size).toBe(0)
  })

  it('pauses across transient owner readiness and target reconstruction, then resumes the same step with modal focus', async () => {
    await render()
    await click('下一步')
    expect(currentTitle()).toBe('Arko')

    setDirectoryReady(false)
    await settle()
    expect(panel()).toBeNull()
    expect(document.body.dataset.arkmeHomeTourRunning).toBe('true')

    const arko = target('arko')!
    const replacement = arko.cloneNode(true)
    arko.replaceWith(replacement)
    setDirectoryReady(true)
    await settle()

    expect(currentTitle()).toBe('Arko')
    expect(panel()?.textContent).toContain('2 / 10')
    expect(panel()?.contains(document.activeElement)).toBe(true)
    expect(storage.size).toBe(0)

    panel()!.querySelector<HTMLButtonElement>('.arkme-home-tour-skip')!.focus()
    await click('跳过引导')
    expect(document.activeElement).toBe(previousFocus)
  })

  it('withdraws instead of reopening over a business control focused during a pause', async () => {
    await render()
    await click('下一步')
    setDirectoryReady(false)
    await settle()
    expect(panel()).toBeNull()

    const elsewhere = document.createElement('button')
    elsewhere.textContent = '初始化期间的当前操作'
    document.body.append(elsewhere)
    elsewhere.focus()
    setDirectoryReady(true)
    await settle()

    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(elsewhere)
    expect(document.body.hasAttribute('data-arkme-home-tour-running')).toBe(false)
    expect(storage.size).toBe(0)
  })

  it('withdraws permanently when the user leaves the home route and clears the mutual-exclusion marker', async () => {
    await render()
    await click('下一步')
    await render({ routeActive: false })
    expect(panel()).toBeNull()
    expect(document.body.hasAttribute('data-arkme-home-tour-running')).toBe(false)
    expect(storage.size).toBe(0)
    await render({ routeActive: true })
    expect(panel()).toBeNull()
  })

  it('terminates a paused tour when a user-opened blocking surface appears', async () => {
    await render()
    setDirectoryReady(false)
    await settle()
    expect(panel()).toBeNull()
    expect(document.body.dataset.arkmeHomeTourRunning).toBe('true')

    const settings = document.createElement('dialog')
    settings.setAttribute('open', '')
    document.body.append(settings)
    await settle()
    expect(document.body.hasAttribute('data-arkme-home-tour-running')).toBe(false)

    settings.remove()
    setDirectoryReady(true)
    await settle()
    expect(panel()).toBeNull()
  })

  it.each(['logout', 'notification', 'overlay'])('withdraws on %s without saving completion or reopening in the page session', async reason => {
    await render()
    await click('下一步')
    if (reason === 'logout') await render({ auth: undefined })
    else if (reason === 'notification') await render({ notificationRevision: 1 })
    else {
      const dialog = document.createElement('section')
      dialog.setAttribute('role', 'dialog')
      document.body.append(dialog)
      await settle()
      dialog.remove()
    }
    expect(panel()).toBeNull()
    expect(storage.size).toBe(0)
    setDirectoryReady(true)
    await render({ auth: { status: 'authenticated', environment: 'prod', userId: 1 } })
    expect(panel()).toBeNull()
    await render({ session: new ArkmeHomeTourSession(() => undefined) })
    expect(panel()?.textContent).toContain('1 / 10')
  })

  it('starts separately for another account only when its directory owner replaces the old account', async () => {
    await render()
    await click('下一步')
    await render({ auth: { status: 'authenticated', environment: 'prod', userId: 2 } })
    expect(panel()).toBeNull()
    setDirectoryReady(true, 'prod:2')
    await settle()
    expect(panel()?.textContent).toContain('1 / 10')
    expect(storage.size).toBe(0)
    await click('跳过引导')
    expect([...storage.keys()]).toEqual(['dsh-arkme:home-tour:v1:prod:2'])
  })

  it('keeps focus inside the card and does not close on mask clicks', async () => {
    await render()
    const buttons = panel()!.querySelectorAll<HTMLButtonElement>('button')
    buttons[buttons.length - 1]!.focus()
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(buttons[0])
    await act(async () => document.querySelector<HTMLElement>('.arkme-home-tour-mask')!.click())
    expect(panel()).not.toBeNull()
    expect(document.querySelector<HTMLElement>('.arkme-home-tour-mask')!.style.pointerEvents).toBe('auto')
  })

  it('keeps keyboard focus when returning to the first step removes the previous button', async () => {
    await render()
    await click('下一步')
    const previous = [...panel()!.querySelectorAll('button')].find(button => button.textContent === '上一步')!
    previous.focus()
    await click('上一步')
    expect(panel()?.contains(document.activeElement)).toBe(true)
  })

  it('does not move focus back into the previous page during a notification handoff', async () => {
    await render()
    const restore = vi.spyOn(previousFocus, 'focus')
    await render({ notificationRevision: 1 })
    expect(panel()).toBeNull()
    expect(restore).not.toHaveBeenCalled()
  })

  it('handles Escape after a native backdrop click blurred focus to the document body', async () => {
    await render()
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    await settle()
    expect(panel()).toBeNull()
    expect(storage.size).toBe(1)
  })
})

it('waits while the nonmodal recording tour is visible', async () => {
  const recordingPanel = document.createElement('section')
  recordingPanel.dataset.arkmeRecordingTourPanel = 'true'
  document.body.append(recordingPanel)
  await render()
  expect(panel()).toBeNull()
  recordingPanel.remove()
  await settle()
  expect(panel()).not.toBeNull()
})
