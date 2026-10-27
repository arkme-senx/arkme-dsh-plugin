// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call }))
import { RecordingDayStrategyComparison } from '../src/client/recordings/RecordingDayStrategyComparison.js'
import { canStartDayComparison, readDayComparisonOptions, readDayComparisonSources } from '../src/client/recordings/recording-comparison-day.js'
import { RECORDING_STRATEGIES } from '../src/recording-strategy-contract.js'
const baseline = 'baseline-sd-asr/20261026', current = 'system-sd-asr/v1'
const day = new Date(2026, 9, 14).getTime()
let root: Root | undefined
const source = (ref: string, start = day) => ({ sourceRef: ref, fileName: `${ref}.wav`, startAtMillis: start })
const options = (official = baseline) => ({ strategies: RECORDING_STRATEGIES, officialStrategy: official, officialComplete: true, officialFailed: false, canStart: true, expiresAtMillis: Date.now() + 60_000, results: [] as any[] })
const utterance = (ref: string, start = day + 1000) => ({ itemRef: ref, startAtMillis: start, endAtMillis: start + 500, speaker: 0, text: `正文 ${ref}` })
const read = async (_op: string, p: any) => {
  if (p.action === 'recordings') return { items: [{ sessionRef: 'session', startAtMillis: day, endAtMillis: day + 7200_000 }] }
  if (p.action === 'sources') return { items: [source('one'), source('two', day + 3600_000)] }
  if (p.action === 'options') return options(p.sourceRef === 'one' ? baseline : current)
  if (p.action === 'page') return { items: [utterance(`${p.sourceRef}-${p.strategy}`, day + (p.sourceRef === 'one' ? 1 : 3600) * 1000)], complete: true, failed: false }
  return { accepted: true }
}
async function render(strategy: typeof current | typeof baseline = current) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<RecordingDayStrategyComparison dateStamp={day} strategy={strategy} mediaPath="/media" onClose={() => {}} />))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api.call.mockReset().mockImplementation(read)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.querySelectorAll('[data-transcript-time]').length * 80 })
})
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('shows every recording in the selected day without choosing an hour, preserving mixed official strategies', async () => {
  await render()
  expect(document.body.textContent).toContain('当天全部录音')
  expect(document.querySelectorAll('select')).toHaveLength(0)
  const official = document.querySelector('section[aria-label="系统转写 · 正式结果"]')!
  expect(official.textContent).toContain(`正文 one-${baseline}`)
  expect(official.textContent).toContain(`正文 two-${current}`)
  expect(official.textContent).toContain('默认版 · 正式结果'); expect(official.textContent).toContain('测试版v1 · 正式结果')
  expect(document.querySelector('section[aria-label="测试版v1 · 对比结果"]')!.textContent).toContain('尚未生成')
  expect(api.call.mock.calls.some(([op]) => op.endsWith('.start'))).toBe(false)
})
it('follows empty recording pages and all source pages, rather than stopping at the first 50 recordings', async () => {
  api.call.mockImplementation(async (_op, p) => {
    if (p.action === 'recordings') return !p.cursor ? { items: [], nextCursor: 'after-empty' } : { items: [{ sessionRef: 'session', startAtMillis: day, endAtMillis: day + 1 }] }
    return !p.cursor ? { items: [source('first')], nextCursor: 'next-source' } : { items: [source('second')] }
  })
  const rows = await readDayComparisonSources(day, new AbortController().signal)
  expect(rows.map(row => row.sourceRef)).toEqual(['first', 'second'])
  expect(api.call.mock.calls.map(([, p]) => p.cursor)).toEqual([undefined, 'after-empty', undefined, 'next-source'])
})
it('bounds options requests and retains per-source errors without losing the other files', async () => {
  let active = 0, peak = 0
  api.call.mockImplementation(async (_op, p) => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1)); active--
    if (p.sourceRef === '3') throw new Error('文件暂时不可用')
    return options()
  })
  const rows = await readDayComparisonOptions(Array.from({ length: 9 }, (_, i) => source(String(i))), new AbortController().signal)
  expect(peak).toBe(3); expect(rows[3]!.error).toBe('文件暂时不可用')
  expect(rows.filter(row => row.options)).toHaveLength(8)
})
it('reads later recordings while an earlier one is pending, then resumes it without duplicating later results', async () => {
  vi.useFakeTimers(); let complete = false
  api.call.mockImplementation(async (op, p) => {
    if (p.action === 'options' && p.sourceRef === 'one') return { ...options(), officialComplete: complete, canStart: false }
    if (p.action === 'page' && p.sourceRef === 'one') return { items: complete ? [utterance('recovered')] : [], complete, failed: false }
    return read(op, p)
  })
  await render()
  expect(document.body.textContent).toContain(`正文 two-${current}`)
  complete = true
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(document.body.textContent).toContain('正文 recovered')
  const official = document.querySelector('section[aria-label="系统转写 · 正式结果"]')!
  expect(official.querySelectorAll('[data-transcript-time]')).toHaveLength(2)
})
it('limits a cross-midnight source to utterances overlapping the selected day', async () => {
  api.call.mockImplementation(async (op, p) => {
    if (p.action === 'sources') return { items: [source('overnight', day - 3600_000)] }
    if (p.action === 'page') return { items: [utterance('yesterday', day - 1000), { ...utterance('boundary', day - 100), endAtMillis: day + 100 }, utterance('today'), utterance('tomorrow', day + 86400_000)], complete: true, failed: false }
    return read(op, p)
  })
  await render()
  expect(document.body.textContent).toContain('正文 boundary'); expect(document.body.textContent).toContain('正文 today')
  expect(document.body.textContent).not.toContain('正文 yesterday'); expect(document.body.textContent).not.toContain('正文 tomorrow')
})
it('submits only eligible missing results on explicit action and does not resubmit an already official file', async () => {
  let started = false
  api.call.mockImplementation(async (op, p) => {
    if (op.endsWith('.start')) { started = true; return { accepted: true } }
    if (p.action === 'options' && p.sourceRef === 'one') return { ...options(), results: started ? [{ strategy: current, complete: true, failed: false }] : [] }
    return read(op, p)
  })
  await render()
  const button = Array.from(document.querySelectorAll('button')).find(row => row.textContent === '处理当天未生成部分（1）')!
  await act(async () => { button.click(); button.click() })
  expect(api.call.mock.calls.filter(([op]) => op.endsWith('.start'))).toHaveLength(1)
  expect(api.call).toHaveBeenCalledWith('recordings.strategies.start', { sourceRef: 'one', strategy: current }, expect.any(AbortSignal))
  expect(document.body.textContent).toContain('已提交 1 个音频')
})
it('rechecks retention at submission and never submits an expired source', async () => {
  let expired = false
  api.call.mockImplementation(async (op, p) => p.action === 'options' && p.sourceRef === 'one' ? { ...options(), canStart: !expired, expiresAtMillis: expired ? 1 : Date.now() + 60_000 } : read(op, p))
  await render(); expired = true
  await act(async () => Array.from(document.querySelectorAll('button')).find(row => row.textContent?.startsWith('处理当天未生成'))!.click())
  expect(api.call.mock.calls.some(([op]) => op.endsWith('.start'))).toBe(false)
  expect(document.body.textContent).toContain('处理条件已变化')
})
it('keeps old results readable after original expiry and does not offer a processing button', async () => {
  api.call.mockImplementation(async (op, p) => p.action === 'options' ? { ...options(), canStart: false, results: [{ strategy: current, complete: true, failed: false }] } : read(op, p))
  await render()
  expect(document.body.textContent).toContain(`正文 one-${current}`)
  expect(document.body.textContent).not.toContain('处理当天未生成部分')
  expect(canStartDayComparison({ ...source('expired'), options: { ...options(), expiresAtMillis: 1 } }, current)).toBe(false)
})
it('cancels discovery when closed, ignoring a late result', async () => {
  let finish!: (result: unknown) => void
  api.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render()
  const signal = api.call.mock.calls[0]![2] as AbortSignal
  await act(async () => root!.unmount()); root = undefined
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ items: [] }))
  expect(api.call).toHaveBeenCalledOnce()
})

