import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingFilePicker } from '../src/client/recordings/recording-file-picker.js'

afterEach(() => vi.restoreAllMocks())

describe('recording chooser diagnostics', () => {
  it('suppresses competing requests while preserving the first chooser', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    let resolve!: (value: string[]) => void
    const picker = new RecordingFilePicker()
    const first = picker.run('browser', () => new Promise<string[]>(done => { resolve = done }))
    const competing = vi.fn(async () => [])
    expect(await picker.run('browser', competing)).toEqual({ status: 'busy' })
    expect(competing).not.toHaveBeenCalled()
    resolve(['selected'])
    expect(await first).toEqual({ status: 'selected', value: ['selected'] })
    expect(log.mock.calls.some(([, entry]) => String(entry).includes('duplicate-suppressed'))).toBe(true)
    expect(await picker.run('browser', async () => [])).toEqual({ status: 'selected', value: [] })
  })
  it('does not attribute an ordinary cross-realm cancellation to the user', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const picker = new RecordingFilePicker()
    expect(await picker.run('browser', async () => { throw { name: 'AbortError', message: 'The user aborted a request.' } }))
      .toEqual({ status: 'cancelled' })
    expect(log.mock.calls.some(([, entry]) => String(entry).includes('"cancellationOwner":"unknown"'))).toBe(true)
  })
  it('surfaces real failures and cancellation following owner disposal', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const picker = new RecordingFilePicker()
    expect(await picker.run('browser', async () => { throw new DOMException('File picker already active.', 'NotAllowedError') }))
      .toEqual({ status: 'error', message: '无法打开文件选择器：File picker already active.' })
    expect(await picker.run('browser', async () => { picker.interrupt('dialog-close-requested'); throw new DOMException('aborted', 'AbortError') }))
      .toEqual({ status: 'error', message: '文件选择器意外关闭，请重试' })
  })
  it('redacts local paths from chooser failures and diagnostics', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const result = await new RecordingFilePicker().run('desktop', async () => { throw new Error('Cannot open /Users/person/Private Audio.wav') })
    expect(result).toEqual({ status: 'error', message: '无法打开文件选择器：Cannot open [path]' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('/Users/person')
  })

})
