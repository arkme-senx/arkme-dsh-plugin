// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { ArkmeArrangementItem } from '../src/types.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
vi.mock('../src/client/ArkmeArrangementSources.js', () => ({
  ArkmeArrangementSources: ({ sources }: any) => (
    <div>
      {sources.map((e: any) => (
        <p key={e.id}>{e.text}</p>
      ))}
    </div>
  ),
}))
import { ArkmeArrangementOccurrenceTimeline } from '../src/client/ArkmeArrangementOccurrenceTimeline.js'
import {
  ArkmeArrangementReviewInbox,
  ArkmeArrangementHistoricalMerge,
} from '../src/client/ArkmeArrangementOccurrenceActions.js'
const item: ArkmeArrangementItem = {
  arrangementRef: 'master',
  title: '下午4点半接小安放学',
  description: '学校门口等候',
  status: 'completed',
  reminderEnabled: false,
  reminderState: '',
  createdAtMillis: 100,
  updatedAtMillis: 200,
}
const peer = { ...item, arrangementRef: 'duplicate', title: '去学校接小安', version: 300 }
const review = {
  id: 'review',
  kind: 'automatic',
  state: 'pending',
  created_at: 400,
  recognized_at: 390,
  source: 'audio',
  reason: '可能是同一次接送，需要确认',
  candidate: { title: '下午接小安', description: '在校门等', due_at: 1000 },
  peers: [peer],
  comparisons: [{ arrangementRef: 'duplicate', relation: 'same', reason: '同一时间和人物' }],
}
let host: HTMLDivElement, root: Root
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((e) => e.textContent === label)!
const click = async (label: string) => {
  await act(async () => button(label).click())
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api.mockReset()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it('groups several quotes into one recognition and keeps original time distinct from recognition time', async () => {
  api.mockResolvedValue({
    accountScope: 'test:42',
    state: 'ready',
    events: [
      {
        id: 'run',
        source: 'call',
        recognized_at: 2000000,
        attached_at: 2100000,
        evidence_ids: ['one', 'two'],
        reason: '同一次事项',
        disposition: 'merged',
        trace_id: 'trace',
      },
    ],
  })
  const evidence = [
    {
      id: 'one',
      kind: 'input',
      role: 'initial',
      text: '提出接送',
      createdAtMillis: 1000000,
      canOpen: false,
    },
    {
      id: 'two',
      kind: 'input',
      role: 'supplement',
      text: '确认接送',
      createdAtMillis: 1100000,
      canOpen: false,
    },
  ] as ArkmeArrangementItem['provenance']
  await act(async () =>
    root.render(
      <ArkmeArrangementOccurrenceTimeline
        accountScope="test:42"
        item={{ ...item, provenance: evidence }}
        fallback={<p>旧来源</p>}
      />,
    ),
  )
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.textContent).toContain('识别时间')
  expect(host.textContent).toContain('原文时间')
  expect(host.textContent).toContain(new Date(2000000).toLocaleString())
  expect(host.textContent).toContain(new Date(1000000).toLocaleString())
  expect(host.textContent).toContain('确认接送')
  const inspect = vi.fn()
  window.addEventListener('arkme-arrangement-inspect-trace', inspect)
  await click('查看此次识别过程')
  expect(inspect).toHaveBeenCalledOnce()
  window.removeEventListener('arkme-arrangement-inspect-trace', inspect)
})
it('preserves existing sources when the deployed backend has no new event API', async () => {
  api.mockRejectedValue(new Error('当前后端尚未提供事项归并接口'))
  await act(async () =>
    root.render(
      <ArkmeArrangementOccurrenceTimeline
        accountScope="test:42"
        item={item}
        fallback={<p>原有来源仍可查看</p>}
      />,
    ),
  )
  expect(host.textContent).toContain('原有来源仍可查看')
  expect(host.textContent).toContain('尚未提供')
  expect(host.querySelectorAll('article')).toHaveLength(0)
})
it('does not create or merge an uncertain candidate until the user chooses an existing owner', async () => {
  const applied = vi.fn()
  api.mockImplementation(async (op: string) =>
    op.endsWith('.list')
      ? { accountScope: 'test:42', state: 'ready', items: [review] }
      : { accountScope: 'test:42', state: 'applied', item },
  )
  await act(async () =>
    root.render(
      <ArkmeArrangementReviewInbox accountScope="test:42" onClose={() => {}} onApplied={applied} />,
    ),
  )
  expect(api.mock.calls.filter(([op]) => op.endsWith('.decide'))).toHaveLength(0)
  expect(button('归入所选安排').disabled).toBe(true)
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click())
  await click('归入所选安排')
  expect(api).toHaveBeenLastCalledWith('arrangements.occurrences.reviews.decide', {
    expectedAccountScope: 'test:42',
    reviewId: 'review',
    action: 'merge',
    targetRef: 'duplicate',
    targetVersion: 300,
  })
  expect(applied).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  expect(document.body.textContent).not.toContain('下午接小安')
})
it('previews historical duplicates without writing, then applies only selected owners', async () => {
  const applied = vi.fn()
  api.mockImplementation(async (op: string) =>
    op.endsWith('.preview')
      ? { accountScope: 'test:42', state: 'preview', review: { ...review, kind: 'history' } }
      : { accountScope: 'test:42', state: 'applied', item },
  )
  await act(async () =>
    root.render(
      <ArkmeArrangementHistoricalMerge
        accountScope="test:42"
        item={item}
        model="Qwen Flash"
        routeKey="dashscope/qwen-flash"
        onApplied={applied}
      />,
    ),
  )
  expect(api).not.toHaveBeenCalled()
  await click('查找历史重复并预览')
  expect(applied).not.toHaveBeenCalled()
  expect(api.mock.calls.some(([op]) => op.endsWith('.apply'))).toBe(false)
  await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await click('确认合并到此安排 (1)')
  expect(api).toHaveBeenLastCalledWith('arrangements.occurrences.history.apply', {
    expectedAccountScope: 'test:42',
    arrangementRef: 'master',
    reviewId: 'review',
    selectedRefs: ['duplicate'],
  })
  expect(applied).toHaveBeenCalledWith(item)
})
it('keeps the candidate visible when the server rejects a stale merge', async () => {
  api.mockImplementation(async (op: string) =>
    op.endsWith('.list')
      ? { accountScope: 'test:42', state: 'ready', items: [review] }
      : { accountScope: 'test:42', state: 'conflict', reason: '安排已变化，请刷新' },
  )
  await act(async () =>
    root.render(<ArkmeArrangementReviewInbox accountScope="test:42" onClose={() => {}} />),
  )
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click())
  await click('归入所选安排')
  expect(document.body.textContent).toContain('安排已变化')
  expect(document.body.textContent).toContain('下午接小安')
})

