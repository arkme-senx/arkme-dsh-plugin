// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeRecordExportPanel } from '../src/client/ArkmeRecordExportPanel.js'
const mock = vi.hoisted(() => ({ run: vi.fn(), dispose: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ exportRecords: mock.run, dispose: mock.dispose, localFileUrl: () => '/local.zip' }) }))
let host: HTMLDivElement, root: Root
const preflight = { accountScope: 'test:11', canExport: true, recordCount: 2, imageCount: 1, voiceCount: 1, message: '', latestAtMillis: 0 }
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label)!
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); mock.run.mockReset(); mock.dispose.mockReset() })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it('requires confirmation, reports progress, and offers the finished ZIP without starting another export', async () => {
  let finish!: (value: unknown) => void
  mock.run.mockImplementation(async (_options, _signal, notify) => { notify({ count: 1 }); return new Promise(resolve => { finish = resolve }) })
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight} />))
  await act(async () => button('导出备份').click())
  expect(mock.run).not.toHaveBeenCalled()
  await act(async () => button('确认导出').click())
  expect(host.textContent).toContain('已读取 1 条')
  expect(mock.run.mock.calls[0]![0]).toEqual({ expectedAccountScope: 'test:11', orderKind: 1, confirmed: true })
  await act(async () => finish({ accountScope: 'test:11', count: 2, fileRef: 'ref', fileName: 'backup.zip', quotaFinalized: false }))
  expect(host.querySelector('a')?.download).toBe('backup.zip')
  expect(host.textContent).toContain('请勿重复创建备份')
  expect(mock.dispose).toHaveBeenCalledOnce()
})
it('cancels at the source on leaving the page and suppresses late success', async () => {
  let signal!: AbortSignal
  mock.run.mockImplementation((_options, current) => { signal = current; return new Promise(() => {}) })
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight} />))
  await act(async () => button('导出备份').click())
  await act(async () => button('确认导出').click())
  await act(async () => root.render(<div />))
  expect(signal.aborted).toBe(true)
})
it('blocks export when preflight disallows it', async () => {
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={{ ...preflight, canExport: false }} />))
  expect(button('导出备份').disabled).toBe(true)
  expect(mock.run).not.toHaveBeenCalled()
})
