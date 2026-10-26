import { TimelineTokenCodec } from './timeline-token.js'
import { ArkmePluginError } from './service.js'

const sources = new Set(['group_metadata', 'member_left', 'ai_polish'])

export function validateSystemTimelineAnchor(source: unknown, id: unknown): { anchor_source: string; anchor_id: string } {
  if (typeof source !== 'string' || !sources.has(source) || typeof id !== 'string' || !id || id.length > 1024)
    throw new ArkmePluginError('chat-system-anchor-invalid', '系统通知定位引用无效', false, 400)
  return { anchor_source: source, anchor_id: id }
}

/** Only the Host sees raw system identities; references bind account, environment and conversation. */
export function systemTimelineAnchorCodec(key: string, environment: string, userId: number, sessionUid: string) {
  const codec = new TimelineTokenCodec(key, JSON.stringify([environment, userId, sessionUid]))
  return {
    seal(source: unknown, id: unknown) {
      const anchor = validateSystemTimelineAnchor(source, id)
      return codec.seal(JSON.stringify([anchor.anchor_source, anchor.anchor_id]), 'system-anchor')
    },
    open(ref: string) {
      const value: unknown = JSON.parse(codec.open(ref, 'system-anchor'))
      if (!Array.isArray(value) || value.length !== 2)
        throw new ArkmePluginError('chat-system-anchor-invalid', '系统通知定位引用无效', false, 400)
      return validateSystemTimelineAnchor(value[0], value[1])
    },
  }
}
