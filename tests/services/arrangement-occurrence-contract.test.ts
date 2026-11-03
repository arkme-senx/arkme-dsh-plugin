import { expect, it, vi } from 'vitest'
import { projectOccurrenceResponse } from '../../src/services/arrangement-occurrence-contract.js'
import type {
  ArrangementOccurrenceAction,
  ArrangementOccurrenceInput,
} from '../../src/arrangement-occurrence.js'
import type { ArkmeArrangementItem } from '../../src/types.js'

const item: ArkmeArrangementItem = {
  arrangementRef: 'opaque-master',
  title: '接小安',
  description: '',
  status: 'completed',
  reminderEnabled: false,
  reminderState: '',
  createdAtMillis: 1,
  updatedAtMillis: 2,
}
const project = vi.fn(async () => item)

it.each<[ArrangementOccurrenceAction, ArrangementOccurrenceInput, unknown]>([
  ['events', {}, { state: 'ready' }],
  ['events', {}, { state: 'ready', events: [{ id: 'run' }] }],
  ['reviews/summary', {}, { state: 'ready', count: -1 }],
  ['reviews/summary', {}, { state: 'ready', count: 1.5 }],
  ['reviews/list', {}, { state: 'ready' }],
  ['history/preview', {}, { state: 'preview' }],
  ['reviews/decide', { action: 'merge' }, { state: 'applied' }],
  ['reviews/decide', { action: 'create' }, { state: 'applied' }],
  ['history/apply', {}, { state: 'applied' }],
  ['history/apply', {}, { state: 'applied', item: { uid: 'wrong', title: '其他安排', status: 3 } }],
  ['events', {}, { state: 'applied', events: [] }],
])('rejects an incomplete or mismatched %s response', async (action, input, payload) => {
  await expect(
    projectOccurrenceResponse(action, input, payload, 'test:42', project, 'master'),
  ).rejects.toMatchObject({ code: 'arrangement-occurrence-contract' })
})

it('accepts an explicit ignore without requiring an arrangement payload', async () => {
  await expect(
    projectOccurrenceResponse(
      'reviews/decide',
      { action: 'ignore' },
      { state: 'applied' },
      'test:42',
      project,
    ),
  ).resolves.toEqual({ accountScope: 'test:42', state: 'applied' })
})

it('accepts actual empty results instead of treating missing arrays as empty', async () => {
  await expect(
    projectOccurrenceResponse('events', {}, { state: 'ready', events: [] }, 'test:42', project),
  ).resolves.toMatchObject({ events: [] })
  await expect(
    projectOccurrenceResponse(
      'reviews/list',
      {},
      { state: 'ready', items: [] },
      'test:42',
      project,
    ),
  ).resolves.toMatchObject({ items: [] })
})

it('keeps invalid model comparisons reviewable without exposing a foreign owner identity', async () => {
  const result = await projectOccurrenceResponse(
    'reviews/list',
    {},
    {
      state: 'ready',
      items: [
        {
          id: 'review',
          kind: 'automatic',
          state: 'pending',
          created_at: 100,
          source: 'call',
          reason: '模型返回无效候选，需确认',
          candidate: { title: '接小安', description: '', due_at: 0 },
          peers: [{ uid: 'master', title: '接小安', status: 3, version: 200 }],
          comparisons: [
            {
              uid: 'foreign-secret',
              relation: 'invalid-model-output',
              confidence: -1,
              same_event: false,
              same_people: false,
              same_occurrence: false,
              time_conflict: false,
              place_conflict: false,
              reason: '原模型输出需核对',
            },
          ],
        },
      ],
    },
    'test:42',
    project,
  )
  expect(result.items).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('foreign-secret')
  expect(result.items![0]!.comparisons[0]!.arrangementRef).toBeUndefined()
})

it('requires a complete inspectable trace when a historical preview includes one', async () => {
  await expect(
    projectOccurrenceResponse(
      'history/preview',
      {},
      {
        state: 'preview',
        review: {
          id: 'r',
          kind: 'history',
          state: 'pending',
          created_at: 1,
          source: 'manual',
          reason: '',
          candidate: { title: '接小安', description: '', due_at: 0 },
          peers: [],
          comparisons: null,
        },
        trace: { id: 'incomplete' },
      },
      'test:42',
      project,
    ),
  ).rejects.toMatchObject({ code: 'arrangement-occurrence-contract' })
})
