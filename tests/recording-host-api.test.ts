import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('recording UI-only host operations', () => {
  it('dispatches calendar and day reads without adding public SDK methods', async () => {
    const recordingCalendar = vi.fn(async () => ({ fromStamp: 10, toStamp: 20, days: [] }))
    const recordingDay = vi.fn(async () => ({ dateStamp: 10, totalDurationMillis: 0 }))
    const service = { recordingCalendar, recordingDay } as unknown as ArkmeService

    const controller = new AbortController()
    await expect(dispatchArkmeHostOperation(service, 'recordings.calendar', {
      fromStamp: 10,
      toStamp: 20,
    }, undefined, undefined, undefined, undefined, controller.signal)).resolves.toMatchObject({ fromStamp: 10, toStamp: 20 })
    await expect(dispatchArkmeHostOperation(
      service, 'recordings.day', { dateStamp: 10 }, undefined, undefined, undefined, undefined, controller.signal,
    ))
      .resolves.toMatchObject({ dateStamp: 10 })

    expect(recordingCalendar).toHaveBeenCalledWith(10, 20, controller.signal)
    expect(recordingDay).toHaveBeenCalledWith(10, controller.signal)
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
