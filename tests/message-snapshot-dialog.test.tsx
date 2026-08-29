import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeMessageSnapshotDialogContent, arkmeCanOpenMessageSnapshot } from '../src/client/ArkmeMessageSnapshotDialog.js'
import type { ArkmeTimelineItem } from '../src/types.js'

const item: ArkmeTimelineItem = {
  itemUid: 'snapshot-message-1',
  senderName: '测试用户',
  isMe: true,
  sendAtMillis: 1_786_000_000_000,
  title: '',
  textContent: '这是一条快记',
  status: 1,
  messageActionRef: 'arkme-message-action-v1.valid.signature',
}

describe('message snapshot dialog', () => {
  it('makes a failed detail load explicit instead of presenting sparse timeline data as a snapshot', () => {
    const markup = renderToStaticMarkup(<ArkmeMessageSnapshotDialogContent item={item} loadError="完整记录读取失败，请稍后重试" />)

    expect(markup).toContain('这是一条快记')
    expect(markup).toContain('快记详情未加载成功：完整记录读取失败，请稍后重试')
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('aria-label="快记统计"')
    expect(markup).not.toContain('aria-label="记忆快照"')
  })

  it('only exposes the detail action when a current message carries a signed reference', () => {
    expect(arkmeCanOpenMessageSnapshot(item)).toBe(true)
    expect(arkmeCanOpenMessageSnapshot({ ...item, messageActionRef: undefined })).toBe(false)
    expect(arkmeCanOpenMessageSnapshot({ ...item, isMe: false })).toBe(false)
  })

  it('renders Flutter-compatible charging states and keeps zero percent visible', () => {
    const charging = renderToStaticMarkup(<ArkmeMessageSnapshotDialogContent item={item} detail={{
      itemUid: item.itemUid, textContent: item.textContent, backgroundSound: 'not-recorded',
      captureContext: { electric: 100, charge: 1 },
    }} />)
    const dischargingAtZero = renderToStaticMarkup(<ArkmeMessageSnapshotDialogContent item={item} detail={{
      itemUid: item.itemUid, textContent: item.textContent, backgroundSound: 'not-recorded',
      captureContext: { electric: 0, charge: 2 },
    }} />)
    const paused = renderToStaticMarkup(<ArkmeMessageSnapshotDialogContent item={item} detail={{
      itemUid: item.itemUid, textContent: item.textContent, backgroundSound: 'not-recorded',
      captureContext: { electric: 70, charge: 3 },
    }} />)

    expect(charging).toContain('100%（充电中）')
    expect(dischargingAtZero).toContain('0%')
    expect(dischargingAtZero).not.toContain('0%（充电中）')
    expect(paused).toContain('70%（暂停充电）')
  })
})