it('excludes earlier files in a multi-day session but retains actual midnight overlaps', async () => {
 api.call.mockImplementation(async (op,p) => p.action==='sources' ? {items:[
  {...source('past',day-7200000),endAtMillis:day-3600000},
  {...source('boundary',day-3600000),endAtMillis:day},
  {...source('overlap',day-3600000),endAtMillis:day+3600000},
  source('unknown',day-1000), source('today'), source('tomorrow',day+86400000),
 ]} : read(op,p))
 const rows = await readDayComparisonSources(day,new AbortController().signal)
 expect(rows.map(row=>row.sourceRef)).toEqual(['overlap','unknown','today'])
 expect(canStartDayComparison({...rows[1]!,options:options()},current)).toBe(false)
 expect(canStartDayComparison({...rows[0]!,options:options()},current)).toBe(true)
})
it('retains submitted files after a partial failure and retries only the missing result', async () => {
 const started = new Set<string>(); let fail=true
 api.call.mockImplementation(async (op,p)=>{
  if(p.action==='options')return {...options(),results:started.has(p.sourceRef)?[{strategy:current,complete:true,failed:false}]:[]}
  if(op.endsWith('.start')){if(p.sourceRef==='two'&&fail)throw Error('暂时失败');started.add(p.sourceRef);return {accepted:true}}
  return read(op,p)
 })
 await render()
 const start=()=>Array.from(document.querySelectorAll('button')).find(row=>row.textContent?.startsWith('处理当天未生成'))!
 await act(async()=>start().click())
 expect(document.body.textContent).toContain('1 个音频提交失败')
 fail=false
 await act(async()=>start().click())
 expect(api.call.mock.calls.filter(([op,p])=>op.endsWith('.start')&&p.sourceRef==='one')).toHaveLength(1)
 expect(started.size).toBe(2)
})

