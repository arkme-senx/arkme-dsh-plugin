// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordingEntityDay } from '../src/recording-entity-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { RecordingEntityPanel } from '../src/client/recordings/RecordingEntityPanel.js'
import { useRecordingEntities } from '../src/client/recordings/use-recording-entities.js'
import { RecordingTranscriptText } from '../src/client/recordings/RecordingTranscriptText.js'
import { createRecordingEntityUnderliner } from '../src/client/recordings/recording-entity-underlines.js'

let root: Root, host: HTMLDivElement
const day = (overrides: Partial<RecordingEntityDay> = {}): RecordingEntityDay => ({ dateStamp: 123, transcriptSource: 'system', status: 'processing',
  viewMode: 'provisional', version: 'v1', stateRevision: 1, projectionRevision: 1, pollable: true, stage: 'discovering', completedUnits: 1, totalUnits: 2,
  entities: [{ key: 'place', entityRef: 'opaque', name: '武汉', type: 3, typeLabel: '', occurrenceCount: 2 }], ...overrides })
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); mocks.call.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
let owner: ReturnType<typeof useRecordingEntities>
function Harness({ account = 'test:42', date = 123, active = true }) { owner = useRecordingEntities(account, date, active, '0'); return <div>{owner.data?.entities?.map(e => e.name).join(',')}</div> }

it('reads on attach, retains incremental results and stops polling after close', async () => {
  vi.useFakeTimers()
  mocks.call.mockResolvedValue(day())
  await act(async () => { root.render(<Harness />); await tick() })
  expect(mocks.call).toHaveBeenCalledTimes(1)
  await act(async () => { owner.setOpen(true); await tick() })
  mocks.call.mockResolvedValue(day({ entities: undefined, stateRevision: 2 }))
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(host.textContent).toBe('武汉')
  await act(async () => { owner.setOpen(false); await tick() })
  const count = mocks.call.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(mocks.call).toHaveBeenCalledTimes(count)
  expect(mocks.call.mock.calls.every(([operation]) => operation === 'recordings.entities')).toBe(true)
})

it('drops late account/day responses and cancels the old request', async () => {
  let resolve!: (data: RecordingEntityDay) => void
  mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(day({ version: 'v2', entities: [] }))
  await act(async () => { root.render(<Harness />); await tick() })
  const signal = mocks.call.mock.calls[0]![2] as AbortSignal
  await act(async () => { root.render(<Harness account="test:43" date={456} />); await tick() })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve(day()); await tick() })
  expect(host.textContent).not.toContain('武汉')
})

it('bounds repeated failures and suspends hidden-page polling', async () => {
  vi.useFakeTimers(); mocks.call.mockResolvedValue(day())
  await act(async () => { root.render(<Harness />); await tick() })
  await act(async () => { owner.setOpen(true); await tick() })
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await tick() })
  const beforeHidden = mocks.call.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(mocks.call).toHaveBeenCalledTimes(beforeHidden)
  visibility.mockReturnValue('visible')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await tick() })
  mocks.call.mockRejectedValue(new Error('offline'))
  await act(async () => { await vi.advanceTimersByTimeAsync(40000) })
  expect(owner.paused).toBe(true)
  const count = mocks.call.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(mocks.call).toHaveBeenCalledTimes(count)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await tick() })
  expect(owner.data?.entities).toHaveLength(1)
  vi.restoreAllMocks()
})

