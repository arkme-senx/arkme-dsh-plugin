// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'

let host: HTMLDivElement
let root: Root

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
  expect(footer?.querySelector('button[aria-label="创建主题"]')).not.toBeNull()
  expect(footer?.querySelector('button[data-arkme-self-topic-sort-trigger="true"]')).not.toBeNull()
})