it('keeps completed empty files out of the reading area and groups their status in collapsed details', async () => {
  api.call.mockImplementation(async (op, p) => {
    if (p.action === 'sources') return { items: Array.from({ length: 9 }, (_, index) => source(String(index), day + index * 3600_000)) }
    if (p.action === 'options') return { ...options(), results: [{ strategy: current, complete: true, failed: false }] }
    if (p.action === 'page') return { items: p.sourceRef === '8' ? [utterance('last', day + 8 * 3600_000)] : [], complete: true, failed: false }
    return read(op, p)
  })
  await render()
  const column = document.querySelector('section[aria-label="测试版v1 · 对比结果"]')!
  expect(column.textContent).toContain('已完成 9 / 9')
  expect(column.querySelector('details')?.open).toBe(false)
  expect(column.querySelectorAll('[data-comparison-source]')).toHaveLength(1)
  expect(column.querySelectorAll('[data-transcript-time]')).toHaveLength(1)
  expect(column.textContent).not.toContain('当前日期没有可展示的转写内容。')
  expect(api.call.mock.calls.some(([op]) => op.endsWith('.start'))).toBe(false)
})

it('summarizes pending, failed and missing sources without hiding completed text or offering to rerun existing results', async () => {
  api.call.mockImplementation(async (op, p) => {
    if (p.action === 'sources') return { items: ['ready', 'pending', 'failed', 'missing'].map((ref, index) => source(ref, day + index * 3600_000)) }
    if (p.action === 'options') return { ...options(), results: p.sourceRef === 'missing' ? [] : [{ strategy: current, complete: p.sourceRef !== 'pending', failed: p.sourceRef === 'failed' }] }
    if (p.action === 'page') return { items: p.sourceRef === 'ready' ? [utterance('kept')] : [], complete: p.sourceRef !== 'pending', failed: p.sourceRef === 'failed' }
    return read(op, p)
  })
  await render()
  const column = document.querySelector('section[aria-label="测试版v1 · 对比结果"]')!
  expect(column.textContent).toContain('已完成 1 / 4')
  expect(column.textContent).toContain('处理中 1')
  expect(column.textContent).toContain('处理失败 1')
  expect(column.textContent).toContain('未生成 1')
  expect(column.querySelectorAll('[data-comparison-source]')).toHaveLength(1)
  expect(column.textContent).toContain('正文 kept')
  expect(column.textContent).toContain('处理当天未生成部分（1）')
  expect(api.call.mock.calls.some(([op]) => op.endsWith('.start'))).toBe(false)
})

it('shows a single honest empty state only after all completed sources have been read', async () => {
  api.call.mockImplementation(async (op, p) => {
    if (p.action === 'options') return { ...options(), results: [{ strategy: current, complete: true, failed: false }] }
    if (p.action === 'page') return { items: [], complete: true, failed: false }
    return read(op, p)
  })
  await render()
  const column = document.querySelector('section[aria-label="测试版v1 · 对比结果"]')!
  expect(column.querySelectorAll('[data-comparison-empty]')).toHaveLength(1)
  expect(column.querySelectorAll('[data-comparison-source]')).toHaveLength(0)
  expect(column.textContent).toContain('已完成，当天没有可展示的转写内容')
  expect(api.call.mock.calls.filter(([, p]) => p.action === 'page' && p.strategy === current)).toHaveLength(2)
})
