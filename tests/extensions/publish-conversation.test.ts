import { describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionPublishConversation } from '../../src/tools/extensions/publish-conversation.js'
import type { ArkmeMyExtensionPublishInput } from '../../src/extensions/owned-types.js'

function draft(ownedRef: string, name: string): Omit<ArkmeMyExtensionPublishInput, 'clientMutationId'> {
  return {
    ownedRef,
    name,
    description: `${name}说明`,
    version: '1.0.0',
    visibility: 'private',
  }
}

function preparedV2(input: ArkmeMyExtensionPublishInput, sourceFingerprint = 'fingerprint') {
  return {
    input,
    sourceFingerprint,
    publishRoute: 'dynamic-cordis-v2' as const,
    artifactContractVersion: 2 as const,
    artifactKind: 'dsh-bundle-tgz' as const,
  }
}

function preparedV3(input: ArkmeMyExtensionPublishInput, sourceFingerprint = 'native-fingerprint') {
  return {
    input,
    sourceFingerprint,
    publishRoute: 'profile-native-v3' as const,
    artifactContractVersion: 3 as const,
    artifactKind: 'dsh-native-package-tgz' as const,
    nativeCapabilities: ['runtime_dependencies'] as const,
  }
}

describe('extension publish conversation confirmation', () => {
	it('rejects malformed and duplicate existing extension targets before preflight', async () => {
		const preflight = vi.fn(async (input: ArkmeMyExtensionPublishInput) => preparedV2(input))
		const conversation = new ArkmeExtensionPublishConversation({ preflight, publish: vi.fn() })
		const agent = { id: 'session-target-validation', session: { events: [] } }

		await expect(conversation.prepare(agent as never, [{
			...draft('owned-invalid', '无效目标'), extensionId: 'bad/extension',
		}])).rejects.toThrow('已有扩展身份无效')
		await expect(conversation.prepare(agent as never, [
			{ ...draft('owned-a', '扩展 A'), extensionId: 'ext-existing' },
			{ ...draft('owned-b', '扩展 B'), extensionId: 'ext-existing' },
		])).rejects.toThrow('同一批次不能重复更新同一个已有扩展')
		expect(preflight).not.toHaveBeenCalled()
	})

	it('uses effective lineage for confirmation, deduplication and confirm-time revalidation', async () => {
		const duplicateConversation = new ArkmeExtensionPublishConversation({
			preflight: async input => preparedV2(
				input.ownedRef === 'owned-implicit' ? { ...input, extensionId: 'ext-existing' } : input,
				`fingerprint:${input.ownedRef}`,
			),
			publish: vi.fn(),
		})
		const agent = { id: 'session-effective-target', session: { events: [] } }
		await expect(duplicateConversation.prepare(agent as never, [
			draft('owned-implicit', '隐式目标'),
			{ ...draft('owned-explicit', '显式目标'), extensionId: 'ext-existing' },
		])).rejects.toThrow('同一批次不能重复更新同一个已有扩展')

		let effectiveExtensionId: string | undefined = 'ext-existing'
		const events: Array<Record<string, unknown>> = [
			{ seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布更新' }], source: { kind: 'user' } } },
		]
		const current = { id: 'session-target-change', session: { get events() { return events } } }
		const publish = vi.fn()
		const conversation = new ArkmeExtensionPublishConversation({
			preflight: async input => preparedV2(
				effectiveExtensionId === undefined ? { ...input, extensionId: undefined } : { ...input, extensionId: effectiveExtensionId },
			),
			publish,
			now: () => 1_000,
		})
		const prepared = await conversation.prepare(current as never, [draft('owned-lineage', '血缘扩展')])
		expect(prepared).toMatchObject({
			question: expect.stringContaining('更新已有扩展 ext-existing'),
			items: [{ extensionId: 'ext-existing' }],
		})
		events.push({
			seq: 1, type: 'user/message',
			data: { content: [{ type: 'text', text: '确认更新' }], source: { kind: 'user' } },
		})
		effectiveExtensionId = 'ext-changed'
		await expect(conversation.confirm(current as never)).rejects.toThrow('发布目标已变化')
		expect(publish).not.toHaveBeenCalled()
	})

	it('preserves the GitHub source through prepare, confirmation and publish', async () => {
		const events: Array<Record<string, unknown>> = [
			{ seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布 GitHub 扩展' }], source: { kind: 'user' } } },
		]
		const agent = { id: 'session-github', session: { get events() { return events } } }
		const preflight = vi.fn(async (input: ArkmeMyExtensionPublishInput) => preparedV2(input))
		const publish = vi.fn(async (input: ArkmeMyExtensionPublishInput) => ({ extension_id: 'ext-github', version: input.version, status: 'published' as const }))
		const conversation = new ArkmeExtensionPublishConversation({
			preflight, publish, now: () => 1_000,
			createMutationId: () => '00000000-0000-4000-8000-000000000001',
		})
		const prepared = await conversation.prepare(agent as never, [{
			...draft('owned-github', 'GitHub 扩展'),
			githubRepositoryUrl: 'https://www.github.com/Example/Weather.git/',
		}])
		expect(prepared.question).toContain('https://github.com/example/weather')
		expect(prepared.question).toContain('V2 沙箱 Bundle')
		expect(prepared.question).toContain('V2 来源账号资格仍需服务端校验')
		expect(preflight).toHaveBeenCalledWith(expect.objectContaining({
			githubRepositoryUrl: 'https://github.com/example/weather',
		}), undefined)
		events.push({
			seq: 1, type: 'user/message',
			data: { content: [{ type: 'text', text: prepared.expectedReply }], source: { kind: 'user' } },
		})
		await conversation.confirm(agent as never)
		expect(publish).toHaveBeenCalledWith(expect.objectContaining({
			githubRepositoryUrl: 'https://github.com/example/weather',
		}), undefined)
	})
  it('publishes one prepared batch only after a later direct user confirmation', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '发布这两个扩展' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare-1', name: 'arkme_extension_publish', arguments: '{}' } },
    ]
    const agent = { id: 'session-1', session: { get events() { return events } } }
    const publish = vi.fn(async (input: ArkmeMyExtensionPublishInput) => ({
      extension_id: `ext-${input.ownedRef}`,
      version: input.version,
      status: 'published' as const,
    }))
    let mutation = 0
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => preparedV2(input, `fingerprint:${input.ownedRef}`),
      publish,
      now: () => 1_000,
      createMutationId: () => `00000000-0000-4000-8000-${String(++mutation).padStart(12, '0')}`,
    })

    const prepared = await conversation.prepare(agent as never, [
      draft('owned-weather', '天气助手'),
      draft('owned-calendar', '日程助手'),
    ])

    expect(prepared).toEqual({
      status: 'confirmation_required',
      count: 2,
      question: '是否确认一次发布以下 2 个扩展？\n- 天气助手 1.0.0，仅自己，发布方式：V2 沙箱 Bundle（当前会话 Dynamic Cordis Package）\n- 日程助手 1.0.0，仅自己，发布方式：V2 沙箱 Bundle（当前会话 Dynamic Cordis Package）',
      items: [
        { ownedRef: 'owned-weather', name: '天气助手', version: '1.0.0', visibility: 'private', publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
        { ownedRef: 'owned-calendar', name: '日程助手', version: '1.0.0', visibility: 'private', publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
      ],
      expiresAtMillis: 601_000,
    })
    expect(publish).not.toHaveBeenCalled()
    await expect(conversation.confirm(agent as never)).rejects.toThrow('需要用户在准备发布后的新消息中明确确认')
    expect(publish).not.toHaveBeenCalled()

    events.push(
      { seq: 3, type: 'tool/result', data: { turn: 1, step: 1, callId: 'prepare-1', content: [], isError: false } },
      { seq: 4, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: prepared.question }] } } },
      { seq: 5, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      { seq: 6, type: 'turn/start', data: { turn: 2 } },
      { seq: 7, type: 'user/message', data: { content: [{ type: 'text', text: '可以，这两个都发布吧' }], source: { kind: 'user' } } },
      { seq: 8, type: 'user/message', data: { content: [{ type: 'text', text: '插件上下文' }], source: { kind: 'plugin', plugin: 'test' } } },
    )

    await expect(conversation.confirm(agent as never)).resolves.toEqual({
      status: 'published',
      published: 2,
      failed: 0,
      items: [
        { ownedRef: 'owned-weather', name: '天气助手', version: '1.0.0', status: 'published', extensionId: 'ext-owned-weather', publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
        { ownedRef: 'owned-calendar', name: '日程助手', version: '1.0.0', status: 'published', extensionId: 'ext-owned-calendar', publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
      ],
    })
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('invalidates the whole batch before cloud writes when a prepared source changes', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布' }], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-source-change', session: { get events() { return events } } }
    let fingerprint = 'fingerprint-before'
    const publish = vi.fn(async () => ({ extension_id: 'ext-1', version: '1.0.0', status: 'published' as const }))
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => preparedV2(input, fingerprint),
      publish,
      now: () => 1_000,
      createMutationId: () => '00000000-0000-4000-8000-000000000001',
    })
    await conversation.prepare(agent as never, [draft('owned-1', '扩展一')])
    events.push({
      seq: 1, type: 'user/message',
      data: { content: [{ type: 'text', text: '好，发布' }], source: { kind: 'user' } },
    })
    fingerprint = 'fingerprint-after'

    await expect(conversation.confirm(agent as never)).rejects.toThrow('源码或 Bundle 已变化')
    expect(publish).not.toHaveBeenCalled()
    await expect(conversation.confirm(agent as never)).rejects.toThrow('当前没有等待确认')
  })

  it('requires a fresh question when the user changes a prepared publish batch', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 1, type: 'user/message', data: { content: [], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-changed-batch', session: { get events() { return events } } }
    const publish = vi.fn()
    let mutation = 0
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => preparedV2(input, `fingerprint:${input.ownedRef}`),
      publish,
      createMutationId: () => `00000000-0000-4000-8000-${String(++mutation).padStart(12, '0')}`,
    })

    await conversation.prepare(agent as never, [draft('owned-a', '扩展 A')])
    await expect(conversation.prepare(agent as never, [draft('owned-b', '扩展 B')]))
      .rejects.toThrow('已有等待确认的扩展发布批次')
    events.push({
      seq: 2, type: 'user/message',
      data: { content: [{ type: 'text', text: '改成发布 B' }], source: { kind: 'user' } },
    })
    await expect(conversation.prepare(agent as never, [draft('owned-b', '扩展 B')]))
      .resolves.toMatchObject({ status: 'confirmation_required', items: [{ ownedRef: 'owned-b' }] })
    expect(publish).not.toHaveBeenCalled()

    events.push({
      seq: 3, type: 'user/message',
      data: { content: [{ type: 'text', text: 'B 没问题，发布吧' }], source: { kind: 'user' } },
    })
    await conversation.confirm(agent as never)
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ ownedRef: 'owned-b' }), undefined)
  })

  it('returns per-item outcomes when one confirmed publish fails', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布' }], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-partial', session: { get events() { return events } } }
    let mutation = 0
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => preparedV2(input, `fingerprint:${input.ownedRef}`),
      publish: async input => {
        if (input.ownedRef === 'owned-failed') throw new Error('Bundle 校验失败')
        return { extension_id: 'ext-success', version: input.version, status: 'published' }
      },
      now: () => 1_000,
      createMutationId: () => `00000000-0000-4000-8000-${String(++mutation).padStart(12, '0')}`,
    })
    await conversation.prepare(agent as never, [
      draft('owned-success', '成功扩展'),
      draft('owned-failed', '失败扩展'),
    ])
    events.push({
      seq: 1, type: 'user/message',
      data: { content: [{ type: 'text', text: '没问题，继续吧' }], source: { kind: 'user' } },
    })

    await expect(conversation.confirm(agent as never)).resolves.toEqual({
      status: 'completed_with_failures', published: 1, failed: 1,
      items: [
        { ownedRef: 'owned-success', name: '成功扩展', version: '1.0.0', status: 'published', extensionId: 'ext-success', publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
        { ownedRef: 'owned-failed', name: '失败扩展', version: '1.0.0', status: 'failed', message: 'Bundle 校验失败', publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
      ],
    })
  })

  it('does not report a non-terminal registry status as published', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '发布' }], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-validating', session: { get events() { return events } } }
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => preparedV2(input),
      publish: async input => ({ extension_id: 'ext-validating', version: input.version, status: 'validating' }),
      now: () => 1_000,
      createMutationId: () => '00000000-0000-4000-8000-000000000001',
    })
    await conversation.prepare(agent as never, [draft('owned-validating', '校验中扩展')])
    events.push({
      seq: 1, type: 'user/message',
      data: { content: [{ type: 'text', text: '就按这个发布' }], source: { kind: 'user' } },
    })

    await expect(conversation.confirm(agent as never)).resolves.toEqual({
      status: 'completed_with_failures', published: 0, failed: 1,
      items: [{
        ownedRef: 'owned-validating', name: '校验中扩展', version: '1.0.0', status: 'failed',
        message: '扩展发布尚未完成，当前状态：validating',
        publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz',
      }],
    })
  })

  it('makes V2 and V3 routes explicit in one mixed prepare batch', async () => {
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '准备发布两个来源' }], source: { kind: 'user' } } },
    ]
    const agent = { id: 'session-mixed-routes', session: { get events() { return events } } }
    const conversation = new ArkmeExtensionPublishConversation({
      preflight: async input => input.ownedRef === 'owned-native'
        ? preparedV3(input)
        : preparedV2(input),
      publish: vi.fn(),
      now: () => 1_000,
      createMutationId: () => '00000000-0000-4000-8000-000000000001',
    })

    const prepared = await conversation.prepare(agent as never, [
      draft('owned-cordis', 'Cordis 扩展'),
      { ...draft('owned-native', '原生扩展'), githubRepositoryUrl: 'https://github.com/example/native' },
    ])

    expect(prepared.question).toContain('发布方式：V2 沙箱 Bundle（当前会话 Dynamic Cordis Package）')
    expect(prepared.question).toContain('发布方式：V3 原生 DSH Package（原生能力：runtime_dependencies）')
    expect(prepared.question).toContain('GitHub 来源：https://github.com/example/native')
    expect(prepared.items).toMatchObject([
      { publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
      { publishRoute: 'profile-native-v3', artifactContractVersion: 3, artifactKind: 'dsh-native-package-tgz', nativeCapabilities: ['runtime_dependencies'] },
    ])
  })
})
