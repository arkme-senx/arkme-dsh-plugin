import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'

describe('recording UI-only host operations', () => {
  it('does not silently drop malformed selectors from a recording forward command', async () => {
    const forwardRecording = vi.fn()
    await expect(dispatchArkmeHostOperation({ forwardRecording } as unknown as ArkmeService, 'recordings.forward', {
      itemRefs: ['valid-ref', 42], targetSourceRef: 'target', requestId: 'request', recordUid: 'record', sendAtMillis: 10,
    })).rejects.toMatchObject({ code: 'recording-forward-selection-invalid' })
    expect(forwardRecording).not.toHaveBeenCalled()
  })

  it('dispatches calendar, day, and owner-backed generation operations without adding public SDK methods', async () => {
    const recordingCalendar = vi.fn(async () => ({ fromStamp: 10, toStamp: 20, days: [] }))
    const recordingDay = vi.fn(async () => ({ dateStamp: 10, totalDurationMillis: 0 }))
    const recordingSummaryModelConfig = vi.fn(async () => ({ options: [] }))
    const setRecordingSummaryModelRoute = vi.fn(async () => ({ effectiveRouteKey: 'dashscope/glm-5' }))
    const generateRecordingProjection = vi.fn(async () => ({ state: 'processing', items: [], message: '内容仍在生成' }))
    const service = {
      recordingCalendar, recordingDay, recordingSummaryModelConfig,
      setRecordingSummaryModelRoute, generateRecordingProjection,
    } as unknown as ArkmeService

    const controller = new AbortController()
    await expect(dispatchArkmeHostOperation(service, 'recordings.calendar', {
      fromStamp: 10,
      toStamp: 20,
    }, undefined, undefined, undefined, undefined, controller.signal)).resolves.toMatchObject({ fromStamp: 10, toStamp: 20 })
    await expect(dispatchArkmeHostOperation(
      service, 'recordings.day', { dateStamp: 10 }, undefined, undefined, undefined, undefined, controller.signal,
    ))
      .resolves.toMatchObject({ dateStamp: 10 })
    await expect(dispatchArkmeHostOperation(
      service, 'recordings.summary-model-config', {},
      undefined, undefined, undefined, undefined, controller.signal,
    )).resolves.toMatchObject({ options: [] })
    await expect(dispatchArkmeHostOperation(
      service, 'recordings.summary-model-config.set', { routeKey: 'dashscope/glm-5' },
      undefined, undefined, undefined, undefined, controller.signal,
    )).resolves.toMatchObject({ effectiveRouteKey: 'dashscope/glm-5' })
    await expect(dispatchArkmeHostOperation(
      service, 'recordings.generate', { dateStamp: 10, kind: 'summary', routeKey: 'dashscope/glm-5' },
      undefined, undefined, undefined, undefined, controller.signal,
    )).resolves.toMatchObject({ state: 'processing' })

    expect(recordingCalendar).toHaveBeenCalledWith(10, 20, controller.signal)
    expect(recordingDay).toHaveBeenCalledWith(10, controller.signal)
    expect(recordingSummaryModelConfig).toHaveBeenCalledWith(controller.signal)
    expect(setRecordingSummaryModelRoute).toHaveBeenCalledWith('dashscope/glm-5', controller.signal)
    expect(generateRecordingProjection).toHaveBeenCalledWith(10, 'summary', 'dashscope/glm-5', controller.signal)
  })

  it('does not collapse a missing recording date into the valid Unix epoch', async () => {
    const recordingCalendar = vi.fn(async () => ({ days: [] }))
    const recordingDay = vi.fn(async () => ({ totalDurationMillis: 0 }))
    const service = { recordingCalendar, recordingDay } as unknown as ArkmeService

    await dispatchArkmeHostOperation(service, 'recordings.calendar', {})
    await dispatchArkmeHostOperation(service, 'recordings.day', {})

    expect(recordingCalendar).toHaveBeenCalledWith(Number.NaN, Number.NaN, undefined)
    expect(recordingDay).toHaveBeenCalledWith(Number.NaN, undefined)
  })

  it('rejects an unknown generation kind before reaching the Audio owner facade', async () => {
    const generateRecordingProjection = vi.fn()
    const service = { generateRecordingProjection } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'recordings.generate', {
      dateStamp: 10, kind: 'transcript',
    })).rejects.toMatchObject({ code: 'recording-generation-kind-invalid' })
    expect(generateRecordingProjection).not.toHaveBeenCalled()
  })

  it('requires the active same-origin browser before generation mutations', async () => {
    const generateRecordingProjection = vi.fn()
    const setRecordingSummaryModelRoute = vi.fn()
    const server = createServer(createArkmeHostApi({
      generateRecordingProjection, setRecordingSummaryModelRoute,
    } as unknown as ArkmeService, {
      expectedPort: 3080,
      allowNonLoopback: false,
    }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    try {
      for (const body of [
        { operation: 'recordings.generate', params: { dateStamp: 10, kind: 'summary' } },
        { operation: 'recordings.compare.start', params: { dateStamp: 10 } },
        { operation: 'recordings.forward', params: { itemRefs: ['opaque'] } },
        { operation: 'recordings.summary-model-config.set', params: { routeKey: 'dashscope/qwen3-max' } },
      ]) {
        const response = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'origin-required' } })
      }
      expect(generateRecordingProjection).not.toHaveBeenCalled()
      expect(setRecordingSummaryModelRoute).not.toHaveBeenCalled()
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('dispatches only opaque recording import control operations', async () => {
    const recordingImportPreflight = vi.fn(async () => ({ duplicateFileNames: ['old.m4a'] }))
    const recordingImportList = vi.fn(async () => ({ items: [], owner: { state: 'available' as const } }))
    const recordingImportStatus = vi.fn(async () => ({ importRef: 'opaque', phase: 'uploading' }))
    const retryRecordingImport = vi.fn(async () => ({ importRef: 'opaque', phase: 'failed' }))
    const cancelRecordingImport = vi.fn(async () => ({ importRef: 'opaque', phase: 'cancelled' }))
    const recordingImportHistory = vi.fn(async () => ({ items: [], offset: 0, hasMore: false }))
    const updateRecordingImportSessionStart = vi.fn(async () => undefined)
    const updateRecordingImportSessionOwnership = vi.fn(async () => undefined)
    const deleteRecordingImportSession = vi.fn(async () => undefined)
    const service = {
      recordingImportPreflight, recordingImportList, recordingImportStatus, retryRecordingImport, cancelRecordingImport,
      recordingImportHistory, updateRecordingImportSessionStart, updateRecordingImportSessionOwnership,
      deleteRecordingImportSession,
    } as unknown as ArkmeService

    await dispatchArkmeHostOperation(service, 'recordings.import.preflight', { fileNames: ['new.m4a', 'old.m4a'] })
    await dispatchArkmeHostOperation(service, 'recordings.import.list', {})
    await dispatchArkmeHostOperation(service, 'recordings.import.status', { importRef: 'opaque' })
    await dispatchArkmeHostOperation(service, 'recordings.import.retry', { importRef: 'opaque', expectedRevision: 3 })
    await dispatchArkmeHostOperation(service, 'recordings.import.cancel', { importRef: 'opaque', expectedRevision: 4 })
    await dispatchArkmeHostOperation(service, 'recordings.import.history', { toMillis: 20, limit: 50, offset: 2 })
    await dispatchArkmeHostOperation(service, 'recordings.import.session.update-start', {
      sessionRef: 'session-opaque', startAtMillis: 10,
    })
    await dispatchArkmeHostOperation(service, 'recordings.import.session.update-ownership', {
      sessionRef: 'session-opaque', ownership: 'other',
    })
    await dispatchArkmeHostOperation(service, 'recordings.import.session.delete', { sessionRef: 'session-opaque' })

    expect(recordingImportPreflight).toHaveBeenCalledWith(['new.m4a', 'old.m4a'], undefined)
    expect(recordingImportStatus).toHaveBeenCalledWith('opaque')
    expect(retryRecordingImport).toHaveBeenCalledWith('opaque', 3)
    expect(cancelRecordingImport).toHaveBeenCalledWith('opaque', 4)
    expect(recordingImportHistory).toHaveBeenCalledWith({ toMillis: 20, limit: 50, offset: 2 }, undefined)
    expect(updateRecordingImportSessionStart).toHaveBeenCalledWith('session-opaque', 10, undefined)
    expect(updateRecordingImportSessionOwnership).toHaveBeenCalledWith('session-opaque', 'other', undefined)
    expect(deleteRecordingImportSession).toHaveBeenCalledWith('session-opaque', undefined)
  })

  it('dispatches opaque playback and owner-supported speaker assignment commands', async () => {
    const recordingPlayback = vi.fn(async () => ({ playbackRef: 'media-opaque' }))
    const recordingSpeakerOptions = vi.fn(async () => [{ speakerRef: 'speaker-opaque', label: '小林' }])
    const assignRecordingSpeaker = vi.fn(async () => ({ dateStamp: 10 }))
    const service = {
      recordingPlayback, recordingSpeakerOptions, assignRecordingSpeaker,
    } as unknown as ArkmeService

    await dispatchArkmeHostOperation(service, 'recordings.playback.open', { itemRef: 'item-opaque' })
    await dispatchArkmeHostOperation(service, 'recordings.speaker.options', { itemRef: 'item-opaque' })
    await dispatchArkmeHostOperation(service, 'recordings.speaker.assign-item', {
      itemRef: 'item-opaque', speakerRef: 'speaker-opaque', newSpeakerName: '', scope: 'speaker',
    })

    expect(recordingPlayback).toHaveBeenCalledWith('item-opaque', undefined)
    expect(recordingSpeakerOptions).toHaveBeenCalledWith('item-opaque', undefined)
    expect(assignRecordingSpeaker).toHaveBeenCalledWith({
      itemRef: 'item-opaque', speakerRef: 'speaker-opaque', scope: 'speaker',
    }, undefined)
  })

  it('rejects an unknown speaker mutation scope instead of silently treating it as one item', async () => {
    const assignRecordingSpeaker = vi.fn()
    const service = { assignRecordingSpeaker } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'recordings.speaker.assign-item', {
      itemRef: 'item-opaque', speakerRef: 'speaker-opaque', scope: 'session',
    })).rejects.toMatchObject({ code: 'recording-speaker-scope-invalid' })
    expect(assignRecordingSpeaker).not.toHaveBeenCalled()
  })
})
