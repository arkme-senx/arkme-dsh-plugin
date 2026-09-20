// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import { CONVERSATION_MENU_LAYOUT } from '../src/client/conversation-selector-style.js'
import { IconEllipsisOutline16, IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArkmeSourceItem } from '../src/types.js'
import { CONVERSATION_HEADER_COLUMNS } from '../src/client/conversation-header-layout.js'

let host: HTMLDivElement
let root: Root

it('allows a fixed conversation name outside the centered selector without duplicating it', async () => {
  const select = vi.fn()
  const topic = { kind: 'topic', sourceRef: 'one', displayName: '很长的工作主题', recordCount: 1 } as ArkmeSourceItem
  await act(async () => root.render(<header style={{ display: 'grid', gridTemplateColumns: CONVERSATION_HEADER_COLUMNS }}>
    <h2>发给自己</h2><div style={{ gridColumn: 2, minWidth: 0, justifySelf: 'center' }}>
      <ArkmeSourceBreadcrumb selectedSource={undefined} sources={[topic]} showRootTitle={false}
        onSelect={select} onSelectAggregate={vi.fn()} />
    </div><button>日历</button>
  </header>))
  expect(host.querySelector('[data-arkme-self-topic-root]')).toBeNull()
  expect(host.querySelector('h2')?.textContent).toBe('发给自己')
  expect(host.querySelector('[data-arkme-self-topic-selector]')?.textContent).toBe('全部')
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-menu]')).not.toBeNull()
  const topicRow = host.querySelector<HTMLElement>('[data-arkme-self-topic-tree-row-ref="one"]')!
  await act(async () => topicRow.click())
  expect(select).toHaveBeenCalledWith(topic)
})

async function render(userId: number) {
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb
      userId={userId}
      selectedSource={undefined}
      sources={[]}
      onSelect={vi.fn()}
      onSelectAggregate={vi.fn()}
    />)
  })
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find(candidate => (
    candidate.getAttribute('aria-label') === label || candidate.textContent === label
    || candidate.querySelector(`[aria-label="${label}"]`) !== null
  ))
  expect(button).toBeDefined()
  await act(async () => { button!.click() })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses an animated loading icon instead of dots, and retains complete counts during background refresh', async () => {
  const sources: ArkmeSourceItem[] = [
    { sourceRef: 'p', kind: 'topic', displayName: '父主题', recordCount: 2 },
    { sourceRef: 'c', kind: 'topic', displayName: '子主题', parentSourceRef: 'p', recordCount: 3 },
  ]
  const props = { sources, selectedSource: undefined, onSelect() {}, onSelectAggregate() {}, loading: true }
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady={false} />))
  await clickButton('选择主题')
  const counts = () => [...document.querySelectorAll('[data-arkme-topic-count]')]
  expect(counts().map(el => el.textContent)).toEqual(['', '', '3'])
  expect(document.querySelectorAll('[data-arkme-topic-count] animateTransform')).toHaveLength(2)
  expect(document.querySelectorAll('[data-arkme-topic-count] [role="status"]')).toHaveLength(2)
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady />))
  expect(counts().map(el => el.textContent)).toEqual(['5', '5', '3'])
  expect(document.querySelectorAll('[data-arkme-topic-count] animateTransform')).toHaveLength(0)
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady error="offline" />))
  expect(counts().map(el => el.textContent)).toEqual(['5', '5', '3'])
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady={false} loading={false} error="offline" />))
  expect(counts().map(el => el.textContent)).toEqual(['—', '—', '3'])
  expect(document.querySelectorAll('[data-arkme-topic-count] animateTransform')).toHaveLength(0)
})

it('closes the topic menu when the header blank area outside the trigger and menu is clicked', async () => {
  await render(10001)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-menu]')).not.toBeNull()

  const header = host.querySelector<HTMLElement>('nav[aria-label="发给自己主题"]')!
  const blankArea = document.createElement('span')
  blankArea.dataset.testid = 'header-blank-area'
  header.append(blankArea)
  await act(async () => {
    blankArea.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })

  expect(host.querySelector('[data-arkme-self-topic-menu]')).toBeNull()
})

