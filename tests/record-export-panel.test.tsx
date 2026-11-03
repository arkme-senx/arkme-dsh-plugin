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
const chooseRange = async (range: string) => act(async () => {
  const select = host.querySelector('select')!
  select.value = range; select.dispatchEvent(new Event('change', { bubbles: true }))
})
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
it('allows date selection and presets, hides all-record counts, and never falls back to a full export', async () => {
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight} />))
  await chooseRange('dates')
  expect(host.querySelector('.arkme-export-summary')).toBeNull()
  expect(host.textContent).toContain('后端接口开发中，开发完成后此功能完整可用。')
  expect(host.textContent).toContain('接通前不会创建导出任务或使用额度。')
  const inputs = host.querySelectorAll<HTMLInputElement>('input[type=date]')
  await act(async () => button('上月').click())
  const now = new Date(), lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  expect(inputs[0]!.value.endsWith('-01')).toBe(true)
  expect(inputs[1]!.value.endsWith(`-${String(lastMonthEnd.getDate()).padStart(2, '0')}`)).toBe(true)
  expect(button('导出备份').disabled).toBe(true)
  await act(async () => button('导出备份').click())
  expect(mock.run).not.toHaveBeenCalled()
  await chooseRange('all')
  expect(host.querySelector('.arkme-export-summary')).not.toBeNull()
  expect(button('导出备份').disabled).toBe(false)
})
it('does not interpret the old ZIP finish timestamp as a saved incremental checkpoint', async () => {
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={{ ...preflight, latestAtMillis: 1793691000000 }} />))
  expect(host.textContent).toContain('最近生成备份：')
  await chooseRange('incremental')
  expect(host.textContent).toContain('增量进度尚未接通')
  expect(host.textContent).toContain('补录的旧日期记录')
  expect(host.textContent).not.toContain('最近生成备份：')
  expect(host.querySelector('.arkme-export-summary')).toBeNull()
  expect(button('导出备份').disabled).toBe(true)
  expect(mock.run).not.toHaveBeenCalled()
})
it('validates native date input events immediately instead of leaving the displayed values ahead of state', async () => {
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight} />))
  await chooseRange('dates')
  const inputs = host.querySelectorAll<HTMLInputElement>('input[type=date]')
  await act(async () => {
    inputs[0]!.value = '2026-11-04'; inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }))
    inputs[1]!.value = '2026-11-03'; inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(host.textContent).toContain('结束日期不能早于开始日期。')
  expect(inputs[0]!.getAttribute('aria-invalid')).toBe('true')
  await act(async () => button('最近7天').click())
  expect(host.textContent).not.toContain('结束日期不能早于开始日期。')
  expect(inputs[0]!.getAttribute('aria-invalid')).toBe('false')
})
it('does not let a text-only choice silently include every attachment', async () => {
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight} />))
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  expect(button('导出备份').disabled).toBe(true)
  expect(host.querySelector('.arkme-export-summary')).toBeNull()
  expect(mock.run).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  expect(button('导出备份').disabled).toBe(false)
})
it('does not execute with another account preflight or when there are no records', async () => {
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:12" preflight={preflight} />))
  expect(button('导出备份').disabled).toBe(true)
  expect(host.querySelector('.arkme-export-summary')?.textContent).toContain('—')
  await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={{ ...preflight, recordCount: 0 }} />))
  expect(button('导出备份').disabled).toBe(true)
  expect(host.textContent).toContain('暂无可导出的记录。')
})
