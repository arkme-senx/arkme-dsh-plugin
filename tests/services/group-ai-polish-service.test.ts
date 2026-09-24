import { afterEach, describe, expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { GroupAiPolishService } from '../../src/services/group-ai-polish-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('GroupAiPolishService', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()) })

  async function fixture() {
    const state = {
      canManage: true, enabled: false, activeRuleUid: '', viewerRole: 3,
      rules: [{
        rule_uid: 'saved-1', name: '友好', rule_text: '保留事实，表达友好。', rule_version: 1,
        extra: undefined as Record<string, unknown> | undefined,
      }],
      failEnable: false, ignoreEnable: false, failReadback: false, updated: false,
    }
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      const json = (data: unknown) => new Response(JSON.stringify({ code: 200, data }))
      if (path.endsWith('/settings/query')) {
        if (state.updated && state.failReadback) throw new Error('offline')
        return json({ can_manage: state.canManage, viewer_role: state.viewerRole,
          config: { enabled: state.enabled, active_rule_uid: state.activeRuleUid }, rules: state.rules })
      }
      if (path.endsWith('/rules/generate')) return json({ candidate: {
        name: '简洁', rule_text: '保留事实，表达简洁。',
      } })
      if (path.endsWith('/rules/upsert')) {
        const rule = { rule_uid: String(body.rule_uid || 'generated-1'), name: String(body.name),
          rule_text: String(body.rule_text), rule_version: 1,
          extra: body.extra as Record<string, unknown> | undefined }
        const existingIndex = state.rules.findIndex(item => item.rule_uid === rule.rule_uid)
        if (existingIndex < 0) state.rules.push(rule)
        else state.rules[existingIndex] = rule
        return json({ rule })
      }
      if (path.endsWith('/settings/update')) {
        if (state.failEnable) throw new Error('offline')
        state.updated = true
        if (!state.ignoreEnable) {
          state.enabled = body.enabled === true
          state.activeRuleUid = String(body.active_rule_uid)
        }
        return json({ config: { enabled: body.enabled, active_rule_uid: body.active_rule_uid } })
      }
      throw new Error(`unexpected request ${path}`)
    })
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const ref = await source.sealSourceRef(42, 'group_chat', 'group-1', '产品群')
    const service = new GroupAiPolishService(runtime, source, {
      async sendChatSourceTextRaw() { throw new Error('must not send') },
    })
    cleanups.push(() => { service.dispose(); runtime.dispose() })
    return { service, state, requests, ref }
  }

  it('lets an ordinary member enable the sole saved rule without generating or saving it', async () => {
    const { service, requests, ref } = await fixture()
    const preview = await service.prepareEnableGroupAiPolishForSource(ref)
    expect(preview).toMatchObject({ groupName: '产品群', ruleName: '友好', ruleText: '保留事实，表达友好。' })
    expect(requests.every(request => request.path.endsWith('/settings/query'))).toBe(true)
    await expect(service.confirmEnableGroupAiPolish(preview.confirmationRef)).resolves.toMatchObject({ enabled: true })
    expect(requests.filter(request => request.path.includes('/rules/'))).toHaveLength(0)
    expect(requests.at(-1)?.path).toContain('/settings/query')
    expect(requests.filter(request => request.path.endsWith('/settings/query'))).toHaveLength(3)
  })

  it('requires an explicit rule selection when there is no active rule and several saved rules', async () => {
    const { service, state, ref } = await fixture()
    state.rules.push({ rule_uid: 'saved-2', name: '简洁', rule_text: '简洁。', rule_version: 1, extra: undefined })
    await expect(service.prepareEnableGroupAiPolishForSource(ref)).rejects.toMatchObject({ code: 'group-ai-polish-rule-ambiguous' })
    await expect(service.prepareEnableGroupAiPolishForSource(ref, '简洁')).resolves.toMatchObject({ ruleName: '简洁' })
  })

  it('lets the desktop and SDK select an exact saved rule by opaque rule reference', async () => {
    const { service, state, ref } = await fixture()
    state.rules.push({ rule_uid: 'saved-2', name: '友好', rule_text: '表达友好，但更简洁。', rule_version: 1, extra: undefined })

    await expect(service.prepareEnableGroupAiPolishRuleForSource(ref, 'saved-2')).resolves.toMatchObject({
      groupName: '产品群', ruleName: '友好', ruleText: '表达友好，但更简洁。',
    })
    await expect(service.prepareEnableGroupAiPolishRuleForSource(ref, 'missing'))
      .rejects.toMatchObject({ code: 'group-ai-polish-rule-not-found' })
  })

  it('persists the desktop rule conversation in the mobile-compatible rule extra', async () => {
    const { service, requests, ref } = await fixture()
    const preview = await service.generateGroupAiPolishRuleForSource(ref, '更简洁', {
      threadMessages: [
        { id: 'r0', role: 'ai', text: '告诉我这群快记的润色要求，我会整理成规则。' },
        { id: 'r1', role: 'user', text: '更简洁' },
      ],
    })
    expect(preview.threadMessages).toMatchObject([
      { id: 'r0', role: 'ai' }, { id: 'r1', role: 'user' }, { role: 'ai', isRule: true },
    ])
    await service.confirmEnableGroupAiPolish(preview.confirmationRef)
    const upsert = requests.find(request => request.path.endsWith('/rules/upsert'))
    expect(upsert?.body.extra).toMatchObject({
      rule_thread_messages: [
        { id: 'r0', role: 'ai' }, { id: 'r1', role: 'user' }, { role: 'ai', is_rule: true },
      ],
    })
  })

  it('updates the selected existing rule and rejects a concurrent member edit before overwrite', async () => {
    const first = await fixture()
    const preview = await first.service.generateGroupAiPolishRuleForSource(first.ref, '更简洁', { targetRuleRef: 'saved-1' })
    const result = await first.service.confirmEnableGroupAiPolish(preview.confirmationRef)
    expect(result.changed).toBe(true)
    expect(first.requests.find(request => request.path.endsWith('/rules/upsert'))?.body.rule_uid).toBe('saved-1')

    const concurrent = await fixture()
    const stalePreview = await concurrent.service.generateGroupAiPolishRuleForSource(
      concurrent.ref, '更简洁', { targetRuleRef: 'saved-1' },
    )
    concurrent.state.rules[0]!.rule_version = 2
    await expect(concurrent.service.confirmEnableGroupAiPolish(stalePreview.confirmationRef))
      .rejects.toMatchObject({ code: 'group-ai-polish-preview-stale' })
    expect(concurrent.requests.some(request => request.path.endsWith('/rules/upsert'))).toBe(false)
  })

  it('uses the active saved rule and refuses duplicate names or missing rules', async () => {
    const { service, state, ref } = await fixture()
    state.rules.push({ ...state.rules[0]!, rule_uid: 'saved-2' })
    state.activeRuleUid = 'saved-2'
    await expect(service.prepareEnableGroupAiPolishForSource(ref)).resolves.toMatchObject({ ruleName: '友好' })
    await expect(service.prepareEnableGroupAiPolishForSource(ref, '友好')).rejects.toMatchObject({ code: 'group-ai-polish-rule-ambiguous' })
    await expect(service.prepareEnableGroupAiPolishForSource(ref, '不存在')).rejects.toMatchObject({ code: 'group-ai-polish-rule-not-found' })
  })

  it('rechecks fresh permission and never uses owner role to override denial', async () => {
    const { service, state, requests, ref } = await fixture()
    const preview = await service.prepareEnableGroupAiPolishForSource(ref)
    state.canManage = false
    state.viewerRole = 1
    await expect(service.confirmEnableGroupAiPolish(preview.confirmationRef)).rejects.toMatchObject({
      code: 'group-ai-polish-forbidden', message: expect.stringContaining('服务端未授予'),
    })
    expect(requests.some(request => request.path.endsWith('/settings/update'))).toBe(false)
  })

  it('rejects a saved rule changed after its preview without overwriting it', async () => {
    const { service, state, requests, ref } = await fixture()
    const preview = await service.prepareEnableGroupAiPolishForSource(ref)
    state.rules[0]!.rule_text = '其他成员的新规则'
    await expect(service.confirmEnableGroupAiPolish(preview.confirmationRef)).rejects.toMatchObject({ code: 'group-ai-polish-preview-stale' })
    expect(requests.some(request => request.path.endsWith('/settings/update'))).toBe(false)
  })

  it('does not report success when a write response is positive but fresh state disagrees', async () => {
    const { service, state, ref } = await fixture()
    const preview = await service.prepareEnableGroupAiPolishForSource(ref)
    state.ignoreEnable = true
    await expect(service.confirmEnableGroupAiPolish(preview.confirmationRef)).rejects.toMatchObject({ code: 'group-ai-polish-enable-unverified' })
  })

  it('reuses a successfully saved rule when enabling fails and the user retries', async () => {
    const { service, state, requests, ref } = await fixture()
    const preview = await service.generateGroupAiPolishRuleForSource(ref, '简洁')
    state.failEnable = true
    await expect(service.confirmEnableGroupAiPolish(preview.confirmationRef)).rejects.toMatchObject({
      code: 'group-ai-polish-enable-unverified', message: expect.stringContaining('规则已保存'),
    })
    state.failEnable = false
    await expect(service.confirmEnableGroupAiPolish(preview.confirmationRef)).resolves.toMatchObject({ enabled: true })
    expect(requests.filter(request => request.path.endsWith('/rules/upsert'))).toHaveLength(1)
  })

  it('reports verification failure without undoing an already accepted write', async () => {
    const { service, state, requests, ref } = await fixture()
    const preview = await service.prepareEnableGroupAiPolishForSource(ref)
    state.failReadback = true
    await expect(service.confirmEnableGroupAiPolish(preview.confirmationRef)).rejects.toMatchObject({ code: 'group-ai-polish-enable-unverified' })
    expect(state.enabled).toBe(true)
    expect(requests.filter(request => request.path.endsWith('/settings/update'))).toHaveLength(1)
  })

  it('rejects a non-group source before reading polish configuration', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-1', '同事')
    const service = new GroupAiPolishService(runtime, source, {
      async sendChatSourceTextRaw() { throw new Error('must not send') },
    })

    await expect(service.inspectGroupAiPolish(sourceRef))
      .rejects.toMatchObject({ code: 'group-ai-polish-source-invalid' })
  })
})
