import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeExtensionRecoveryNotice,
  type ArkmeExtensionRecoveryNoticeRequest,
} from '../src/client/ArkmeExtensionRecoveryNotice.js'
import * as clipboard from '../src/client/clipboard-text.js'
import type { ArkmeDesktopQuarantineStatus } from '../src/extensions/desktop-quarantine.js'

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

function status(overrides: Partial<ArkmeDesktopQuarantineStatus> = {}): ArkmeDesktopQuarantineStatus {
  return {
    active: true,
    quarantineId: '01234567-89ab-4cde-8fab-0123456789ab',
    mode: 'targeted',
    failureSummary: '扩展 @example/peer-portrait 启动时加载失败，已自动停用',
    failureLogTail: 'Cannot find package @senguoyun/dsh-arkme imported from local extension',
    entries: [{ packageName: '@example/peer-portrait', dismissed: false, resolved: false }],
    ...overrides,
  }
}

describe('Arkme desktop extension recovery notice', () => {
  it('shows a clear targeted reason, details, extension management, and explicit re-enable', async () => {
    const request = vi.fn<ArkmeExtensionRecoveryNoticeRequest>(async operation => {
      if (operation === 'extensions.quarantine.status') return status()
      return undefined
    })
    const openExtensions = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeExtensionRecoveryNotice request={request} onOpenExtensions={openExtensions} />) })

    expect(text(renderer)).toContain('已安全启动')
    expect(text(renderer)).toContain('扩展 @example/peer-portrait 启动时加载失败，已自动停用')
    expect(text(renderer)).not.toContain('Cannot find package')

    await act(async () => { renderer.root.findByProps({ 'data-arkme-quarantine-action': 'details' }).props.onClick() })
    expect(text(renderer)).toContain('Cannot find package @senguoyun/dsh-arkme')
    await act(async () => { renderer.root.findByProps({ 'data-arkme-quarantine-action': 'extensions' }).props.onClick() })
    expect(openExtensions).toHaveBeenCalledTimes(1)
    await act(async () => { renderer.root.findByProps({ 'data-arkme-quarantine-action': 'reenable' }).props.onClick() })
    expect(request).toHaveBeenCalledWith('extensions.quarantine.reenable', {
      packageName: '@example/peer-portrait',
    })
  })

  it('copies the displayed receipt and repair request without re-enabling the plugin', async () => {
    const copy = vi.spyOn(clipboard, 'copyText')
      .mockRejectedValueOnce(new Error('clipboard unavailable')).mockResolvedValue(undefined)
    try {
      const request = vi.fn<ArkmeExtensionRecoveryNoticeRequest>(async () => status({
        createdAtMillis: 1794204300000,
        entries: [{ packageName: '@local/arkme-arrangement-line', dismissed: false, resolved: false }],
        failureLogTail: 'web boot: 1 entry did not activate\n@local/arkme-arrangement-line: loading',
      }))
      let renderer!: ReactTestRenderer
      await act(async () => { renderer = create(<ArkmeExtensionRecoveryNotice request={request} />) })
      const click = async (action: string) => await act(async () => {
        renderer.root.findByProps({ 'data-arkme-quarantine-action': action }).props.onClick()
      })
      await click('details')
      const details = renderer.root.findByType('pre').children.join('')
      expect(details).toContain('插件来源  未记录')
      await click('copy')
      expect(text(renderer)).toContain('复制失败')
      await click('copy')
      expect(copy.mock.calls[1]?.[0]).toMatch(/^发生时间/)
      expect(copy.mock.calls[1]?.[0]).toContain(details + '\n\n请根据以上诊断')
      expect(text(renderer)).toContain('已复制诊断')
      expect(request).toHaveBeenCalledTimes(1)
    } finally { copy.mockRestore() }
  })

  it('explains local safe mode, lists every disabled package, and dismisses every entry', async () => {
    const localStatus = status({
      mode: 'local-safe-mode',
      failureSummary: '无法确定具体故障扩展，已停用 2 个本地开发扩展',
      entries: [
        { packageName: '@example/local-a', dismissed: false, resolved: false },
        { packageName: '@example/local-b', dismissed: false, resolved: false },
      ],
    })
    const request = vi.fn<ArkmeExtensionRecoveryNoticeRequest>(async operation => {
      if (operation === 'extensions.quarantine.status') return localStatus
      return undefined
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeExtensionRecoveryNotice request={request} />) })

    expect(text(renderer)).toContain('已进入本地扩展安全模式')
    expect(text(renderer)).toContain('无法确定具体故障扩展，已停用 2 个本地开发扩展')
    expect(text(renderer)).toContain('@example/local-a')
    expect(text(renderer)).toContain('@example/local-b')

    await act(async () => { renderer.root.findByProps({ 'data-arkme-quarantine-action': 'dismiss' }).props.onClick() })
    expect(request).toHaveBeenCalledWith('extensions.quarantine.dismiss', { packageName: '@example/local-a' })
    expect(request).toHaveBeenCalledWith('extensions.quarantine.dismiss', { packageName: '@example/local-b' })
    expect(renderer.toJSON()).toBeNull()
  })

  it('stays hidden when there is no active quarantine or every notice was dismissed', async () => {
    for (const value of [
      { active: false, entries: [] } satisfies ArkmeDesktopQuarantineStatus,
      status({ entries: [{ packageName: '@example/local', dismissed: true, resolved: false }] }),
    ]) {
      const request = vi.fn<ArkmeExtensionRecoveryNoticeRequest>(async () => value)
      let renderer!: ReactTestRenderer
      await act(async () => { renderer = create(<ArkmeExtensionRecoveryNotice request={request} />) })
      expect(renderer.toJSON()).toBeNull()
    }
  })

  it('fails closed without unmounting its parent when the Host returns an invalid status payload', async () => {
    for (const value of [{}, undefined]) {
      const request = vi.fn<ArkmeExtensionRecoveryNoticeRequest>(async () => value)
      let renderer!: ReactTestRenderer

      await expect(act(async () => {
        renderer = create(<div data-parent="alive"><ArkmeExtensionRecoveryNotice request={request} /></div>)
      })).resolves.toBeUndefined()

      expect(renderer.root.findByProps({ 'data-parent': 'alive' })).toBeDefined()
      expect(renderer.root.findAllByProps({ 'data-arkme-owned': 'extension-recovery-notice' })).toHaveLength(0)
    }
  })
})
