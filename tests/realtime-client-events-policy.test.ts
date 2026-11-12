import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arkmeRealtimeTimelineDeliveryAllowed } from '../src/client/realtime-client-events.js'

const source = readFileSync(new URL('../src/client/realtime-client-events.ts', import.meta.url), 'utf8')

describe('Arkme realtime client event lifetime', () => {
  it('keeps the local event stream connected while hidden so notification fallback is not dropped', () => {
    const connectEvents = source.slice(source.indexOf('const connectEvents'), source.indexOf('const handleVisibilityChange'))
    const visibilityStart = source.indexOf('const handleVisibilityChange')
    const visibility = source.slice(visibilityStart, source.indexOf('browserDocument?.addEventListener', visibilityStart))
    expect(connectEvents).not.toContain("visibilityState === 'hidden'")
    expect(visibility).not.toContain('disconnectEvents()')
    expect(visibility).toContain('connectEvents()')
  })

  it('keeps Bot refresh foreground-only while retaining chat timeline bodies in the background', () => {
    expect(arkmeRealtimeTimelineDeliveryAllowed('hidden', true)).toBe(false)
    expect(arkmeRealtimeTimelineDeliveryAllowed('visible', false)).toBe(false)
    expect(arkmeRealtimeTimelineDeliveryAllowed('visible', true)).toBe(true)
    expect(arkmeRealtimeTimelineDeliveryAllowed(undefined)).toBe(true)
    expect(source).toContain('foreground && arkmeSelectedBotAffectedByChatDelta')
  })

  it('refreshes interaction counters on read acknowledgements and permission changes even when the Host owns directory refresh', () => {
    const readAck = source.slice(source.indexOf("if (update.type === 'read-ack')"), source.indexOf("if (update.type === 'attention-summary')"))
    expect(readAck).toContain("update.sourceKind === 'private_chat' ? [] : undefined")
    expect(readAck).toContain('arkmeChatDirectory.updateReadAck(')
    for (const type of ['chat-policy-invalidated', 'conversation-list-preference-invalidated']) {
      const start = source.indexOf(`if (update.type === '${type}')`)
      const block = source.slice(start, source.indexOf('\n        }', start))
      const revalidate = block.indexOf('arkmeInterwovenInvalidation.invalidate(undefined, undefined, true,')
      expect(revalidate).toBeGreaterThan(0)
      expect(revalidate).toBeLessThan(block.indexOf("update.refresh === 'none'"))
    }
  })
})
