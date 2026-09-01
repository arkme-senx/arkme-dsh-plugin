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