it('filters and windows entities, loads only selected mentions, and locates with keyboard close', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  const onClose = vi.fn(), onLocate = vi.fn(() => true)
  const original = day().entities![0]!
  const data = day({ entities: Array.from({ length: 35 }, (_, i) => ({ ...original, key: String(i), name: `地点${i}` })) })
  mocks.call.mockResolvedValue({ version: 'v1', offset: 0, total: 1, hasMore: false, items: [{ key: 'o', startAtMillis: 123, text: '走到武汉', observedText: '武汉', target: { identityHash: 'hash', transcriptVersion: 'v', transcriptSource: 'system', start: 2, length: 2 } }] })
  await act(async () => root.render(<RecordingEntityPanel data={data} loading={false} error={false} paused={false} compact={true} onClose={onClose} onRefresh={() => {}} onLocate={onLocate} />))
  expect(host.querySelectorAll('.arkme-entity-item')).toHaveLength(20)
  expect(mocks.call).not.toHaveBeenCalled()
  await act(async () => { (host.querySelector('.arkme-entity-item-title') as HTMLButtonElement).click(); await tick() })
  expect(mocks.call).toHaveBeenCalledOnce()
  await act(async () => { (host.querySelector('.arkme-entity-occurrence') as HTMLButtonElement).click() })
  expect(onLocate).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce()
  const people = [...host.querySelectorAll('button')].find(button => button.textContent === '人物')!
  await act(async () => people.click())
  expect(host.textContent).toContain('当前类型下没有实体')
})

it.each([
  ['queued', '等待实体识别'],
  ['preparing', '正在准备识别'],
  ['waiting_transcript', '等待转写完成'],
  ['waiting_more_transcript', '等待剩余转写完成'],
  ['discovering', '正在识别实体 · 1/2'],
  ['reviewing', '正在核对实体 · 1/2'],
  ['publishing', '正在保存结果'],
  ['recovering', '正在恢复识别'],
  ['future_stage', '正在处理实体'],
])('shows %s progress above usable existing entities', async (stage, copy) => {
  const onLocate = vi.fn(() => true)
  mocks.call.mockResolvedValue({ version: 'v1', offset: 0, total: 1, hasMore: false, items: [{ key: 'o', startAtMillis: 123, text: '走到武汉', target: { identityHash: 'hash', transcriptVersion: 'v', transcriptSource: 'system', start: 2, length: 2 } }] })
  await act(async () => { root.render(<RecordingEntityPanel data={day({ stage })} loading={false} error={false} paused={false} compact={false}
    onClose={() => {}} onRefresh={() => {}} onLocate={onLocate} />); await tick() })
  expect(host.querySelector('.arkme-entity-status [role="status"]')?.textContent).toBe(copy)
  const title = host.querySelector<HTMLButtonElement>('.arkme-entity-item-title')!
  expect(title.textContent).toContain('武汉')
  await act(async () => { title.click(); await tick() })
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-occurrence')!.click() })
  expect(onLocate).toHaveBeenCalledOnce()
})

it('keeps expanded mentions usable while progress changes, refreshes or pauses', async () => {
  const onRefresh = vi.fn(), onLocate = vi.fn(() => true)
  mocks.call.mockResolvedValue({ version: 'v1', offset: 0, total: 1, hasMore: false, items: [{ key: 'o', startAtMillis: 123, text: '走到武汉', target: { identityHash: 'hash', transcriptVersion: 'v', transcriptSource: 'system', start: 2, length: 2 } }] })
  const render = (stage: string, loading = false, error = false, paused = false) => root.render(<RecordingEntityPanel data={day({ stage })}
    loading={loading} error={error} paused={paused} compact={false} onClose={() => {}} onRefresh={onRefresh} onLocate={onLocate} />)
  await act(async () => { render('discovering'); await tick() })
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-item-title')!.click(); await tick() })
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-status button')!.click(); await tick() })
  expect(onRefresh).toHaveBeenCalledOnce()
  await act(async () => { render('waiting_more_transcript', true); await tick() })
  expect(host.querySelector('.arkme-entity-status [role="status"]')?.textContent).toBe('等待剩余转写完成')
  await act(async () => { render('reviewing', false, true, true); await tick() })
  expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')?.textContent).toContain('武汉')
  expect(host.querySelector('.arkme-entity-status [role="alert"]')?.textContent).toContain('实体更新失败')
  expect(host.querySelector('.arkme-entity-status')?.textContent).toContain('自动更新已暂停')
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-occurrence')!.click() })
  expect(onLocate).toHaveBeenCalledOnce()
  expect(mocks.call).toHaveBeenCalledOnce()
})

