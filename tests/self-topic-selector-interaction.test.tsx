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
  const button = [...host.querySelectorAll('button')].find(candidate => (
    candidate.getAttribute('aria-label') === label || candidate.textContent === label
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
  await clickButton('自定义')
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('自定义')

  await act(async () => root.unmount())
  root = createRoot(host)
  await render(10001)
  await clickButton('选择主题')
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('自定义')

  await act(async () => root.unmount())
  root = createRoot(host)
  await render(10002)
  await clickButton('选择主题')
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('最新')
})
