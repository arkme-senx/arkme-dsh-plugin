import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { installArkmeAccountSettingsNavIcon } from '../src/client/account-settings-nav-icon.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconUserOutline16: ({ size = 16, className }: { size?: number; className?: string }) => (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16">
      <path d="user-head" />
      <path d="user-shoulders" />
    </svg>
  ),
}))

interface FakeElement {
  readonly nodeType: 1
  isConnected: boolean
  matches(selector: string): boolean
  closest(selector: string): FakeElement | null
  querySelector(selector: string): FakeElement | null
}

class FakeHost implements FakeElement {
  readonly nodeType = 1 as const
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  readonly attributes: Record<string, string> = {}
  isConnected = true
  owner: FakeButton | undefined

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value
  }

  matches(selector: string): boolean {
    return selector === '[data-arkme-account-nav-icon]'
  }

  closest(selector: string): FakeElement | null {
    return selector === '[role="dialog"]' ? this.owner?.dialog ?? null : null
  }

  querySelector(): null {
    return null
  }

  remove(): void {
    this.isConnected = false
    if (this.owner?.host === this) this.owner.host = undefined
  }
}

class FakeIcon implements FakeElement {
  readonly nodeType = 1 as const
  readonly style = { display: 'inline-block' }
  isConnected = true

  constructor(private readonly owner: FakeButton) {}

  getAttribute(name: string): string | null {
    return name === 'class' ? 'dsh-nav-icon' : null
  }

  insertAdjacentElement(_position: string, element: FakeHost): FakeHost {
    element.owner = this.owner
    element.isConnected = this.owner.isConnected
    this.owner.host = element
    return element
  }

  matches(): boolean {
    return false
  }

  closest(selector: string): FakeElement | null {
    return selector === '[role="dialog"]' ? this.owner.dialog ?? null : null
  }

  querySelector(): null {
    return null
  }
}

class FakeButton implements FakeElement {
  readonly nodeType = 1 as const
  readonly icon: FakeIcon | undefined
  host: FakeHost | undefined
  dialog: FakeDialog | undefined
  isConnected = true

  constructor(readonly textContent: string, hasIcon = true) {
    this.icon = hasIcon ? new FakeIcon(this) : undefined
  }

  matches(selector: string): boolean {
    return selector === '[role="dialog"] nav button'
  }

  closest(selector: string): FakeElement | null {
    return selector === '[role="dialog"]' ? this.dialog ?? null : null
  }

  querySelector(selector: string): FakeHost | FakeIcon | null {
    if (selector === '[data-arkme-account-nav-icon]') return this.host ?? null
    if (selector === ':scope > svg') return this.icon ?? null
    return null
  }

  disconnect(): void {
    this.isConnected = false
    if (this.icon !== undefined) this.icon.isConnected = false
    if (this.host !== undefined) this.host.isConnected = false
  }
}

class FakeDialog implements FakeElement {
  readonly nodeType = 1 as const
  isConnected = true

  constructor(readonly buttons: FakeButton[]) {
    for (const button of buttons) button.dialog = this
  }

  matches(selector: string): boolean {
    return selector === '[role="dialog"]'
  }

  closest(selector: string): FakeElement | null {
    return selector === '[role="dialog"]' ? this : null
  }

  querySelector(selector: string): FakeElement | null {
    return selector === '[role="dialog"], [role="dialog"] nav button, [data-arkme-account-nav-icon]'
      ? this
      : null
  }

  querySelectorAll(selector: string): FakeButton[] {
    expect(selector).toBe(':scope > nav button')
    return this.buttons
  }

  disconnect(): void {
    this.isConnected = false
    for (const button of this.buttons) button.disconnect()
  }
}

class FakeIrrelevantElement implements FakeElement {
  readonly nodeType = 1 as const
  isConnected = true

  matches(): boolean {
    return false
  }

  closest(): null {
    return null
  }

  querySelector(): null {
    return null
  }
}

class FakeDocument {
  readonly body = {}
  dialogs: FakeDialog[] = []
  readonly querySelectorAll = vi.fn((selector: string) => {
    expect(selector).toBe('[role="dialog"]')
    return this.dialogs
  })

  createElement(tag: string): FakeHost {
    expect(tag).toBe('span')
    return new FakeHost()
  }
}

type FakeMutation = {
  addedNodes: FakeElement[]
  removedNodes: FakeElement[]
}

class FakeMutationObserver {
  static latest: FakeMutationObserver | undefined
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(private readonly callback: (records: FakeMutation[]) => void) {
    FakeMutationObserver.latest = this
  }

  emit(...records: FakeMutation[]): void {
    this.callback(records)
  }
}

function createRuntime(
  document: FakeDocument,
  failure?: 'create' | 'render-and-unmount',
) {
  const rendered: ReactNode[] = []
  const roots = new Map<FakeHost, { render: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> }>()
  const createRoot = vi.fn((host: FakeHost) => {
    if (failure === 'create') throw new Error('root unavailable')
    const root = {
      render: vi.fn((node: ReactNode) => {
        if (failure === 'render-and-unmount') throw new Error('render unavailable')
        rendered.push(node)
      }),
      unmount: vi.fn(() => {
        if (failure === 'render-and-unmount') throw new Error('unmount unavailable')
      }),
    }
    roots.set(host, root)
    return root
  })
  return {
    runtime: {
      document,
      MutationObserver: FakeMutationObserver,
      createRoot,
    },
    createRoot,
    rendered,
    roots,
  }
}