it('removes the banner on success while retaining entities and shows recoverable errors', async () => {
  const render = (data: RecordingEntityDay, error = false) => root.render(<RecordingEntityPanel data={data}
    loading={false} error={error} paused={false} compact={false} onClose={() => {}} onRefresh={() => {}} onLocate={() => true} />)
  await act(async () => render(day()))
  const item = host.querySelector('.arkme-entity-item-title')
  expect(host.querySelector('.arkme-entity-status')).not.toBeNull()
  const completed = day({ status: 'succeeded', stage: 'succeeded', pollable: false })
  await act(async () => render(completed))
  expect(host.querySelector('.arkme-entity-status')).toBeNull()
  expect(host.querySelector('.arkme-entity-item-title')).toBe(item)
  await act(async () => render(completed, true))
  expect(host.querySelector('.arkme-entity-status [role="alert"]')?.textContent).toContain('实体更新失败')
  expect(host.querySelector('.arkme-entity-item-title')).toBe(item)
  await act(async () => render({ ...completed, transcriptHealth: { pendingUnits: 0, processingUnits: 0, readyUnits: 1, failedUnits: 1, unavailableUnits: 0 } }))
  expect(host.querySelector('.arkme-entity-status')?.textContent).toContain('部分转写异常')
  await act(async () => render({ ...completed, entities: [] }))
  expect(host.querySelector('.arkme-entity-status')).toBeNull()
  expect(host.textContent).toContain('暂无已识别实体')
})

it('dismisses on outside pointer down but leaves entity triggers and internal controls in charge', async () => {
  const onClose = vi.fn()
  await act(async () => root.render(<><button data-recording-entity-trigger><span>实体入口</span></button>
    <span data-recording-entity-key="place">武汉</span>
    <RecordingEntityPanel data={day()} loading={false} error={false} paused={false} compact={false}
      onClose={onClose} onRefresh={() => {}} onLocate={() => true} /></>))
  host.querySelector<HTMLElement>('[role="separator"]')!.setPointerCapture = vi.fn()
  for (const selector of ['[data-recording-entity-trigger] span', '[data-recording-entity-key]', '.arkme-entity-types button', '[role="separator"]']) {
    await act(async () => host.querySelector(selector)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  }
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
  expect(onClose).toHaveBeenCalledOnce()
})

it('retries failed mentions on refresh without collapsing the entity when its version is unchanged', async () => {
  const onRefresh = vi.fn()
  mocks.call.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ version: 'v1', offset: 0, total: 0, hasMore: false, items: [] })
  await act(async () => { root.render(<RecordingEntityPanel data={day()} loading={false} error={false} paused={false} compact={false}
    onClose={() => {}} onRefresh={onRefresh} onLocate={() => true} />); await tick() })
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-item-title')!.click(); await tick() })
  expect(host.querySelector('.arkme-entity-occurrences [role="alert"]')).not.toBeNull()
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-status button')!.click(); await tick() })
  expect(onRefresh).toHaveBeenCalledOnce()
  expect(mocks.call).toHaveBeenCalledTimes(2)
  expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')).not.toBeNull()
  expect(host.querySelector('.arkme-entity-occurrences [role="alert"]')).toBeNull()
  expect(host.querySelector('.arkme-entity-occurrences')?.textContent).toBe('暂无可用提及')
})

it('composes entity and search highlights without altering visible Unicode text', () => {
  act(() => root.render(<RecordingTranscriptText text="🙂武汉欢迎你" matches={[{ itemId: 'i', start: 2, length: 2, index: 0 }]} activeIndex={0} entityRange={{ start: 1, length: 2 }} />))
  expect(host.textContent).toBe('🙂武汉欢迎你')
  expect([...host.querySelectorAll('[data-recording-entity-highlight]')].map(node => node.textContent).join('')).toBe('武汉')
  expect(host.querySelector('mark [data-recording-entity-highlight]')?.textContent).toBe('汉')
})

