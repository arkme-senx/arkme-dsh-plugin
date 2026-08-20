import { describe, expect, it } from 'vitest'
import type { ArkmeMyExtensionItem } from '../../src/extensions/owned-types.js'
import { myExtensionBadges, myExtensionPrimaryAction, myExtensionWarningText,
  nextExtensionPublishMutation,
} from '../../src/client/my-extension-model.js'

const base: ArkmeMyExtensionItem = {
  ownedRef: 'owned-ref', name: '扩展', description: '', states: [], halves: { host: true, client: false },
  publish: { allowed: false },
}

describe('my-extension view model', () => {
  it('maps the three owner states without client-side identity inference', () => {
    expect(myExtensionBadges(['cordis', 'persisted', 'published']))
      .toEqual(['Cordis 临时', '已持久化', '已发布'])
  })

  it('offers publication only when the Host owner marked an exact Cordis Package publishable', () => {
    expect(myExtensionPrimaryAction({ ...base, states: ['cordis'], publish: { allowed: true, mode: 'new' } }))
      .toEqual({ kind: 'publish', label: '发布' })
    expect(myExtensionPrimaryAction({ ...base, states: ['persisted'], publish: { allowed: false } }))
      .toBeUndefined()
    expect(myExtensionPrimaryAction({ ...base, states: ['published'], publish: { allowed: false } }))
      .toEqual({ kind: 'edit', label: '编辑' })
    expect(myExtensionPrimaryAction({ ...base, states: ['cordis', 'published'], publish: { allowed: true, mode: 'version' } }))
      .toEqual({ kind: 'edit', label: '编辑' })
  })

  it('turns source degradation into one non-blocking user message', () => {
    expect(myExtensionWarningText(['cloud-unavailable', 'profile-entry-invalid']))
      .toBe('部分扩展状态暂不可用，本地可确认的扩展仍已显示。')
    expect(myExtensionWarningText([])).toBe('')
  })

  it('reuses one mutation id for same-version retries and rotates it for a new version', () => {
    let sequence = 0
    const mint = () => `mutation-${String(++sequence)}`
    const first = nextExtensionPublishMutation(undefined, 'owned-ref', '1.0.0', mint)
    const retry = nextExtensionPublishMutation(first, 'owned-ref', '1.0.0', mint)
    const nextVersion = nextExtensionPublishMutation(retry, 'owned-ref', '1.1.0', mint)

    expect(retry.id).toBe(first.id)
    expect(nextVersion.id).not.toBe(first.id)
  })
})
