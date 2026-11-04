import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { historicalSessionFormatCatalog, createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'
import { readLocalHistoryFormats, cloudHistoryFormat } from '../src/local-history-format.js'

it('uses the official migrations and retains old message coordinates across compressed frames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'old format with spaces ')), id = 'old-session'
  try {
    const folder = join(root, 'workspace', id); await mkdir(folder, { recursive: true })
    const header = { type: 'session', version: 0, id, createdAt: 1, cwd: root, delegationDepth: 0 }
    const rows = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'user/message', seq: 2, time: 2, surfaceOp: 'append', data: { id: 'message-one', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'history' }] } },
      { type: 'step/end', seq: 3, time: 3, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 4, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const restore = createSessionFormatCatalogWithChildren([]).createRestore(header, { recovery: 'strict', validation: 'current' })
    for (const row of rows) restore.decodeRow(structuredClone(row))
    const current = restore.finish()
    const bytes = Buffer.concat([header, ...rows].map(row => zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n'))))
    await writeFile(join(folder, 'session.jsonl.zstd'), bytes)
    const formats = await readLocalHistoryFormats(root, id, current, [], new AbortController().signal)
    expect(formats?.current.events.find(e => e.type === 'user/message')?.seq).toBe(3)
    expect(formats?.originals[0]?.events.find(e => e.type === 'user/message')?.seq).toBe(2)
    const original = await cloudHistoryFormat(formats!, { post: async path => path.endsWith('session-events/list') ? { entries: rows.map(event => ({ event })) } : { items: [], has_more: false } }, 'source', id, new AbortController().signal)
    expect(original.header.version).toBeLessThan(3)
    expect(await readFile(join(folder, 'session.jsonl.zstd'))).toEqual(bytes)
    const v3 = formats!.originals.find(value => value.header.version === 3)!
    await rm(join(folder, 'session.jsonl.zstd'))
    await writeFile(join(folder, 'session.v3.jsonl'), [historicalSessionFormatCatalog.encodeCurrentHeader(v3.header, v3.inheritedEventCount), ...v3.events.map(event => historicalSessionFormatCatalog.encodeCurrentEvent(event))].map(row => JSON.stringify(row)).join('\n') + '\n')
    const retainedV3 = await readLocalHistoryFormats(root, id, current, [], new AbortController().signal)
    expect(retainedV3?.originals[0]?.inheritedEventCount).toBe(v3.inheritedEventCount)
    expect(retainedV3?.current.events).toEqual(current.events)
    // An obsolete generation may be unreadable while the released native reader accepts V3.
    await writeFile(join(folder, 'session.jsonl.zstd'), zstdCompressSync(Buffer.from(JSON.stringify(header) + '\ninvalid old row\n')))
    expect((await readLocalHistoryFormats(root, id, current, [], new AbortController().signal))?.current.events).toEqual(current.events)
    await writeFile(join(folder, 'session.v4.jsonl'), [createSessionFormatCatalogWithChildren([]).encodeCurrentHeader(current.header, current.inheritedEventCount), ...current.events.map(event => createSessionFormatCatalogWithChildren([]).encodeCurrentEvent(event))].map(row => JSON.stringify(row)).join('\n') + '\n')
    await rm(join(folder, 'session.v3.jsonl'))
    const nativeOnly = await readLocalHistoryFormats(root, id, current, [], new AbortController().signal)
    expect(nativeOnly?.originals).toEqual([])
    expect(nativeOnly?.current.events).toEqual(current.events)
    expect(nativeOnly?.unavailableOriginals).toBe(true)
    await expect(cloudHistoryFormat(nativeOnly!, { post: async () => ({ entries: [{ event: rows[2] }] }) }, 'source', id, new AbortController().signal)).rejects.toMatchObject({ code: 'LOCAL_HISTORY_FORMAT_UNAVAILABLE' })
    await expect(readLocalHistoryFormats(root, id, { ...current, events: [] }, [], new AbortController().signal)).rejects.toThrow('不一致')
    await expect(readLocalHistoryFormats(root, id, current, [], AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('keeps V3 cloud coordinates valid after appending current-format events', async () => {
  const old = { seq: 0, time: 1, type: 'user/message', data: { role: 'user', source: { kind: 'plugin', plugin: 'goal' }, content: [] } }
  const now = { ...old, data: { ...old.data, source: { kind: 'goal' } } }
  const current = { header: { version: 4, id: 'continued' }, inheritedEventCount: 0, events: [now, { seq: 1, time: 2, type: 'session/end-seed', data: {} }] }
  const formats = { current, originals: [{ header: { version: 3, id: 'continued' }, inheritedEventCount: 0, events: [old] }] } as Parameters<typeof cloudHistoryFormat>[0]
  const request = { post: async (path: string) => path.endsWith('session-events/list') ? { entries: [{ event: old }] } : { items: [], has_more: false } }
  expect(await cloudHistoryFormat(formats, request, 'runtime', 'continued', new AbortController().signal)).toBe(current)
  const changed = { ...old, time: 99 }
  await expect(cloudHistoryFormat(formats, { post: async () => ({ entries: [{ event: changed }] }) }, 'runtime', 'continued', new AbortController().signal)).rejects.toThrow('不同')
})

it.skipIf(!process.env.ARKME_FORMAT_REAL_SOURCE)('verifies retained real journal against official current persistence output', async () => {
  const input = JSON.parse(await readFile(process.env.ARKME_FORMAT_REAL_SOURCE!, 'utf8'))
  const result = await readLocalHistoryFormats(input.root, input.id, input.current, [], new AbortController().signal)
  expect(result?.originals[0]?.header.version).toBe(1)
  expect(result?.current.events).toEqual(input.current.events)
})