it('underlines all entity ranges before selection and adds selection styling only to the chosen mention', () => {
  const text = '🙂武汉欢迎你，武汉再见'
  const ranges = [{ start: 1, length: 2 }, { start: 7, length: 2 }]
  act(() => root.render(<RecordingTranscriptText text={text} matches={[]} activeIndex={-1} entityRanges={ranges} />))
  expect(host.textContent).toBe(text)
  expect(host.querySelectorAll('[data-recording-entity-underline]')).toHaveLength(2)
  expect(host.querySelector('[data-recording-entity-highlight]')).toBeNull()
  act(() => root.render(<RecordingTranscriptText text={text} matches={[]} activeIndex={-1} entityRanges={ranges} entityRange={ranges[1]} />))
  expect(host.querySelectorAll('[data-recording-entity-underline]')).toHaveLength(2)
  const selected = host.querySelector<HTMLElement>('[data-recording-entity-highlight]')!
  expect(selected.textContent).toBe('武汉')
  expect(selected.style.boxShadow).not.toBe('')
  act(() => root.render(<RecordingTranscriptText text={text} matches={[]} activeIndex={-1} entityRanges={ranges} />))
  expect(host.querySelector('[data-recording-entity-highlight]')).toBeNull()
  expect(host.querySelectorAll('[data-recording-entity-underline]')).toHaveLength(2)
})

it('preserves overlapping default underlines, selection and search without repeating text', () => {
  const text = '🙂武汉市欢迎你'
  act(() => root.render(<RecordingTranscriptText text={text} matches={[{ itemId: 'i', start: 2, length: 3, index: 0 }]} activeIndex={0}
    entityRanges={[{ start: 1, length: 3 }, { start: 2, length: 2 }]} entityRange={{ start: 1, length: 2 }} />))
  expect(host.textContent).toBe(text)
  expect([...host.querySelectorAll('[data-recording-entity-underline]')].map(node => node.textContent).join('')).toBe('武汉市')
  expect([...host.querySelectorAll('[data-recording-entity-highlight]')].map(node => node.textContent).join('')).toBe('武汉')
  expect([...host.querySelectorAll('mark')].map(node => node.textContent).join('')).toBe('汉市欢')
})

it('reveals an offscreen underlined entity without pagination and restores keyboard focus on close', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  const data = day({ entities: Array.from({ length: 65 }, (_, i) => ({ ...day().entities![0]!, key: String(i), entityRef: `ref-${i}`, name: `地点${i}` })) })
  const parentClick = vi.fn()
  mocks.call.mockResolvedValue({ version: 'v1', offset: 0, total: 0, hasMore: false, items: [] })
  function LinkedTranscript() {
    const [reveal, setReveal] = useState<{ key: string; sequence: number }>()
    return <div onClick={parentClick} onDoubleClick={parentClick}>
      <RecordingTranscriptText text="🙂地点34和地点2" matches={[{ itemId: 'i', index: 0, start: 2, length: 1 }]} activeIndex={0}
        entityRanges={createRecordingEntityUnderliner(data.entities!)('🙂地点34和地点2')}
        onEntityClick={key => setReveal(previous => ({ key, sequence: (previous?.sequence ?? 0) + 1 }))} />
      {reveal && <RecordingEntityPanel data={data} reveal={reveal} loading={false} error={false} paused={false} compact={true}
        onClose={() => setReveal(undefined)} onRefresh={() => {}} onLocate={() => true} />}
    </div>
  }
  await act(async () => { root.render(<LinkedTranscript />); await tick() })
  expect(mocks.call).not.toHaveBeenCalled()
  const link = host.querySelector<HTMLElement>('mark [data-recording-entity-key="34"]')!
  link.focus()
  await act(async () => { link.click(); await tick() })
  expect(parentClick).not.toHaveBeenCalled()
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  const expanded = host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')!
  expect(expanded.textContent).toContain('地点34')
  expect(document.activeElement).toBe(expanded)
  expect(host.querySelectorAll('.arkme-entity-item')).toHaveLength(40)
  expect(host.textContent).not.toContain('下一页实体')
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith('recordings.entities.occurrences', { entityRef: 'ref-34', offset: 0, limit: 50 }, expect.any(AbortSignal))
  await act(async () => { expanded.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick() })
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(link)
  expect(host.textContent).toBe('🙂地点34和地点2')
  const second = host.querySelector<HTMLElement>('[data-recording-entity-key="2"]')!
  second.focus()
  await act(async () => { second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick() })
  expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')?.textContent).toContain('地点2')
  expect(host.querySelectorAll('.arkme-entity-item')).toHaveLength(20)
})