it('uses the native horizontal icon and portaled action menu, retaining it across row leave and closing one layer on Escape', async () => {
  const onSelect = vi.fn(), create = vi.fn()
  await act(async () => root.render(<ArkmeSourceBreadcrumb selectedSource={undefined}
    sources={[{ kind: 'topic', sourceRef: 'work', displayName: '工作' }]}
    onSelect={onSelect} onSelectAggregate={vi.fn()} onCreateChildTopic={create}
    onRenameTopic={vi.fn()} onDissolveTopic={vi.fn()} />))
  await clickButton('选择主题')
  const row = host.querySelector('[data-arkme-self-topic-tree-row]')!
  await act(async () => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  const trigger = row.querySelector<HTMLButtonElement>('[aria-label="工作主题操作"]')!
  const glyph = document.createElement('div')
  glyph.innerHTML = renderToStaticMarkup(<IconEllipsisOutline16 />)
  expect(trigger.querySelector('svg')?.outerHTML).toBe(glyph.querySelector('svg')?.outerHTML)
  await clickButton('工作主题操作')
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!
  expect(menu.parentElement).toBe(document.body)
  expect([...menu.querySelectorAll('[role="menuitem"]')].map(el => el.textContent)).toEqual(['新建子主题', '重命名', '解散主题'])
  expect(menu.querySelectorAll('[role="menuitem"] svg')).toHaveLength(3)
  expect(menu.style.width).toBe('')
  expect(menu.style.fontSize).toBe('')
  await act(async () => row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: menu })))
  expect(trigger.isConnected).toBe(true)
  expect(document.querySelector('[role="menu"]')).toBe(menu)
  await act(async () => menu.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(document.querySelector('[role="menu"]')).toBe(menu)
  expect(onSelect).not.toHaveBeenCalled()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[data-arkme-self-topic-menu]')).not.toBeNull()
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBeNull()
  expect(create).not.toHaveBeenCalled()
})

