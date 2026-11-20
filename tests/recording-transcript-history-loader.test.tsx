import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArkmeRecordingTranscriptPage } from '../src/types.js'
const host = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: host }))
import { loadTranscriptHistoryPage, RecordingTranscriptHistoryDialog } from '../src/client/recordings/RecordingTranscriptHistoryDialog.js'
function page(text: string, versionRef = '', nextCursor = ''): ArkmeRecordingTranscriptPage {
  return { dateStamp: 0, retainedSnapshot: true, ...(versionRef ? { versionRef } : {}), viewRef: versionRef || 'current',
    state: 'ready', message: '', processingCount: 0, totalDurationMillis: 0, transcriptSource: 'system', nextCursor,
    items: [{ itemId: text, itemRef: '', sessionKey: '', transcriptSource: 'system', startAtMillis: 0, endAtMillis: 30000,
      speakerKey: '1', speakerNumber: 1, speakerLabel: '说话人', speakerColorIndex: 1, canBindSpeaker: false, isSelf: false, isBackground: false,
      text, textStartOffset: 0, textEndOffset: text.length, textTotalLength: text.length }] }
}
let renderer: ReactTestRenderer | undefined
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; host.mockReset() })
it('joins paginated unicode fragments into a whole bubble before returning', async () => {
  const first = page('你😀', 'old', 'next'), second = page('好', 'old')
  first.items[0] = { ...first.items[0]!, itemId: 'same', textEndOffset: 2, textTotalLength: 3 }
  second.items[0] = { ...second.items[0]!, itemId: 'same', textStartOffset: 2, textEndOffset: 3, textTotalLength: 3 }
  host.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const result = await loadTranscriptHistoryPage(0, undefined, 'old', new AbortController().signal)
  expect(result.items.map(i => i.text)).toEqual(['你😀好'])
})
it('rejects an incorrect version and a repeated cursor', async () => {
  host.mockResolvedValueOnce(page('错的', 'wrong'))
  await expect(loadTranscriptHistoryPage(0, undefined, 'old', new AbortController().signal)).rejects.toThrow('版本不匹配')
  host.mockResolvedValue(page('旧', 'old', 'repeat'))
  await expect(loadTranscriptHistoryPage(0, undefined, 'old', new AbortController().signal)).rejects.toThrow()
})
it('aborts on dialog close and rejects a late response even when transport ignores cancellation', async () => {
  const delayed = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
  host.mockReturnValue(delayed.promise)
  await act(async () => { renderer = create(<RecordingTranscriptHistoryDialog dateStamp={0} versions={{ supported: true, versions: [{ versionRef: 'old', createdAtMillis: 1 }], nextCursor: '' }} onClose={() => {}} renderItem={i => <li key={i.itemId}>{i.text}</li>} />) })
  const signal = host.mock.calls[0]?.[2] as AbortSignal
  await act(async () => { renderer!.unmount(); renderer = undefined })
  expect(signal.aborted).toBe(true)
  await act(async () => delayed.resolve(page('迟到')))
  expect(host).toHaveBeenCalledTimes(1)
})
it('retries a failed history page without losing current or already read versions', async () => {
  host.mockResolvedValueOnce(page('当前')).mockRejectedValueOnce(new Error('暂时失败'))
  await act(async () => { renderer = create(<RecordingTranscriptHistoryDialog dateStamp={0} versions={{ supported: true, versions: [{ versionRef: 'old', createdAtMillis: 1 }], nextCursor: '' }} onClose={() => {}} renderItem={i => <li key={i.itemId}>{i.text}</li>} />) })
  expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('暂时失败')
  expect(JSON.stringify(renderer!.toJSON())).toContain('当前')
  host.mockResolvedValueOnce(page('旧', 'old'))
  await act(async () => { renderer!.root.findAllByType('button').find(b => b.props.children === '重试')!.props.onClick() })
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  expect(renderer!.root.findAll(node => node.type === 'button' && node.props['data-history-period-trigger'] !== undefined)).toHaveLength(1)
})
it('distinguishes versions created within one minute without adding seconds to the timeline', async () => {
  host.mockResolvedValueOnce(page('当前')).mockResolvedValueOnce(page('旧二', 'newer')).mockResolvedValueOnce(page('旧一', 'older'))
  await act(async () => { renderer = create(<RecordingTranscriptHistoryDialog dateStamp={0} timeZone="UTC" versions={{ supported: true, versions: [
    { versionRef: 'newer', createdAtMillis: 58000 }, { versionRef: 'older', createdAtMillis: 3000 },
  ], nextCursor: '' }} onClose={() => {}} renderItem={i => <li key={i.itemId}>{i.text}</li>} />) })
  const trigger = renderer!.root.findAll(node => node.type === 'button' && node.props['data-history-period-trigger'] !== undefined)[0]!
  expect(trigger.props['aria-label']).toBe('查看 00:00 的历史版本')
  await act(async () => trigger.props.onClick())
  const labels = renderer!.root.findAllByProps({ role: 'menuitemradio' }).map(node => node.findByType('span').children.join(''))
  expect(new Set(labels).size).toBe(3)
})
