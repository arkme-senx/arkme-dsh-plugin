import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: vi.fn(async () => await new Promise(() => undefined)),
}))

import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { PublicRecordingImportJob } from '../src/recording-import-shared.js'
import { ArkmeRecordingImportDialog, ArkmeRecordingImportTrigger } from '../src/client/recordings/ArkmeRecordingImportDialog.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('account-owned recording import feedback wiring', () => {
  let renderer: ReactTestRenderer
  beforeEach(() => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    vi.mocked(callArkme).mockReset().mockImplementation(async () => await new Promise(() => undefined))
  })
  afterEach(async () => { await act(async () => { renderer?.unmount() }) })

  it('projects the dialog status through the real workspace and clears it on account change', async () => {
    const auth = { status: 'authenticated' as const, environment: 'test' as const, userId: 42 }
    arkmeUi.showRecordings()
    await act(async () => { renderer = create(<ArkmeSurface initialAuth={auth} />) })
    const owner = () => renderer.root.findByType(ArkmeRecordingImportDialog)
    const trigger = () => renderer.root.findByType(ArkmeRecordingImportTrigger)
    await act(async () => { owner().props.onStatusChange('uploading') })
    expect(trigger().props.status).toBe('uploading')

    await act(async () => { arkmeUi.showSearch() })
    expect(renderer.root.findAllByType(ArkmeRecordingImportTrigger)).toHaveLength(0)
    expect(renderer.root.findAllByType(ArkmeRecordingImportDialog)).toHaveLength(1)
    await act(async () => { owner().props.onStatusChange('finalizing'); arkmeUi.showRecordings() })
    expect(trigger().props.status).toBe('finalizing')

    await act(async () => { renderer.update(<ArkmeSurface initialAuth={{ ...auth, userId: 43 }} />) })
    expect(owner().props.currentUserId).toBe(43)
    expect(trigger().props.status).toBe('idle')
  })

  it('ignores the previous account response after the new account has loaded real task feedback', async () => {
    const pendingLists: Array<(value: unknown) => void> = []
    vi.mocked(callArkme).mockImplementation(async operation => await new Promise(resolve => {
      if (operation === 'recordings.import.list') pendingLists.push(resolve)
    }))
    const auth = { status: 'authenticated' as const, environment: 'test' as const, userId: 42 }
    arkmeUi.showRecordings()
    await act(async () => { renderer = create(<ArkmeSurface initialAuth={auth} />) })
    expect(pendingLists).toHaveLength(1)
    await act(async () => { renderer.update(<ArkmeSurface initialAuth={{ ...auth, userId: 43 }} />) })
    expect(pendingLists).toHaveLength(2)
    const task: PublicRecordingImportJob = {
      kind: 'local', importRef: 'new-account-task', phase: 'finalizing', revision: 1, ownership: 'self',
      fileName: 'new.m4a', fileSize: 4, durationMillis: 1_000, startAtMillis: 1, endAtMillis: 1_001,
      progress: 1, status: 'processing', statusDetail: '正在完成导入', createdAtMillis: 1, updatedAtMillis: 1,
    }
    await act(async () => { pendingLists[1]!({ items: [task], owner: { state: 'available' } }) })
    const trigger = () => renderer.root.findByType(ArkmeRecordingImportTrigger)
    expect(trigger().props.status).toBe('finalizing')
    await act(async () => { pendingLists[0]!({ items: [{ ...task, importRef: 'old-account-task', phase: 'uploading' }], owner: { state: 'available' } }) })
    expect(trigger().props.status).toBe('finalizing')
    expect(renderer.root.findByType(ArkmeRecordingImportDialog).props.currentUserId).toBe(43)
  })
})
