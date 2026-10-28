import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const speakerPresenceToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.speaker-presence.v1', toolName: 'arkme_speaker_presence', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_speaker_presence',
    description: 'Read the current account’s all-history confirmed speaker appearance statistics or original voice associations. Counts use transcribed system speech in visible recordings, not voiceprint usage or other people’s recordings. List returns opaque speakerRef values; pass one unchanged to detail. A non-fresh state is incomplete and must never be reported as zero appearances. Do not poll continuously; report that processing is in progress.',
    parameters: {
      action: { type: 'string', enum: ['list', 'detail'], required: true },
      speaker_ref: { type: 'string', description: 'Detail only: unchanged speakerRef returned by list.' },
      expected_version: { type: 'string', description: 'Optional version from list, to avoid mixing snapshots.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      if (args.action === 'list') {
        if (args.speaker_ref !== undefined || args.expected_version !== undefined) throw new TypeError('列表不接受详情参数')
        const [candidates, presence] = await Promise.all([ports.recordingSpeakerOptions(exec.signal), ports.recordingSpeakerPresence(exec.signal)])
        return taggedJSON('已识别说话人出现统计', { candidates: candidates.filter(item => item.kind === 'speaker').map(({ speakerRef, optionKey, personKey, label }) => ({ speakerRef, optionKey, personKey, label })), state: presence.state, version: presence.version, retryAfterMs: presence.retryAfterMs, items: presence.state === 'fresh' ? presence.items.map(({optionKey, dayCount, lastSeenAt}) => ({optionKey, dayCount, lastSeenAt})) : [] })
      }
      if (args.action !== 'detail' || typeof args.speaker_ref !== 'string' || args.speaker_ref.trim() === '' || args.speaker_ref.length > 4096) throw new TypeError('详情需要列表返回的 speaker_ref')
      const result = await ports.recordingSpeakerMembers(args.speaker_ref, exec.signal, args.expected_version)
      return taggedJSON('说话人原始声音关联', { state: result.state, version: result.version, retryAfterMs: result.retryAfterMs, ...(result.state === 'fresh' ? { dayCount: result.dayCount, lastSeenAt: result.lastSeenAt } : {}), items: result.state === 'fresh' ? result.items.map(({ identityKey, token, dayCount, lastSeenAt }) => ({ identityKey, token, dayCount, lastSeenAt })) : [] })
    },
  }),
})
