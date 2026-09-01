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

  it('does not publish timeline deltas that could mark the selected chat read while hidden', () => {
    expect(arkmeRealtimeTimelineDeliveryAllowed('hidden', true)).toBe(false)
    expect(arkmeRealtimeTimelineDeliveryAllowed('visible', false)).toBe(false)
    expect(arkmeRealtimeTimelineDeliveryAllowed('visible', true)).toBe(true)
    expect(arkmeRealtimeTimelineDeliveryAllowed(undefined)).toBe(true)
    expect(source).toContain('foreground && timelineUpdates.length > 0')
  })
})