it('re-reveals the same entity after filtering and cancels stale mentions when switching targets', async () => {
  const data = day({ entities: Array.from({ length: 65 }, (_, i) => ({ ...day().entities![0]!, key: String(i), entityRef: `ref-${i}`, name: `地点${i}` })) })
  let oldResult!: (value: unknown) => void
  mocks.call.mockImplementationOnce(() => new Promise(resolve => { oldResult = resolve }))
    .mockResolvedValue({ version: 'v1', offset: 0, total: 0, hasMore: false, items: [] })
  const render = (key: string, sequence: number) => root.render(<RecordingEntityPanel data={data} reveal={{ key, sequence }}
    loading={false} error={false} paused={false} compact={false} onClose={() => {}} onRefresh={() => {}} onLocate={() => true} />)
  await act(async () => { render('34', 1); await tick() })
  const signal = mocks.call.mock.calls[0]![2] as AbortSignal
  await act(async () => { render('2', 2); await tick() })
  expect(signal.aborted).toBe(true)
  await act(async () => { oldResult({ version: 'v1', offset: 0, total: 1, items: [{ key: 'old', text: '迟到的提及' }] }); await tick() })
  expect(host.textContent).not.toContain('迟到的提及')
  expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')?.textContent).toContain('地点2')
  const people = [...host.querySelectorAll('button')].find(button => button.textContent === '人物')!
  await act(async () => { people.click(); await tick() })
  expect(host.textContent).toContain('当前类型下没有实体')
  mocks.call.mockImplementationOnce(() => new Promise(() => {}))
  await act(async () => { render('2', 3); await tick() })
  expect(host.querySelector('.arkme-entity-types [aria-pressed="true"]')?.textContent).toBe('全部')
  expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')?.textContent).toContain('地点2')
  const calls = mocks.call.mock.calls.length
  await act(async () => { root.unmount(); await tick() })
  expect((mocks.call.mock.calls.at(-1)![2] as AbortSignal).aborted).toBe(true)
  expect(mocks.call).toHaveBeenCalledTimes(calls)
  root = createRoot(host)
})