describe('Arkme account settings navigation icon', () => {
  it('declares the DSH icon module as an external client dependency', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { client: { inject: string[] } }
      peerDependencies: Record<string, string>
    }
    const bundleConfig = readFileSync(new URL('../tsdown.config.ts', import.meta.url), 'utf8')

    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-primitives')
    expect(packageJson.peerDependencies).toHaveProperty('@deepseek-ai/dsh-client-ui-primitives')
    expect(bundleConfig).toContain("'@deepseek-ai/dsh-client-ui-primitives'")
  })

  it('renders the DSH user icon only for one unambiguous account row per dialog', () => {
    const document = new FakeDocument()
    const account = new FakeButton('我的账户')
    const general = new FakeButton('通用设置')
    const duplicateA = new FakeButton('我的账户')
    const duplicateB = new FakeButton('我的账户')
    const wrongLocale = new FakeButton('My account')
    const missingIcon = new FakeButton('我的账户', false)
    document.dialogs = [
      new FakeDialog([account, general]),
      new FakeDialog([duplicateA, duplicateB]),
      new FakeDialog([wrongLocale]),
      new FakeDialog([missingIcon]),
    ]
    const harness = createRuntime(document)

    const dispose = installArkmeAccountSettingsNavIcon(harness.runtime as never)

    expect(account.icon!.style.display).toBe('none')
    expect(account.host?.dataset.arkmeAccountNavIcon).toBe('true')
    expect(account.host?.attributes['aria-hidden']).toBe('true')
    expect(account.host?.style).toMatchObject({ display: 'inline-flex', flex: 'none' })
    expect(general.host).toBeUndefined()
    expect(duplicateA.host).toBeUndefined()
    expect(duplicateB.host).toBeUndefined()
    expect(wrongLocale.host).toBeUndefined()
    expect(missingIcon.host).toBeUndefined()
    expect(harness.rendered).toHaveLength(1)
    expect(renderToStaticMarkup(harness.rendered[0])).toContain('user-shoulders')
    dispose()
  })

  it('ignores unrelated application mutations and rescans only settings mutations', () => {
    const document = new FakeDocument()
    const harness = createRuntime(document)
    const dispose = installArkmeAccountSettingsNavIcon(harness.runtime as never)

    expect(document.querySelectorAll).toHaveBeenCalledOnce()
    FakeMutationObserver.latest!.emit({
      addedNodes: [new FakeIrrelevantElement()],
      removedNodes: [],
    })
    expect(document.querySelectorAll).toHaveBeenCalledOnce()

    const account = new FakeButton('我的账户')
    const dialog = new FakeDialog([account])
    document.dialogs = [dialog]
    FakeMutationObserver.latest!.emit({ addedNodes: [dialog], removedNodes: [] })
    expect(document.querySelectorAll).toHaveBeenCalledTimes(2)
    expect(account.host).toBeDefined()
    dispose()
  })

  it('reapplies after remount and restores the live original icon on dispose', () => {
    const document = new FakeDocument()
    const first = new FakeButton('我的账户')
    const firstDialog = new FakeDialog([first])
    document.dialogs = [firstDialog]
    const harness = createRuntime(document)
    const dispose = installArkmeAccountSettingsNavIcon(harness.runtime as never)
    const firstHost = first.host!
    const firstRoot = harness.roots.get(firstHost)!

    firstDialog.disconnect()
    const second = new FakeButton('我的账户')
    const secondDialog = new FakeDialog([second])
    document.dialogs = [secondDialog]
    FakeMutationObserver.latest!.emit({ addedNodes: [secondDialog], removedNodes: [firstDialog] })

    expect(firstRoot.unmount).toHaveBeenCalledOnce()
    expect(second.host).toBeDefined()
    expect(harness.createRoot).toHaveBeenCalledTimes(2)

    const secondHost = second.host!
    const secondRoot = harness.roots.get(secondHost)!
    dispose()
    dispose()
    expect(FakeMutationObserver.latest!.disconnect).toHaveBeenCalledOnce()
    expect(secondRoot.unmount).toHaveBeenCalledOnce()
    expect(second.icon!.style.display).toBe('inline-block')
    expect(second.host).toBeUndefined()

    const afterDispose = new FakeButton('我的账户')
    const afterDisposeDialog = new FakeDialog([afterDispose])
    document.dialogs = [afterDisposeDialog]
    FakeMutationObserver.latest!.emit({ addedNodes: [afterDisposeDialog], removedNodes: [] })
    expect(harness.createRoot).toHaveBeenCalledTimes(2)
    expect(afterDispose.host).toBeUndefined()
  })

  it.each(['create', 'render-and-unmount'] as const)(
    'keeps the original gear visible if the user icon cannot mount at %s',
    (failure) => {
      const document = new FakeDocument()
      const account = new FakeButton('我的账户')
      document.dialogs = [new FakeDialog([account])]
      const harness = createRuntime(document, failure)

      expect(() => installArkmeAccountSettingsNavIcon(harness.runtime as never)).not.toThrow()
      expect(account.icon!.style.display).toBe('inline-block')
      expect(account.host).toBeUndefined()
    },
  )

  it('is a safe no-op when MutationObserver is unavailable', () => {
    const document = new FakeDocument()
    document.dialogs = [new FakeDialog([new FakeButton('我的账户')])]
    const harness = createRuntime(document)
    const dispose = installArkmeAccountSettingsNavIcon({
      ...harness.runtime,
      MutationObserver: undefined,
    } as never)

    expect(harness.createRoot).not.toHaveBeenCalled()
    expect(() => { dispose() }).not.toThrow()
  })
})
