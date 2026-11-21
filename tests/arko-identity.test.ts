import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARKO_IDENTITY_FALLBACK_ORDER,
  ARKO_IDENTITY_SECTION,
  ArkoIdentityHolder,
  arkoIdentityName,
  arkoIdentityPrompt,
  arkoPersonaPrompt,
  registerArkoIdentity,
  type ArkoIdentityPorts,
} from '../src/arko-identity.js'
import type { ArkmeArkoPersona, ArkmeArkoProfile } from '../src/types.js'
import { ArkmeService } from '../src/arkme-service.js'

interface Section { name: string; order: number; interpolate?: boolean; text: () => string }

type SessionEventListener = (session: unknown, event: { type?: unknown } | undefined) => void

function fakeContext(order?: number) {
  const sections: Section[] = []
  const disposers: Array<() => void> = []
  const sessionListeners: SessionEventListener[] = []
  return {
    sections,
    dispose: () => { for (const dispose of disposers.splice(0)) dispose() },
    emit: (type: string) => { for (const listener of sessionListeners) listener({}, { type }) },
    ctx: {
      systemPrompt: {
        section: (section: Section) => { sections.push(section); return () => undefined },
        ...(order === undefined ? {} : { getSectionOrder: (name: string) => (name === 'HARNESS_IDENTITY' ? order : 0) }),
      },
      effect: (execute: () => () => void) => { disposers.push(execute()) },
      on: (_name: 'session/event', listener: SessionEventListener) => { sessionListeners.push(listener) },
    },
  }
}