it('replaces the count in place with right-aligned actions for root and nested topics without narrowing the title', async () => {
  const sources: ArkmeSourceItem[] = [
    { kind: 'topic', sourceRef: 'root', displayName: '父主题', recordCount: 123 },
    { kind: 'topic', sourceRef: 'child', parentSourceRef: 'root', displayName: '子主题', recordCount: 4 },
  ]
  await act(async () => root.render(<ArkmeSourceBreadcrumb selectedSource={undefined}
    sources={sources} onSelect={vi.fn()} onSelectAggregate={vi.fn()} onRenameTopic={vi.fn()} />))
  await clickButton('选择主题')
  for (const source of sources) {
    const row = host.querySelector<HTMLElement>(`[data-arkme-self-topic-tree-row-ref="${source.sourceRef}"]`)!
    const count = row.querySelector<HTMLElement>('[data-arkme-topic-count]')!
    const select = count.closest('button')!
    const before = select.getAttribute('style')
    await act(async () => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    const actions = row.querySelector<HTMLElement>('[data-arkme-self-topic-actions]')!
    expect(actions.style.position).toBe('absolute')
    expect(actions.style.right).toBe(select.style.paddingRight)
    expect(actions.style.top).toBe('0px')
    expect(actions.style.bottom).toBe('0px')
    expect(count.style.visibility).toBe('hidden')
    expect(select.getAttribute('style')).toBe(before)
    expect(select.contains(actions)).toBe(false) // No nested interactive buttons.
    expect(actions.querySelector('button')?.getAttribute('aria-label')).toBe(`${source.displayName}主题操作`)
    await act(async () => row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(row.querySelector('[data-arkme-self-topic-actions]')).toBeNull()
    expect(count.style.visibility).toBe('')
  }
})

it('restores the last topic sort for the same account across component remounts', async () => {
  await render(10001)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：自定义')
  await clickButton('主题排序方式：自定义')
  const sortMenu = document.querySelector('[role="menu"]')
  expect(sortMenu).not.toBeNull()
  expect(host.contains(sortMenu)).toBe(false)
  expect(sortMenu?.textContent).toContain('有最新内容的主题靠前')
  expect(sortMenu?.textContent).toContain('最多内容的主题靠前')
  expect(sortMenu?.textContent).toContain('可按住主题拖动排序')
  await clickButton('最多')
  expect(host.querySelector('[data-arkme-self-topic-menu]')).not.toBeNull()
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：最多')

  await act(async () => root.unmount())
  root = createRoot(host)
  await render(10001)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：最多')

  await act(async () => root.unmount())
  root = createRoot(host)
  await render(10002)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：自定义')
})

it('keeps the DSH-style topic actions in a seamless solid footer outside the scrolling list', async () => {
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb
      userId={10003}
      selectedSource={undefined}
      sources={[]}
      onSelect={vi.fn()}
      onSelectAggregate={vi.fn()}
      onCreateTopic={vi.fn()}
    />)
  })
  await clickButton('选择主题')

  const footer = host.querySelector<HTMLElement>('[data-arkme-self-topic-footer="true"]')
  expect(footer).not.toBeNull()
  expect(footer?.style.position).toBe('')
  expect(host.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')?.style.background)
    .toBe('var(--dsw-specific-sidebar-fill, #f9fafb)')
  expect(footer?.style.background).toBe('var(--dsw-specific-sidebar-fill, #f9fafb)')
  expect(footer?.style.borderTopWidth).toBe('')
  expect(footer?.style.marginTop).toBe('')
  const create = footer?.querySelector('button[aria-label="新主题"]')
  expect(create?.textContent).toBe('新主题')
  const glyph = document.createElement('div')
  glyph.innerHTML = renderToStaticMarkup(<IconNewChatOutline16 size={14} />)
  expect(create?.querySelector('svg')?.outerHTML).toBe(glyph.querySelector('svg')?.outerHTML)
  expect(footer?.querySelector('button[data-arkme-self-topic-sort-trigger="true"]')).not.toBeNull()
  const fade = host.querySelector<HTMLElement>('[data-arkme-self-topic-fade]')!
  expect(fade.getAttribute('aria-hidden')).toBe('true')
  expect(fade.style.pointerEvents).toBe('none')
  expect(fade.style.height).toBe(`${CONVERSATION_MENU_LAYOUT.fadeHeight}px`)
  expect(fade.style.background).toContain('linear-gradient')
  const scroller = fade.previousElementSibling as HTMLElement
  expect(scroller.style.overflowY).toBe('auto')
  expect(scroller.style.paddingBottom).toBe(`${CONVERSATION_MENU_LAYOUT.listBottomPadding}px`)
  expect(scroller.contains(footer)).toBe(false)
  expect(scroller.hasAttribute('data-arkme-menu-scroll')).toBe(true)
  expect(scroller.parentElement?.style.marginRight).toBe(`-${CONVERSATION_MENU_LAYOUT.paddingX}px`)
  expect(fade.style.right).toBe(`${CONVERSATION_MENU_LAYOUT.paddingX}px`)
  expect(getComputedStyle(footer!.querySelector('.arkme-dsh-view-options-button')!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
})

it('uses native DSH menu width, type scale and spacing without changing topic drag hit regions', async () => {
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb userId={10004} selectedSource={undefined}
      sources={[{ sourceRef: 'topic:a', kind: 'topic', displayName: '主题 A', recordCount: 3 }]}
      onSelect={vi.fn()} onSelectAggregate={vi.fn()} onCreateTopic={vi.fn()} onMoveTopic={vi.fn()} />)
  })
  await clickButton('选择主题')
  const menu = host.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')!
  expect(menu.style.width).toBe(`${CONVERSATION_MENU_LAYOUT.width}px`)
  expect(menu.style.maxWidth).toBe(`min(calc(100vw - 24px), var(--arkme-topic-menu-available-width, ${CONVERSATION_MENU_LAYOUT.width}px))`)
  expect(menu.style.maxHeight).toBe(`min(${CONVERSATION_MENU_LAYOUT.maxHeight}px, calc(100vh - 116px))`)
  expect(menu.style.padding).toBe(`${CONVERSATION_MENU_LAYOUT.paddingY}px ${CONVERSATION_MENU_LAYOUT.paddingX}px`)
  const row = menu.querySelector<HTMLElement>('[data-arkme-self-topic-hit-region]')!
  expect(row.draggable).toBe(true)
  expect(row.style.minHeight).toBe(`${CONVERSATION_MENU_LAYOUT.rowHeight}px`)
  expect(row.parentElement?.style.marginTop).toBe(`${CONVERSATION_MENU_LAYOUT.rowGap}px`)
  const select = [...row.querySelectorAll('button')].find(button => button.textContent?.includes('主题 A'))!
  expect(select.style.fontSize).toBe(`${CONVERSATION_MENU_LAYOUT.titleFontSize}px`)
  expect(select.style.lineHeight).toBe(CONVERSATION_MENU_LAYOUT.lineHeight)
  const count = select.lastElementChild as HTMLElement
  expect(count.style.fontSize).toBe(`${CONVERSATION_MENU_LAYOUT.secondaryFontSize}px`)
  expect(count.style.lineHeight).toBe(CONVERSATION_MENU_LAYOUT.lineHeight)
})

it('limits the inline menu to the space remaining beside the conversation list on resize', async () => {
  await render(10005)
  const nav = host.querySelector<HTMLElement>('nav')!
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ left: 312 } as DOMRect)
  vi.stubGlobal('innerWidth', 600)
  await clickButton('选择主题')
  const menu = host.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')!
  expect(menu.style.getPropertyValue('--arkme-topic-menu-available-width')).toBe('276px')
  vi.stubGlobal('innerWidth', 500)
  await act(async () => { window.dispatchEvent(new Event('resize')) })
  expect(menu.style.getPropertyValue('--arkme-topic-menu-available-width')).toBe('176px')
})