it('keeps a candidate pending when an applied response omits its master', async () => {
  const applied = vi.fn()
  api.mockImplementation(async (op: string) =>
    op.endsWith('.list')
      ? { accountScope: 'test:42', state: 'ready', items: [review] }
      : { accountScope: 'test:42', state: 'applied' },
  )
  await act(async () =>
    root.render(
      <ArkmeArrangementReviewInbox accountScope="test:42" onClose={() => {}} onApplied={applied} />,
    ),
  )
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click())
  await click('归入所选安排')
  expect(applied).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('下午接小安')
  expect(document.body.textContent).toContain('结果尚未确认')
  expect(button('归入所选安排').disabled).toBe(true)
})

it('requires a fresh choice after a conflict and submits the refreshed peer version', async () => {
  let refreshed = false
  api.mockImplementation(async (op: string) =>
    op.endsWith('.list')
      ? {
          accountScope: 'test:42',
          state: 'ready',
          items: [
            {
              ...review,
              peers: [refreshed ? { ...peer, title: '最新接送安排', version: 400 } : peer],
            },
          ],
        }
      : refreshed
        ? { accountScope: 'test:42', state: 'applied', item }
        : { accountScope: 'test:42', state: 'conflict', reason: '安排已变化，请刷新' },
  )
  await act(async () =>
    root.render(<ArkmeArrangementReviewInbox accountScope="test:42" onClose={() => {}} />),
  )
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click())
  await click('归入所选安排')
  expect(button('归入所选安排').disabled).toBe(true)
  refreshed = true
  await click('刷新待确认识别')
  expect(document.body.textContent).toContain('最新接送安排')
  expect(document.querySelector<HTMLInputElement>('input[type=radio]')!.checked).toBe(false)
  expect(button('归入所选安排').disabled).toBe(true)
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click())
  await click('归入所选安排')
  expect(api).toHaveBeenLastCalledWith(
    'arrangements.occurrences.reviews.decide',
    expect.objectContaining({ targetVersion: 400 }),
  )
})

it('prevents two writes from consecutive clicks before rendering the busy state', async () => {
  let finish!: (value: unknown) => void
  api.mockImplementation(async (op: string) =>
    op.endsWith('.list')
      ? { accountScope: 'test:42', state: 'ready', items: [review] }
      : new Promise((resolve) => {
          finish = resolve
        }),
  )
  await act(async () =>
    root.render(<ArkmeArrangementReviewInbox accountScope="test:42" onClose={() => {}} />),
  )
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click())
  await act(async () => {
    button('归入所选安排').click()
    button('归入所选安排').click()
  })
  expect(api.mock.calls.filter(([op]) => op.endsWith('.decide'))).toHaveLength(1)
  await act(async () => finish({ accountScope: 'test:42', state: 'applied', item }))
})

it('discards a completed write from the old account after its inbox unmounts', async () => {
  let finish!: (value: unknown) => void
  const applied = vi.fn()
  api.mockImplementation(async (op: string, params: any) =>
    op.endsWith('.list')
      ? {
          accountScope: params.expectedAccountScope,
          state: 'ready',
          items: params.expectedAccountScope === 'test:42' ? [review] : [],
        }
      : new Promise((resolve) => {
          finish = resolve
        }),
  )
  await act(async () =>
    root.render(
      <ArkmeArrangementReviewInbox
        key="test:42"
        accountScope="test:42"
        onClose={() => {}}
        onApplied={applied}
      />,
    ),
  )
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click())
  await click('归入所选安排')
  await act(async () =>
    root.render(
      <ArkmeArrangementReviewInbox
        key="test:99"
        accountScope="test:99"
        onClose={() => {}}
        onApplied={applied}
      />,
    ),
  )
  await act(async () => finish({ accountScope: 'test:42', state: 'applied', item }))
  expect(applied).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('暂无待确认识别')
})
