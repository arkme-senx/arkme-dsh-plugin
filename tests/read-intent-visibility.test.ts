import { describe, expect, it } from 'vitest'
import {
  arkmeAwaitVisibleReadIntent,
  arkmeVisibleReadIntentAllowed,
  type ArkmeReadIntentDocument,
} from '../src/client/read-intent-visibility.js'

describe('Arkme visible read intent', () => {
  it('requires both a visible document and focused window', () => {
    expect(arkmeVisibleReadIntentAllowed({ visibilityState: 'hidden', hasFocus: () => true })).toBe(false)
    expect(arkmeVisibleReadIntentAllowed({ visibilityState: 'visible', hasFocus: () => false })).toBe(false)
    expect(arkmeVisibleReadIntentAllowed({ visibilityState: 'visible', hasFocus: () => true })).toBe(true)
  })

  it('rechecks visibility and focus after the animation-frame boundary', async () => {
    const state: { visibilityState: DocumentVisibilityState; focused: boolean } = {
      visibilityState: 'visible', focused: true,
    }
    const documentRef: ArkmeReadIntentDocument = {
      get visibilityState() { return state.visibilityState },
      hasFocus: () => state.focused,
    }
    await expect(arkmeAwaitVisibleReadIntent(documentRef, async () => {
      state.visibilityState = 'hidden'
    })).resolves.toBe(false)
    state.visibilityState = 'visible'
    state.focused = true
    await expect(arkmeAwaitVisibleReadIntent(documentRef, async () => {
      state.focused = false
    })).resolves.toBe(false)
  })
})

it('keeps automatic read paused until the last overlay closes and releases only once', async () => {
  const { suspendArkmeVisibleReadIntent, subscribeArkmeReadIntentAvailability } = await import('../src/client/read-intent-visibility.js')
  const doc = { visibilityState: 'visible' as const, hasFocus: () => true }
  let resumes = 0
  const unsubscribe = subscribeArkmeReadIntentAvailability(() => { resumes += 1 })
  const first = suspendArkmeVisibleReadIntent()
  const second = suspendArkmeVisibleReadIntent()
  try {
    expect(arkmeVisibleReadIntentAllowed(doc)).toBe(false)
    first(); first()
    expect(arkmeVisibleReadIntentAllowed(doc)).toBe(false)
    expect(resumes).toBe(0)
    second()
    expect(arkmeVisibleReadIntentAllowed(doc)).toBe(true)
    expect(resumes).toBe(1)
  } finally { first(); second(); unsubscribe() }
})

it('rejects an acknowledgement already waiting on the next frame when preview opens', async () => {
  const { suspendArkmeVisibleReadIntent } = await import('../src/client/read-intent-visibility.js')
  let release: (() => void) | undefined
  try {
    await expect(arkmeAwaitVisibleReadIntent({ visibilityState: 'visible', hasFocus: () => true }, async () => {
      release = suspendArkmeVisibleReadIntent()
    })).resolves.toBe(false)
  } finally { release?.() }
})