it('supports Space on an entity link without bubbling into transcript playback or selection', () => {
  const onEntityClick = vi.fn(), parent = vi.fn()
  act(() => root.render(<div onClick={parent} onDoubleClick={parent} onKeyDown={parent}><RecordingTranscriptText text="武汉" matches={[]} activeIndex={-1}
    entityRanges={createRecordingEntityUnderliner(day().entities!)('武汉')} onEntityClick={onEntityClick} /></div>))
  const link = host.querySelector<HTMLElement>('[role="button"]')!
  expect(link.getAttribute('aria-label')).toContain('武汉')
  act(() => {
    link.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    link.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
  expect(onEntityClick).toHaveBeenCalledExactlyOnceWith('place')
  expect(parent).not.toHaveBeenCalled()
})

it('retains filter, expanded mentions, scroll and width after close and locate, and isolates account/day scopes', async () => {
  const data = day({ entities: [
    { ...day().entities![0]!, key: 'person', name: '老王', type: 1 },
    day().entities![0]!,
  ] })
  mocks.call.mockResolvedValue({ version: 'v1', offset: 0, total: 1, hasMore: false, items: [{ key: 'o', startAtMillis: 123, text: '老王来了', target: {} }] })
  function Retained({ scope = 'account1:day1' }) {
    const [open, setOpen] = useState(true)
    return <><button onClick={() => setOpen(true)}>打开</button><RecordingEntityPanel key={scope} data={data} open={open}
      loading={false} error={false} paused={false} compact={true} onClose={() => setOpen(false)} onRefresh={() => {}} onLocate={() => true} /></>
  }
  await act(async () => { root.render(<Retained />); await tick() })
  const people = [...host.querySelectorAll('button')].find(button => button.textContent === '人物')!
  await act(async () => { people.click(); host.querySelector<HTMLButtonElement>('.arkme-entity-item-title')!.click(); await tick() })
  const body = host.querySelector<HTMLDivElement>('.arkme-entity-items')!
  body.scrollTop = 230
  await act(async () => { body.dispatchEvent(new Event('scroll')); await tick() })
  const resize = host.querySelector<HTMLElement>('[role="separator"]')!
  await act(async () => { resize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await tick() })
  const width = host.querySelector<HTMLElement>('[role="dialog"]')!.style.width
  expect(host.querySelector('header button svg')).not.toBeNull()
  for (const close of ['[aria-label="关闭实体列表"]', '.arkme-entity-occurrence', 'outside']) {
    await act(async () => {
      if (close === 'outside') document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      else host.querySelector<HTMLButtonElement>(close)!.click()
      await tick()
    })
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true)
    await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); await tick() })
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(false)
    expect(host.querySelector('.arkme-entity-types [aria-pressed="true"]')?.textContent).toBe('人物')
    expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')?.textContent).toContain('老王')
    expect(host.querySelector('.arkme-entity-items')).toBe(body)
    expect(body.scrollTop).toBe(230)
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.style.width).toBe(width)
    expect(mocks.call).toHaveBeenCalledOnce()
  }
  await act(async () => { root.render(<Retained scope="account2:day2" />); await tick() })
  expect(host.querySelector('.arkme-entity-types [aria-pressed="true"]')?.textContent).toBe('全部')
  expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')).toBeNull()
  expect(host.querySelector<HTMLDivElement>('.arkme-entity-items')?.scrollTop).toBe(0)
})

it('keeps a matching type when an underline explicitly reveals another entity', async () => {
  const data = day({ entities: [{ ...day().entities![0]!, key: 'person', name: '老王', type: 1 }] })
  mocks.call.mockResolvedValue({ version: 'v1', offset: 0, total: 0, hasMore: false, items: [] })
  const render = (reveal?: { key: string; sequence: number }) => root.render(<RecordingEntityPanel data={data} reveal={reveal}
    loading={false} error={false} paused={false} compact={false} onClose={() => {}} onRefresh={() => {}} onLocate={() => true} />)
  await act(async () => { render(); await tick() })
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '人物')!.click(); await tick() })
  await act(async () => { render({ key: 'person', sequence: 1 }); await tick() })
  expect(host.querySelector('.arkme-entity-types [aria-pressed="true"]')?.textContent).toBe('人物')
  expect(host.querySelector('.arkme-entity-item-title[aria-expanded="true"]')?.textContent).toContain('老王')
})

