import { describe, expect, it } from 'vitest'
import type { DshRemoteHistoryEntry } from '../src/dsh-remote/dsh-event-contract.js'
import { extractCompletedTurnWindows, projectCompletedTurns } from '../src/dsh-remote/turn-projector.js'

function entry(
  type: string,
  seq: number,
  data: Record<string, unknown>,
  surfaceOp?: DshRemoteHistoryEntry['event']['surfaceOp'],
): DshRemoteHistoryEntry {
  return { event: { type, seq, time: seq * 10, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } }
}

describe('DSH completed Turn projector', () => {
  it('folds one complete Turn into stable presentation nodes and excludes the active tail', () => {
    const result = projectCompletedTurns([
      entry('turn/start', 0, { turn: 1 }),
      entry('user/message', 1, {
        id: 'human-1', source: { kind: 'user', rpcId: 'rpc-1' },
        content: [{ type: 'text', text: '检查状态' }],
      }, 'append'),
      entry('assistant/chunk', 2, {
        turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '正在' },
      }),
      entry('tool/call', 3, { turn: 1, step: 1, callId: 'call-1', name: 'Bash', arguments: '{}' }),
      {
        ...entry('tool/result', 4, {
          message: { source: { callId: 'call-1' } }, output: 'ok', error: null,
        }, 'append'),
        view: { for: 'result', view: { summary: '完成命令' } },
      },
      entry('assistant/message', 5, {
        turn: 1, step: 1,
        message: { content: [{ type: 'text', text: '状态正常' }] },
      }, 'append'),
      entry('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
      entry('turn/start', 7, { turn: 2 }),
      entry('user/message', 8, {
        id: 'human-2', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }],
      }, 'append'),
    ])

    expect(result.oversizedTurnRefs).toEqual([])
    expect(result.unmatchedTurnEndSeqs).toEqual([])
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]).toMatchObject({
      turn_ref: 'turn:0:6', start_seq: 0, end_seq: 6, status: 'completed',
      presentation_version: 1,
    })
    expect(result.turns[0]!.nodes.map(node => [node.node_ref, node.kind, node.ordinal]))
      .toEqual([
        ['message:human-1', 'user', 0],
        ['tool:call-1', 'tool', 1],
        ['assistant:1:1', 'assistant', 2],
      ])
    expect(result.turns[0]!.nodes[1]).toMatchObject({
      source_seq_start: 3, source_seq_end: 4,
      data: { status: 'completed', resultView: { summary: '完成命令' } },
      presentation: {
        version: 1, format: 'summary', title: 'Bash',
        summary: '完成命令', tone: 'neutral',
      },
    })
    expect(result.turns[0]!.nodes[2]).toMatchObject({
      anchor_seq: 5, source_seq_start: 2, source_seq_end: 5,
      data: { status: 'settled', blocks: [{ type: 'text', text: '状态正常' }] },
    })
    expect(JSON.stringify(result)).not.toContain('human-2')
  })

  it('owns failed tool and injected context presentation semantics', () => {
    const result = projectCompletedTurns([
      entry('turn/start', 20, { turn: 4 }),
      entry('user/message', 21, {
        id: 'goal-round', source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 2 },
        content: [{ type: 'text', text: '<goal_round>hidden model context</goal_round>' }],
      }, 'append'),
      entry('tool/call', 22, {
        turn: 4, step: 1, callId: 'call-send', name: 'arkme_text_send',
        arguments: JSON.stringify({ source_ref: 'opaque-ref', text: 'hello' }),
      }),
      entry('tool/result', 23, {
        error: { code: 'invalid-argument', message: '参数错误' },
        message: { source: { callId: 'call-send' }, content: [{ type: 'text', text: 'Error: 参数错误' }] },
      }, 'append'),
      entry('turn/end', 24, { turn: 4, reason: { kind: 'completed' } }),
    ])

    expect(result.turns[0]!.nodes[0]!.presentation).toEqual({
      version: 1, format: 'summary', icon: 'context',
      title: '上下文注入', summary: 'goal', tone: 'muted',
    })
    expect(result.turns[0]!.nodes[1]!.presentation).toMatchObject({
      version: 1, format: 'summary', icon: 'tool', title: 'Tool call',
      summary: 'Error: 参数错误', tone: 'error',
    })
    expect(JSON.stringify(result.turns[0]!.nodes[1]!.presentation)).not.toContain('opaque-ref')
  })

  it('projects the DSH question tool as one answered question row', () => {
    const result = projectCompletedTurns([
      entry('turn/start', 30, { turn: 5 }),
      entry('tool/call', 31, {
        turn: 5, step: 1, callId: 'call-question', name: 'ask_user_question',
        arguments: JSON.stringify({ questions: [{ id: 'recipient', question: '发给谁？' }] }),
      }),
      entry('tool/result', 32, {
        error: null,
        message: { source: { callId: 'call-question' }, content: [] },
      }, 'append'),
      entry('turn/end', 33, { turn: 5, reason: { kind: 'completed' } }),
    ])

    expect(result.turns[0]!.nodes[0]!.presentation).toMatchObject({
      title: '提问', summary: '1/1 已回答', tone: 'neutral',
    })
  })

  it('keeps replacement compaction and terminal error semantics without duplicating replacement messages', () => {
    const result = projectCompletedTurns([
      entry('turn/start', 10, { turn: 2 }),
      entry('user/message', 11, {
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'compact-1' },
        content: [{ type: 'text', text: 'summary' }],
      }, { op: 'replace', start: 1, end: 9 }),
      entry('turn/end', 12, { turn: 2, reason: { kind: 'error', message: 'failed' } }),
    ])

    expect(result.turns[0]).toMatchObject({ status: 'error' })
    expect(result.turns[0]!.nodes.map(node => [node.node_ref, node.kind])).toEqual([
      ['compaction:compact-1', 'compaction'],
      ['turn-error:2', 'turn_error'],
    ])
  })

  it('never truncates an oversized completed Turn and leaves it on the raw-event fallback', () => {
    const result = projectCompletedTurns([
      entry('turn/start', 0, { turn: 1 }),
      entry('user/message', 1, {
        id: 'large', source: { kind: 'user' },
        content: [{ type: 'text', text: 'x'.repeat(4 * 1024 * 1024) }],
      }, 'append'),
      entry('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
    ])

    expect(result.turns).toEqual([])
    expect(result.oversizedTurnRefs).toEqual(['turn:0:2'])
  })

  it('does not claim a retained orphan turn/end as a completed projection', () => {
    const result = projectCompletedTurns([
      entry('assistant/message', 8, { turn: 3, step: 1, content: [] }, 'append'),
      entry('turn/end', 9, { turn: 3, reason: { kind: 'completed' } }),
    ])

    expect(result.turns).toEqual([])
    expect(result.unmatchedTurnEndSeqs).toEqual([9])
  })

  it('extracts complete Turns across newest-first raw pages without retaining prior complete windows', () => {
    const newer = [
      entry('assistant/message', 4, { turn: 1, step: 1, content: [] }, 'append'),
      entry('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }),
      entry('turn/start', 6, { turn: 2 }),
      entry('assistant/chunk', 7, { turn: 2, step: 1, chunk: {} }),
    ]
    const first = extractCompletedTurnWindows(newer)
    expect(first.completed).toEqual([])
    expect(first.pending.map(value => value.event.seq)).toEqual([4, 5])

    const older = [
      entry('turn/start', 0, { turn: 1 }),
      entry('user/message', 1, { source: { kind: 'user' }, content: [] }, 'append'),
      entry('assistant/chunk', 2, { turn: 1, step: 1, chunk: {} }),
      entry('tool/call', 3, { turn: 1, callId: 'call-1' }),
    ]
    const second = extractCompletedTurnWindows([...older, ...first.pending])
    expect(second.completed).toHaveLength(1)
    expect(second.completed[0]!.map(value => value.event.seq)).toEqual([0, 1, 2, 3, 4, 5])
    expect(second.pending).toEqual([])
  })
})
