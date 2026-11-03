import { expect, it } from 'vitest'
import { recordingMegabytesLabel } from '../src/client/recordings/recording-file-storage.js'
import { connectArkmeLocale, tr } from '../src/client/locale.js'

it('keeps all audio sizes in MB, including zero and sub-megabyte files', () => {
  expect(recordingMegabytesLabel(0)).toBe('0.00 MB')
  expect(recordingMegabytesLabel(1)).toBe('0.000001 MB')
  expect(recordingMegabytesLabel(1048576)).toBe('1.00 MB')
  expect(recordingMegabytesLabel(1024 ** 3)).toBe('1,024.00 MB')
})

it('uses the existing Harness locale for the new storage labels and recovery', () => {
  const stop = connectArkmeLocale({ getLocale: () => ({ active: 'en' }), subscribe: () => () => {} })
  try {
    expect(tr('云端 {size}', { size: recordingMegabytesLabel(1048576) })).toBe('Cloud 1.00 MB')
    expect(tr('重试读取存储')).toBe('Retry storage read')
    expect(tr('读取录音存储失败，请重试')).toContain('Please retry')
  } finally {
    stop()
    connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })()
  }
})
