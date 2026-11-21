import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARKO_IDENTITY_FALLBACK_ORDER,
  ARKO_IDENTITY_SECTION,
  ArkoIdentityHolder,
  arkoIdentityName,
  arkoIdentityPrompt,
  registerArkoIdentity,
  type ArkoIdentityPorts,
} from '../src/arko-identity.js'
import type { ArkmeArkoProfile } from '../src/types.js'
import { ArkmeService } from '../src/arkme-service.js'

interface Section { name: string; order: number; interpolate?: boolean; text: () => string }

function fakeContext(order?: number) {
  const sections: Section[] = []
  const disposers: Array<() => void> = []
  return {
    sections,
    dispose: () => { for (const dispose of disposers.splice(0)) dispose() },
    ctx: {
      systemPrompt: {
        section: (section: Section) => { sections.push(section); return () => undefined },
        ...(order === undefined ? {} : { getSectionOrder: (name: string) => (name === 'HARNESS_IDENTITY' ? order : 0) }),
      },
      effect: (execute: () => () => void) => { disposers.push(execute()) },
    },
  }
}

function ports(overrides: Partial<ArkoIdentityPorts> = {}) {
  const profileListeners = new Set<(userId: number, profile: ArkmeArkoProfile) => void>()
  const accountListeners = new Set<() => void>()
  let userId: number | undefined = 7
  let profile: ArkmeArkoProfile = { displayName: '小森', version: 2 }
  const value: ArkoIdentityPorts = {
    currentUserId: async () => userId,
    readProfile: async () => profile,
    onProfile: listener => { profileListeners.add(listener); return () => { profileListeners.delete(listener) } },
    onAccountChange: listener => { accountListeners.add(listener); return () => { accountListeners.delete(listener) } },
    ...overrides,
  }
  return {
    value,
    setUser: (next: number | undefined) => { userId = next },
    setProfile: (next: ArkmeArkoProfile) => { profile = next },
    publish: (id: number, next: ArkmeArkoProfile) => { for (const listener of profileListeners) listener(id, next) },
    switchAccount: () => { for (const listener of accountListeners) listener() },
    listenerCount: () => profileListeners.size + accountListeners.size,
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => { vi.useRealTimers() })

describe('Arko identity for the local agent', () => {
  it('uses the cloud name, with the legacy default and unsafe characters normalized', () => {
    expect(arkoIdentityName(undefined)).toBe('Arko')
    expect(arkoIdentityName({ displayName: 'Agent', version: 0 })).toBe('Arko')
    expect(arkoIdentityName({ displayName: 'Agent', version: 1 })).toBe('Agent')
    expect(arkoIdentityName({ displayName: ' 小\n森  ', version: 3 })).toBe('小 森')
    expect(arkoIdentityName({ displayName: 'x'.repeat(80), version: 3 })).toHaveLength(32)
  })

  it('states one assistant across phone and computer and never claims to be DeepSeek Harness', () => {
    const prompt = arkoIdentityPrompt('小森')
    expect(prompt).toContain('you are 小森')
    expect(prompt).toContain('in the 即我 app 小森 works in the cloud')
    expect(prompt).toContain('Do not call yourself DeepSeek Harness, DSH')
  })

  it('keeps one account at a time and never lets an older profile win', () => {
    const holder = new ArkoIdentityHolder()
    expect(holder.accept(7, { displayName: '小森', version: 2 })).toBe(false)
    holder.activate(7)
    expect(holder.accept(7, { displayName: '小森', version: 2 })).toBe(true)
    expect(holder.accept(7, { displayName: '旧名', version: 1 })).toBe(false)
    expect(holder.accept(8, { displayName: '别人', version: 9 })).toBe(false)
    expect(holder.current()).toBe('小森')
    holder.activate(8)
    expect(holder.current()).toBe('Arko')
  })

  it('registers the identity in the harness identity slot as literal text', async () => {
    const fake = fakeContext(-1000)
    const port = ports()
    registerArkoIdentity(fake.ctx, port.value)
    expect(fake.sections).toHaveLength(1)
    const [section] = fake.sections
    expect(section).toMatchObject({ name: ARKO_IDENTITY_SECTION, order: -1000, interpolate: false })
    expect(section!.text()).toContain('you are Arko')
    await settle()
    expect(section!.text()).toContain('you are 小森')
    fake.dispose()
  })

  it('falls back to the documented slot on a registry without section orders', () => {
    const fake = fakeContext()
    registerArkoIdentity(fake.ctx, ports().value)
    expect(fake.sections[0]!.order).toBe(ARKO_IDENTITY_FALLBACK_ORDER)
    fake.dispose()
  })

  it('follows renames, account switches and sign-out without a restart', async () => {
    const fake = fakeContext(-1000)
    const port = ports()
    registerArkoIdentity(fake.ctx, port.value)
    await settle()
    const text = () => fake.sections[0]!.text()

    port.publish(7, { displayName: '阿森', version: 3 })
    expect(text()).toContain('you are 阿森')

    port.setUser(9)
    port.setProfile({ displayName: '小九', version: 1 })
    port.switchAccount()
    await settle()
    expect(text()).toContain('you are 小九')
    port.publish(7, { displayName: '前一个账号', version: 9 })
    expect(text()).toContain('you are 小九')

    port.setUser(undefined)
    port.switchAccount()
    await settle()
    expect(text()).toContain('you are Arko')
    fake.dispose()
    expect(port.listenerCount()).toBe(0)
  })

  it('keeps the last known name when the profile cannot be read', async () => {
    const fake = fakeContext(-1000)
    const port = ports()
    registerArkoIdentity(fake.ctx, port.value)
    await settle()
    port.value.readProfile = async () => { throw new Error('offline') }
    port.switchAccount()
    await settle()
    expect(fake.sections[0]!.text()).toContain('you are 小森')
    fake.dispose()
  })

  it('refreshes on a timer so a rename made on the phone reaches the computer', async () => {
    vi.useFakeTimers()
    const fake = fakeContext(-1000)
    const port = ports()
    registerArkoIdentity(fake.ctx, port.value, 1000)
    await vi.advanceTimersByTimeAsync(0)
    port.setProfile({ displayName: '手机上改的', version: 5 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.sections[0]!.text()).toContain('you are 手机上改的')
    fake.dispose()
  })

  it('turns off the fixed DeepSeek Harness identity line in the shipped composition', () => {
    const patch = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as Array<{ id?: string; config?: Record<string, unknown> }>
    const row = patch.find(entry => entry.id === 'system-prompt')
    expect(row?.config).toEqual({
      includeHarnessIdentity: false,
      personaPrefix: 'You are a coding agent powered by the {{model}} model.',
    })
  })
})

describe('Arko identity in the real DSH system prompt', () => {
  it('opens the assembled prompt as Arko, without the DeepSeek Harness identity line', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default
    const { renderPrompt } = await import('@deepseek-ai/dsh-system-prompt')
    const patch = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as Array<{ id?: string; config?: Record<string, unknown> }>
    const config = patch.find(entry => entry.id === 'system-prompt')!.config!
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, config)
    try {
      const prompt = (ctx as unknown as { systemPrompt: { variable(name: string, provider: () => string): () => void; assemble(): Promise<unknown> } }).systemPrompt
      prompt.variable('model', () => 'deepseek-v4-flash')
      const port = ports({ readProfile: async () => ({ displayName: '小森{{model}}', version: 2 }) })
      registerArkoIdentity(ctx as never, port.value)
      await settle()
      const assembly = await prompt.assemble() as { sections: Array<{ name: string }> }
      expect(assembly.sections[0]!.name).toBe(ARKO_IDENTITY_SECTION)
      const rendered = renderPrompt(assembly as never)
      expect(rendered).toContain('you are 小森{{model}}')
      expect(rendered).toContain('You are a coding agent powered by the deepseek-v4-flash model.')
      expect(rendered).not.toContain('powered by DeepSeek Harness.')
      expect(rendered.indexOf('you are 小森')).toBeLessThan(rendered.indexOf('You are a coding agent'))
    } finally { await ctx.fiber.dispose() }
  })
})

describe('Arko rename from a conversation reply', () => {
  it('publishes the new name for the account that asked, even if the account switched mid-run', async () => {
    let activeUserId = 10001
    const service = Object.create(ArkmeService.prototype) as ArkmeService
    Object.assign(service, {
      arkoProfileListeners: new Set(),
      runtime: { requireSession: async () => ({ userId: activeUserId }) },
      arko: {
        arkoAsk: async () => {
          activeUserId = 20002 // The user switches account while the reply streams.
          return { profile: { displayName: '小可', version: 3 } }
        },
      },
    })
    const published: Array<[number, ArkmeArkoProfile]> = []
    service.onArkoProfile((userId, profile) => { published.push([userId, profile]) })

    await service.arkoAsk('以后叫你小可')

    expect(published).toEqual([[10001, { displayName: '小可', version: 3 }]])
  })
})
