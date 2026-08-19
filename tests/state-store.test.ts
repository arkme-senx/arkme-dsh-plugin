import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'

describe('ArkmeStateStore', () => {
  it('persists a stable device id and account-isolated pending writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-state-'))
    const store = new ArkmeStateStore(root)
    const uniqueCode = await store.uniqueCode()
    await store.putPending(10001, {
      recordUid: 'record-1',
      textContent: 'hello',
      createdAtMillis: 1,
      sendAtMillis: 1,
      attempts: 0,
    })

    const reloaded = new ArkmeStateStore(root)
    expect(await reloaded.uniqueCode()).toBe(uniqueCode)
    expect(await reloaded.listPending(10001)).toHaveLength(1)
    expect(await reloaded.listPending(10002)).toEqual([])

    const path = join(root, 'state.json')
    const mode = (await stat(path)).mode & 0o777
    expect(mode).toBe(0o600)
    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(persisted).not.toHaveProperty('accessToken')
    expect(persisted).not.toHaveProperty('refreshToken')
  })

  it('keeps long-article drafts isolated by account, source, and edited record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-draft-'))
    const store = new ArkmeStateStore(root)
    await store.putLongArticleDraft(10001, {
      sourceRef: 'source-a', title: '新建', textContent: '正文', durationMillis: 1200, updatedAtMillis: 1,
    })
    await store.putLongArticleDraft(10001, {
      sourceRef: 'source-a', itemUid: 'record-1', title: '编辑', textContent: '编辑正文', durationMillis: 900, updatedAtMillis: 2,
    })

    const reloaded = new ArkmeStateStore(root)
    await expect(reloaded.getLongArticleDraft(10001, 'source-a')).resolves.toMatchObject({ title: '新建' })
    await expect(reloaded.getLongArticleDraft(10001, 'source-a', 'record-1')).resolves.toMatchObject({ title: '编辑' })
    await expect(reloaded.getLongArticleDraft(10002, 'source-a')).resolves.toBeUndefined()
    await expect(reloaded.getLongArticleDraft(10001, 'source-b')).resolves.toBeUndefined()

    await reloaded.removeLongArticleDraft(10001, 'source-a', 'record-1')
    await expect(reloaded.getLongArticleDraft(10001, 'source-a', 'record-1')).resolves.toBeUndefined()
    await expect(reloaded.getLongArticleDraft(10001, 'source-a')).resolves.toMatchObject({ title: '新建' })
  })
})