it('appends mentions on scroll once, preserves loaded results on failure and cancels on close', async () => {
  const observers: { callback: IntersectionObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('IntersectionObserver', class {
    entry: typeof observers[number]
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, disconnect: vi.fn() }; observers.push(this.entry) }
    observe(target: Element) { this.entry.target = target }
    disconnect() { this.entry.disconnect() }
  })
  const items = (offset: number) => Array.from({ length: 50 }, (_, i) => ({ key: `o${offset + i}`, startAtMillis: i, text: `提及${offset + i}`, target: {} }))
  let settle!: (value: unknown) => void
  mocks.call.mockResolvedValueOnce({ version: 'v1', offset: 0, total: 150, hasMore: true, items: items(0) })
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
  const render = (open: boolean, version = 'v1') => root.render(<RecordingEntityPanel data={day({ version })} open={open}
    loading={false} error={false} paused={false} compact={false} onClose={() => {}} onRefresh={() => {}} onLocate={() => true} />)
  await act(async () => { render(true); await tick(); })
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-item-title')!.click(); await tick() })
  expect(host.querySelectorAll('.arkme-entity-occurrence')).toHaveLength(20)
  const first = host.querySelector('.arkme-entity-occurrence')
  const observer = observers.find(item => item.target?.className === 'arkme-entity-more')!
  await act(async () => { observer.callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver); await tick() })
  expect(mocks.call).toHaveBeenCalledTimes(2)
  expect(host.querySelector('.arkme-entity-occurrence')).toBe(first)
  expect(host.querySelector('.arkme-entity-occurrences [role="alert"]')).not.toBeNull()
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-more button')!.click(); host.querySelector<HTMLButtonElement>('.arkme-entity-more button')!.click(); await tick() })
  expect(mocks.call).toHaveBeenCalledTimes(3)
  expect(mocks.call.mock.calls[2]![1]).toMatchObject({ offset: 50, limit: 50 })
  const aborted = mocks.call.mock.calls[2]![2] as AbortSignal
  await act(async () => { render(false); await tick() })
  expect(aborted.aborted).toBe(true)
  await act(async () => { observer.callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver); await tick() })
  expect(mocks.call).toHaveBeenCalledTimes(3)
  expect(observers.every(item => item.disconnect.mock.calls.length > 0)).toBe(true)
  await act(async () => { settle({ version: 'v1', offset: 50, total: 150, hasMore: true, items: items(50) }); await tick() })
  expect([...host.querySelectorAll('.arkme-entity-occurrence > span')].map(node => node.textContent)).not.toContain('提及50')
  mocks.call.mockResolvedValueOnce({ version: 'v1', offset: 50, total: 100, hasMore: false, items: items(50) })
  await act(async () => { render(true); await tick() })
  await act(async () => { host.querySelector<HTMLButtonElement>('.arkme-entity-more button')!.click(); await tick() })
  expect(host.querySelectorAll('.arkme-entity-occurrences [data-arkme-directory-chunk]')).toHaveLength(5)
  expect(host.querySelectorAll('.arkme-entity-occurrence')).toHaveLength(20)
  expect(host.querySelector('.arkme-entity-more')).toBeNull()
  mocks.call.mockResolvedValueOnce({ version: 'v2', offset: 0, total: 0, hasMore: false, items: [] })
  await act(async () => { render(true, 'v2'); await tick() })
  expect(mocks.call.mock.calls.at(-1)![1]).toMatchObject({ offset: 0 })
  expect(host.querySelectorAll('.arkme-entity-occurrence')).toHaveLength(0)
})

