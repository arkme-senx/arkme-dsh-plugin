// Test-only deterministic LLM adapter for an actual official DSH browser turn.
// This never executes tools itself: the Agent loop, grants and MCP bridge do.
// No model-quality claim: only the provider response is deterministic.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export const name = 'recording-ui-acceptance'
export const inject = ['llm']
const prefix = 'mcp__arkme__'

function payload(block) {
  assert(!block.isError, 'a real tool call failed')
  const texts = block.content.filter(item => item.type === 'text')
  for (const item of texts) {
    try {
      const value = JSON.parse(item.text)
      const result = value.structuredContent ?? value
      if (result.items || result.utterances || result.content_state) return result
    } catch { /* Non-JSON presentation is not the domain payload. */ }
  }
  assert.fail('the model did not receive the complete structured domain result')
}

export function apply(ctx) {
  const handoff = new URL(process.env.RECORDING_DSH_HANDOFF)
  assert(handoff.protocol === 'http:' && handoff.hostname === '127.0.0.1')
  const fixture = fetch(new URL('/fixture', handoff)).then(res => res.json())
  const adapter = {
    providerInfo: id => ({ id, name: '录音链路验收（确定性测试模型）' }),
    providerRetryPolicy: () => undefined,
    listModels: async () => [{ id: 'recording-ui', name: '录音链路验收' }],
    resolveModel: async (provider, id) => ({ provider, id, name: id }),
    async prepareCall(provider, model) {
      return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) }
    },
    async *stream(options) {
      options.signal?.throwIfAborted()
      const data = await fixture
      const blocks = options.messages.flatMap(message => message.content)
      assert(blocks.some(block => block.type === 'text' && block.text.includes('录音链路验收')), 'start this test from the browser composer')
      const promptText = options.system ?? ''
      assert(promptText.includes('recording_uid and exact complete utterances'), 'installed shared prompt must match the public tool inputs')
      assert(!promptText.includes('Pass exact session_id and segment selectors'), 'retired selector guidance reached the Agent')
      assert(!/Recording capability discovery|text_mode=full|\b(query_recordings|query_recording_transcript|query_recording_summaries|read_recording_summary)\b/.test(promptText), 'plugin must not duplicate platform recording guidance')
      const transcriptSchema = options.tools.find(tool => tool.name === prefix + 'query_recording_transcript')
      assert(transcriptSchema, 'platform transcript schema must reach the Agent through generic discovery')
      assert(transcriptSchema.parameters.properties.text_mode.enum.includes('full'))
      assert(transcriptSchema.parameters.properties.start_at && transcriptSchema.parameters.properties.end_at)
      assert(transcriptSchema.description.length > 0, 'platform tool description must reach the Agent')
      const names = new Set(options.tools.map(tool => tool.name))
      for (const retired of ['arkme_recording_days_list', 'arkme_recording_read']) assert(!names.has(retired))
      for (const retained of ['arkme_recording_import', 'arkme_recording_import_folder']) assert(names.has(retained), `lost independent import tool: ${retained}`)
      const calls = new Map(blocks.filter(block => block.type === 'tool-call').map(block => [block.id, block]))
      const results = blocks.filter(block => block.type === 'tool-result').map(block => ({ call: calls.get(block.toolCallId), data: payload(block) }))
      const pages = name => results.filter(result => result.call?.name === prefix + name).map(result => result.data)
      let tool, args
      if (!pages('query_recordings').length) {
        tool = 'query_recordings'; args = { start_at: 1000, end_at: 2000 }
      } else {
        assert(pages('query_recordings')[0].items.some(item => item.recording_uid === data.recording_uid))
        const transcript = pages('query_recording_transcript')
        if (!transcript.length || transcript.at(-1).has_more) {
          tool = 'query_recording_transcript'
          args = { recording_uid: data.recording_uid, text_mode: 'full', start_at: 1000, end_at: 2000, limit: 1, ...(transcript.length ? { page_cursor: transcript.at(-1).next_page_cursor } : {}) }
        } else if (!pages('query_recording_summaries').length) {
          tool = 'query_recording_summaries'; args = { start_at: 1000, end_at: 2000 }
        } else {
          assert(pages('query_recording_summaries')[0].items.some(item => item.summary_uid === data.summary_uid))
          const summaries = pages('read_recording_summary')
          if (!summaries.length || summaries.at(-1).has_more) {
            tool = 'read_recording_summary'
            args = { summary_uid: data.summary_uid, limit: 10000, ...(summaries.length ? { page_cursor: summaries.at(-1).next_page_cursor } : {}) }
          }
        }
      }
      if (tool) {
        const name = prefix + tool, id = randomUUID(), argumentsJSON = JSON.stringify(args)
        assert(names.has(name), `missing discovered tool: ${name}`)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJSON }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJSON } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const transcriptPages = pages('query_recording_transcript')
      const offsets = new Map()
      for (const [index, page] of transcriptPages.entries()) {
        assert.equal(page.found, true)
        assert.equal(page.has_more, index < transcriptPages.length - 1)
        assert.equal(Boolean(page.next_page_cursor), page.has_more)
        for (const item of page.utterances) {
          assert.equal(item.text_start_offset, offsets.get(item.utterance_index) ?? 0)
          assert.equal(item.text_end_offset - item.text_start_offset, [...item.text].length)
          assert(item.text_end_offset <= item.text_total_length)
          assert(page.speakers[item.speaker_index], 'speaker indices are page-local')
          offsets.set(item.utterance_index, item.text_end_offset)
        }
      }
      const transcript = transcriptPages.flatMap(page => page.utterances).filter(item => item.utterance_index === 0).map(item => item.text).join('')
      const summaries = pages('read_recording_summary')
      assert(summaries.every(page => page.summary.content_origin === 'business_recording_summary'))
      let summaryOffset = 0
      for (const [index, page] of summaries.entries()) {
        assert.equal(page.content_state, 'ready')
        assert.equal(page.text_start_offset, summaryOffset)
        summaryOffset += [...page.text].length
        assert.equal(page.text_end_offset, summaryOffset)
        assert.equal(page.text_total_length, 27000)
        assert.equal(page.has_more, index < summaries.length - 1)
        assert.equal(Boolean(page.next_page_cursor), page.has_more)
      }
      const reference = summaries.map(page => page.text).join('')
      assert.equal(transcript, '原句🙂'.repeat(2000) + '尾句')
      assert.equal(reference, '参考🙂'.repeat(9000))
      const text = '录音链路验收通过：从聊天页面发起，经真实 Agent、MCP、开放平台与 Audio，完整读取原句 6002 字符、业务参考材料 27000 字符。业务总结仅为参考，不是本次分析结论。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      console.log(JSON.stringify({ acceptance: 'browser-agent-real-owner', toolCalls: results.length, transcriptRunes: [...transcript].length, summaryRunes: [...reference].length }))
      // Browser verification sends /finish after seeing the rendered final turn.
    },
  }
  ctx.llm.registerAdapter(['recording-ui'], adapter)
}
