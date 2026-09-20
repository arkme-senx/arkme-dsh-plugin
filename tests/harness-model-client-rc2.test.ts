import { describe, expect, it } from 'vitest'
import { inject } from '../src/client/harness-model-client.js'

describe('Harness rc2 model-seat injection', () => {
  it('declares the remote session service used by the injected model directory', () => {
    expect(inject).toEqual(expect.arrayContaining(['slots', 'sessions', 'remote', 'remote.session']))
  })
})
