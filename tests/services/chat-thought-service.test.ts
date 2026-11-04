import { expect, it, vi } from 'vitest'
import { readChatThoughts } from '../../src/services/chat-thought-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
const scope = 'production:42'
function fixture() {
  const requireSession = vi.fn(async () => ({ userId: 42 }))
  const rows: unknown[] = [
    {source_version:1,chat_session_uid: 'chat', rel_uid: 'rel', scene: 2, visibility: 2, status: 2, generation: 1, content: '公开回应' },
    {source_version:1,chat_session_uid: 'chat', rel_uid: 'rel', scene: 3, visibility: 1, status: 2, generation: 2, content: '本人私密分析' },
    {source_version:1,chat_session_uid: 'other', rel_uid: 'rel', scene: 3, visibility: 1, status: 2, generation: 1, content: '越界结果' },
    {source_version:1,chat_session_uid: 'chat', rel_uid: 'foreign', scene: 3, visibility: 1, status: 2, generation: 1, content: '越界消息' },
    {source_version:1,chat_session_uid: 'chat', rel_uid: 'rel', scene: 3, visibility: 2, status: 2, generation: 9, content: '错误可见域' },
  ]
  const post = vi.fn(async () => ({ items: rows }))
  const resolve = vi.fn(async () => ({ kind: 'chat' as const, viewerUserId: 42, recordUid: 'record', chatSessionUid: 'chat', relationUid: 'rel' }))
  const runtime = { config: { environment: 'production' }, requireSession, authenticatedIntelligentPost: post } as unknown as ServiceRuntime
  return { runtime, requireSession, rows, post, resolve }
}
it('resolves signed references and returns separate public and user-only documents, never other scopes', async () => {
  const f = fixture(), signal = new AbortController().signal
  const result = await readChatThoughts(f.runtime, scope, 'source', ['signed', 'signed'], f.resolve, signal)
  expect(f.resolve).toHaveBeenCalledExactlyOnceWith('source', 'signed')
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/v1/chat-thought/list', { chat_session_uid: 'chat', rel_uids: ['rel'] }, { userId: 42 }, signal, { lane: 'background-read', publishServiceCooldown: false })
  expect(result.items.map(item => [item.content, item.visibility, item.scene])).toEqual([['公开回应', 'members', 2], ['本人私密分析', 'user', 3]])
  expect(JSON.stringify(result)).not.toMatch(/chat_session_uid|rel_uid|越界|错误可见域/)
})
it('retains current lifecycle status and only the newest generation for each scene', async () => {
  const f = fixture(); f.rows.splice(0, f.rows.length,
    ...[2, 1].map(generation => ({source_version:1,chat_session_uid: 'chat', rel_uid: 'rel', scene: 5, visibility: 1, status: generation === 2 ? 4 : 2, generation, content: '旧建议' })))
  expect((await readChatThoughts(f.runtime, scope, 'source', ['signed'], f.resolve)).items).toMatchObject([{ status: 'invalidated', generation: 2 }])
})
it('projects the full structured analysis and bounded suggestion groups without private owner fields', async () => {
  const f = fixture(); f.rows.splice(0, f.rows.length, {source_version:1,chat_session_uid: 'chat', rel_uid: 'rel', scene: 5, visibility: 1, status: 2, generation: 1,
    display: { headline: '等待确认', internal_secret: 'secret', unified_meaning: { context_understanding: { summary: '讨论计划' }, their_intent: { underlying: '可能希望得到确认', emotion: { primary: '期待' } }, risk_factors: { warnings: ['先核实时间'] } }, suggestions: [{ style_title: '自然', items: ['收到，我确认一下。', '好的，稍后回复你。'] }] } })
  const result = await readChatThoughts(f.runtime, scope, 'source', ['signed'], f.resolve)
  expect(result.items[0]?.display).toMatchObject({ context: '讨论计划', underlying: '可能希望得到确认', emotion: '期待', warnings: ['先核实时间'], suggestions: [{ style: '自然', items: ['收到，我确认一下。', '好的，稍后回复你。'] }] })
  expect(JSON.stringify(result)).not.toContain('secret')
})
it('rejects account switches, invalid input and references from another viewer before reading', async () => {
  const f = fixture()
  await expect(readChatThoughts(f.runtime, 'production:7', 'source', ['signed'], f.resolve)).rejects.toThrow('账号已切换')
  await expect(readChatThoughts(f.runtime, scope, 'source', Array(51).fill('signed'), f.resolve)).rejects.toThrow('范围无效')
  f.resolve.mockResolvedValueOnce({ kind: 'chat', viewerUserId: 7, recordUid: 'record', chatSessionUid: 'chat', relationUid: 'rel' })
  await expect(readChatThoughts(f.runtime, scope, 'source', ['signed'], f.resolve)).rejects.toThrow('范围无效')
  expect(f.post).not.toHaveBeenCalled()
  f.requireSession.mockResolvedValueOnce({ userId: 42 }).mockResolvedValue({ userId: 7 })
  await expect(readChatThoughts(f.runtime, scope, 'source', ['signed'], f.resolve)).rejects.toThrow('账号已切换')
})