function ports(overrides: Partial<ArkoIdentityPorts> = {}) {
  const profileListeners = new Set<(userId: number, profile: ArkmeArkoProfile) => void>()
  const accountListeners = new Set<() => void>()
  let userId: number | undefined = 7
  let profile: ArkmeArkoProfile = { displayName: '小森', version: 2 }
  let prompt = ''
  let reads = 0
  const value: ArkoIdentityPorts = {
    currentUserId: async () => userId,
    readPersona: async (): Promise<ArkmeArkoPersona> => {
      reads++
      // The real host publishes every profile it reads, including this one.
      for (const listener of profileListeners) listener(userId ?? 0, profile)
      return { profile, prompt, promptVersion: prompt === '' ? '' : 'persona-v1' }
    },
    onProfile: listener => { profileListeners.add(listener); return () => { profileListeners.delete(listener) } },
    onAccountChange: listener => { accountListeners.add(listener); return () => { accountListeners.delete(listener) } },
    ...overrides,
  }
  return {
    value,
    setUser: (next: number | undefined) => { userId = next },
    setProfile: (next: ArkmeArkoProfile, nextPrompt = '') => { profile = next; prompt = nextPrompt },
    reads: () => reads,
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
    port.value.readPersona = async () => { throw new Error('offline') }
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

  it('uses the cloud wording for the current profile and the local identity otherwise', async () => {
    const fake = fakeContext(-1000)
    const port = ports()
    const cloud = 'In 即我 (Arkme) you are 小森, the user\'s personal AI assistant.\n\n- Reply tone: 简洁直接\n- Call the user: 老苏'
    port.setProfile({ displayName: '小森', version: 4 }, cloud)
    registerArkoIdentity(fake.ctx, port.value)
    await settle()
    const text = () => fake.sections[0]!.text()
    expect(text()).toBe(cloud)
    expect(port.reads()).toBe(1)

    // A rename seen in this host (the cloud chat) applies at once with the local
    // identity, then the new cloud wording is read once.
    port.setProfile({ displayName: '阿森', version: 5 }, cloud.replaceAll('小森', '阿森'))
    port.publish(7, { displayName: '阿森', version: 5 })
    expect(text()).toBe(arkoIdentityPrompt('阿森'))
    await settle()
    expect(text()).toContain('you are 阿森')
    expect(text()).toContain('- Call the user: 老苏')
    expect(port.reads()).toBe(2)

    // The same version published again (the UI reading the profile) reads nothing.
    port.publish(7, { displayName: '阿森', version: 5 })
    await settle()
    expect(port.reads()).toBe(2)

    // A backend without cloud wording keeps the local identity.
    port.setProfile({ displayName: '小九', version: 6 })
    port.switchAccount()
    await settle()
    expect(text()).toBe(arkoIdentityPrompt('小九'))
    fake.dispose()
  })

  it('reads again when a newer profile arrives while a read is in flight', async () => {
    const fake = fakeContext(-1000)
    const port = ports()
    const cloud = (name: string) => `In 即我 (Arkme) you are ${name}, the user's personal AI assistant.\n\n- Call the user: 老苏`
    port.setProfile({ displayName: '小森', version: 4 }, cloud('小森'))
    registerArkoIdentity(fake.ctx, port.value)
    await settle()
    const text = () => fake.sections[0]!.text()
    expect(port.reads()).toBe(1)

    // The next read answers for version 4 but is held while the cloud chat renames to version 5.
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const read = port.value.readPersona
    port.value.readPersona = async signal => { const answer = await read(signal); await held; return answer }
    port.switchAccount()
    await settle()
    expect(port.reads()).toBe(2)
    port.value.readPersona = read
    port.setProfile({ displayName: '阿森', version: 5 }, cloud('阿森'))
    port.publish(7, { displayName: '阿森', version: 5 })
    expect(text()).toBe(arkoIdentityPrompt('阿森'))

    // The held read's older wording is dropped and one more read brings version 5's.
    release()
    await settle()
    await settle()
    expect(port.reads()).toBe(3)
    expect(text()).toBe(cloud('阿森'))

    // Covered now: republishing the same version reads nothing more.
    port.publish(7, { displayName: '阿森', version: 5 })
    await settle()
    expect(port.reads()).toBe(3)
    fake.dispose()
  })

  it('re-reads the profile when a local turn starts, at most once per window', async () => {
    vi.useFakeTimers()
    const fake = fakeContext(-1000)
    const port = ports()
    registerArkoIdentity(fake.ctx, port.value, 60 * 60_000, 20_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(port.reads()).toBe(1)
    port.setProfile({ displayName: '小森', version: 3 }, 'In 即我 (Arkme) you are 小森.\n- Reply tone: 温暖体贴')
    fake.emit('turn/start')
    await vi.advanceTimersByTimeAsync(0)
    expect(port.reads()).toBe(1)
    await vi.advanceTimersByTimeAsync(20_000)
    fake.emit('turn/end')
    fake.emit('turn/start')
    await vi.advanceTimersByTimeAsync(0)
    expect(port.reads()).toBe(2)
    expect(fake.sections[0]!.text()).toContain('- Reply tone: 温暖体贴')
    fake.dispose()
    fake.emit('turn/start')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(port.reads()).toBe(2)
  })

  it('rejects unusable cloud wording', () => {
    expect(arkoPersonaPrompt('  ')).toBeUndefined()
    expect(arkoPersonaPrompt('x'.repeat(8001))).toBeUndefined()
    expect(arkoPersonaPrompt('a\u0000b')).toBeUndefined()
    expect(arkoPersonaPrompt(' In 即我 you are 小森. ')).toBe('In 即我 you are 小森.')
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
      const port = ports({ readPersona: async () => ({
        profile: { displayName: '小森{{model}}', version: 2 },
        prompt: 'In 即我 (Arkme) you are 小森{{model}}, the user\'s personal AI assistant.\n- Call the user: 老苏{{model}}',
        promptVersion: 'persona-v1',
      }) })
      registerArkoIdentity(ctx as never, port.value)
      await settle()
      const assembly = await prompt.assemble() as { sections: Array<{ name: string }> }
      expect(assembly.sections[0]!.name).toBe(ARKO_IDENTITY_SECTION)
      const rendered = renderPrompt(assembly as never)
      expect(rendered).toContain('you are 小森{{model}}')
      expect(rendered).toContain('- Call the user: 老苏{{model}}')
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