it.each([{ failedUnits: 1, unavailableUnits: 0 }, { failedUnits: 0, unavailableUnits: 1 }])('keeps entity interactions available with transcript anomaly %j', async anomaly => {
  const health = { pendingUnits: 0, processingUnits: 1, readyUnits: 1, ...anomaly }
  const render = (data: RecordingEntityDay) => root.render(<RecordingEntityPanel data={data} loading={false} error={false} paused={false} compact={false} onClose={() => {}} onRefresh={() => {}} onLocate={() => true} />)
  await act(async () => render(day({ stage: 'waiting_more_transcript', transcriptHealth: health })))
  expect(host.textContent).toContain('部分转写异常，已有实体可查看')
  expect(host.querySelector('.arkme-entity-item-title')?.textContent).toContain('武汉')
  await act(async () => render(day({ stage: 'waiting_more_transcript', transcriptHealth: { ...health, failedUnits: 0, unavailableUnits: 0 } })))
  expect(host.textContent).toContain('等待剩余转写完成')
  expect(host.querySelector('.arkme-entity-item-title')?.textContent).toContain('武汉')
})
it('offers start on old recordings without replacing existing entity data', async () => {
  const start = vi.fn()
  const render = (starting = false, canStart = true) => root.render(<RecordingEntityPanel data={day({ status: 'not_started', canStart })} starting={starting} loading={false} error={false} paused={false} compact={false} onStart={start} onClose={() => {}} onRefresh={() => {}} onLocate={() => true} />)
  await act(async () => render())
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '开始识别')!.click() })
  expect(start).toHaveBeenCalledOnce()
  await act(async () => render(true))
  const submitting = [...host.querySelectorAll('button')].find(b => b.textContent === '正在提交…')!
  expect(submitting.disabled).toBe(true)
  expect(host.textContent).toContain('武汉')
  await act(async () => render(false, false))
  expect(host.textContent).not.toContain('开始识别')
})
it('submits only once, refreshes after unknown outcomes and preserves existing results', async () => {
  let reject!: (error: Error) => void
  mocks.call.mockImplementation((operation: string) => operation.endsWith('.start') ? new Promise((_, fail) => { reject = fail }) : Promise.resolve(day()))
  await act(async () => { root.render(<Harness />); await tick() })
  let command!: Promise<void>
  await act(async () => { command = owner.start(); void owner.start(); await tick() })
  expect(mocks.call.mock.calls.filter(([operation]) => operation.endsWith('.start'))).toHaveLength(1)
  expect(owner.starting).toBe(true)
  expect(host.textContent).toContain('武汉')
  await act(async () => { reject(new Error('connection lost')); await command; await tick() })
  expect(owner.startError).toBe(true)
  expect(owner.starting).toBe(false)
  expect(host.textContent).toContain('武汉')
  expect(mocks.call.mock.calls.filter(([operation]) => operation.endsWith('.start'))).toHaveLength(1)
  expect(mocks.call.mock.calls.filter(([operation]) => operation === 'recordings.entities')).toHaveLength(2)
})
it('cancels manual start on day changes and drops its late completion', async () => {
  let resolve!: (value: unknown) => void
  mocks.call.mockImplementation((operation: string) => operation.endsWith('.start') ? new Promise(done => { resolve = done }) : Promise.resolve(day()))
  await act(async () => { root.render(<Harness />); await tick() })
  let command!: Promise<void>
  await act(async () => { command = owner.start(); await tick() })
  const signal = mocks.call.mock.calls.find(([operation]) => operation.endsWith('.start'))![2] as AbortSignal
  await act(async () => { root.render(<Harness date={456} />); await tick() })
  expect(signal.aborted).toBe(true)
  const count = mocks.call.mock.calls.length
  await act(async () => { resolve({ status: 'accepted' }); await command; await tick() })
  expect(owner.starting).toBe(false)
  expect(mocks.call).toHaveBeenCalledTimes(count)
})

it('waits for paged locate, ignores replaced entity scopes, and permits retry after failure', async () => {
  const onClose = vi.fn(), onRefresh = vi.fn()
  let resolve!: (found: boolean) => void
  const onLocate = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
  const occurrence = { key:'mention', startAtMillis:123, text:'武汉', observedText:'武汉', target:{identityHash:'hash',transcriptVersion:'v',transcriptSource:'system',start:0,length:2} }
  mocks.call.mockResolvedValue({version:'v1',offset:0,total:1,hasMore:false,items:[occurrence]})
  const render = (data = day()) => root.render(<RecordingEntityPanel data={data} loading={false} error={false} paused={false} compact={true} onClose={onClose} onRefresh={onRefresh} onLocate={onLocate} />)
  await act(async () => { render(); await tick() })
  await act(async () => { (host.querySelector('.arkme-entity-item-title') as HTMLButtonElement).click(); await tick() })
  await act(async () => { (host.querySelector('.arkme-entity-occurrence') as HTMLButtonElement).click(); await tick() })
  expect(onClose).not.toHaveBeenCalled()
  expect((host.querySelector('.arkme-entity-occurrence') as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { render(day({version:'v2'})); await tick() })
  await act(async () => { resolve(true); await tick() })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { (host.querySelector('.arkme-entity-occurrence') as HTMLButtonElement).click(); await tick() })
  await act(async () => { resolve(false); await tick() })
  expect(host.textContent).toContain('原文已更新，请刷新录音后重试')
  expect((host.querySelector('.arkme-entity-occurrence') as HTMLButtonElement).disabled).toBe(false)
  await act(async () => { (host.querySelector('.arkme-entity-occurrence') as HTMLButtonElement).click(); await tick() })
  await act(async () => { resolve(true); await tick() })
  expect(onClose).toHaveBeenCalledOnce()
})
