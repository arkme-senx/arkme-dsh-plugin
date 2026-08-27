import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

function fakeService() {
  return {
    unmarkedSpeakerOptions: vi.fn(async (candidateRef: string) => ({ candidateRef })),
    retryUnmarkedSpeakerInference: vi.fn(async (candidateRef: string) => ({ candidateRef })),
    unmarkedSpeakerSegments: vi.fn(async (candidateRef: string, options: unknown) => ({ candidateRef, options })),
    markUnmarkedSpeaker: vi.fn(async (input: unknown) => input),
  }
}

describe('unmarked-speaker UI-only Host operations', () => {
  it('dispatches reads with trimmed opaque refs/cursors and bounded limits', async () => {
    const service = fakeService()
    const injected = {
      userId: 91, candidateId: 'candidate-private', speakerId: 'speaker-private',
      audioFileName: 'private.wav',
    }

    await dispatchArkmeHostOperation(service as never, 'unmarked-speakers.options', {
      candidateRef: ' candidate-ref ', ...injected,
    })
    await dispatchArkmeHostOperation(service as never, 'unmarked-speakers.retry-inference', {
      candidateRef: ' candidate-ref ', ...injected,
    })
    await expect(dispatchArkmeHostOperation(service as never, 'unmarked-speakers.segments', {
      candidateRef: ' candidate-ref ', cursor: ' segment-cursor ', limit: 999, ...injected,
    })).resolves.toEqual({
      candidateRef: 'candidate-ref', options: { cursor: 'segment-cursor', limit: 50 },
    })

    expect(service.unmarkedSpeakerOptions).toHaveBeenCalledWith('candidate-ref')
    expect(service.retryUnmarkedSpeakerInference).toHaveBeenCalledWith('candidate-ref')
    expect(service.unmarkedSpeakerSegments).toHaveBeenCalledWith(
      'candidate-ref', { cursor: 'segment-cursor', limit: 50 },
    )
  })

  it('dispatches marks with exactly one normalized selection mode and no raw identifiers', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'unmarked-speakers.mark', {
      candidateRef: ' candidate-ref ', candidateVersion: ' version-1 ', speakerRef: ' speaker-ref ',
      userId: 91, candidateId: 'candidate-private', speakerId: 'speaker-private', audioFileName: 'private.wav',
    })).resolves.toEqual({
      candidateRef: 'candidate-ref', candidateVersion: 'version-1', speakerRef: 'speaker-ref',
    })
    await expect(dispatchArkmeHostOperation(service as never, 'unmarked-speakers.mark', {
      candidateRef: ' candidate-ref ', candidateVersion: ' version-1 ', newSpeakerName: ' 新同事 ',
      speakerId: 'must-not-cross-host',
    })).resolves.toEqual({
      candidateRef: 'candidate-ref', candidateVersion: 'version-1', newSpeakerName: '新同事',
    })
  })

  it.each([
    [{ candidateRef: 'candidate-ref', candidateVersion: 'version-1' }, 'missing selection'],
    [{ candidateRef: 'candidate-ref', candidateVersion: 'version-1', speakerRef: '   ' }, 'blank speaker ref'],
    [{ candidateRef: 'candidate-ref', candidateVersion: 'version-1', newSpeakerName: '   ' }, 'blank name'],
    [{ candidateRef: 'candidate-ref', candidateVersion: 'version-1', speakerRef: 'speaker-ref', newSpeakerName: 'new' }, 'two modes'],
    [{ candidateRef: 'candidate-ref', candidateVersion: 'version-1', newSpeakerName: 'a'.repeat(101) }, 'overlong name'],
  ])('rejects %s (%s) before reaching the mark service', async (params) => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(
      service as unknown as ArkmeService, 'unmarked-speakers.mark', params,
    )).rejects.toMatchObject({ code: 'unmarked-mark-target-invalid', httpStatus: 400 })
    expect(service.markUnmarkedSpeaker).not.toHaveBeenCalled()
  })
})
