import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordExportService } from '../../src/services/record-export-service.js'

const roots: string[] = []
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })
const options = { expectedAccountScope: 'test:11', confirmed: true, orderKind: 1 } as const
const ref = { file_asset_uid: 'image1', file_kind: 1, suggested_name: '../../a (1).png' }
const item = { record_uid: 'r1', send_at: 1000, title: '标题', text: '正文', file_refs: [ref] }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arkme export with spaces ')); roots.push(root)
  let userId = 11
  const post = vi.fn(async (path: string): Promise<Record<string, unknown>> => {
    if (path.endsWith('/start')) return { can_export: true, export_session_uid: 'session1', record_count: 1 }
    if (path.endsWith('/page')) return { items: [item], has_more: false }
    if (path.endsWith('/batch-sign')) return { items: [{ file_asset_uid: 'image1', method: 'GET', size: 3, headers: {}, url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/image?signature=secret' }] }
    return {}
  })
  const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
  const runtime = { config: { environment: 'test', fileStateDirectory: root }, requireSession: async () => ({ userId, refreshToken: 'secret' }), stateStore: { uniqueCode: async () => 'test-secret' }, authenticatedPost: post, fetchImpl }
  const owner = new RecordExportService(runtime as never)
  return { owner, root, post, fetchImpl, setUser: (value: number) => { userId = value } }
}
// Independently read central-directory metadata and local payloads of stored ZIPs.
function unzip(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const files = new Map<string, Buffer>(); let cursor = bytes.readUInt32LE(end + 16)
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50)
    const size = bytes.readUInt32LE(cursor + 20), nameSize = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameSize).toString()
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28)
    files.set(name, bytes.subarray(start, start + size)); cursor += 46 + nameSize + extra + comment
  }
  return files
}
describe('complete record export owner', () => {
  it.each([
    ['项目计划', '项目计划'],
    [' \t\n ', '未命名主题'],
    [undefined, '未命名主题'],
    ['  <主题> & [链接](url)\n# 一 *二* `三` \\四  ', '&lt;主题&gt; &amp; \\[链接\\]\\(url\\) \\# 一 \\*二\\* \\`三\\` \\\\四'],
  ])('writes the current topic as plain metadata before the unchanged body: %s', async (title, expected) => {
    const f = await fixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async path => path.endsWith('/page')
      ? { items: [{ ...item, topic_core: { topic_uid: 'topic1', title } }], has_more: false }
      : original(path))
    const result = await f.owner.run(options)
    const files = unzip(await readFile((await f.owner.read(result.fileRef)).path))
    const markdown = [...files.entries()].find(([name]) => name.endsWith('.md'))![1].toString()
    expect(markdown).toContain(`\n\n主题：${expected}\n\n标题\n\n正文`)
    expect(markdown).not.toContain('topic1')
    expect([...files.entries()].find(([name]) => name.startsWith('pic/'))![1]).toEqual(Buffer.from([1, 2, 3]))
    expect(f.post.mock.calls.map(([path]) => path.split('/').slice(-2).join('/'))).toEqual([
      'session/start', 'records/page', 'files/batch-sign', 'session/finish',
    ])
  })
  it.each([undefined, null, {}, [], 'legacy', { topic_uid: '' }, { topic_uid: '  ' }, { topic_uid: 1 }])(
    'preserves legacy output when no valid visible topic is returned: %j', async topic => {
      const f = await fixture(), original = f.post.getMockImplementation()!
      f.post.mockImplementation(async path => path.endsWith('/page')
        ? { items: [{ ...item, topic_core: topic }], has_more: false }
        : original(path))
      const result = await f.owner.run(options)
      const files = unzip(await readFile((await f.owner.read(result.fileRef)).path))
      const markdown = [...files.entries()].find(([name]) => name.endsWith('.md'))![1].toString()
      expect(markdown).not.toContain('主题：')
      expect(markdown).toContain('标题\n\n正文')
    },
  )
  it('uses each page’s topic summary without additional requests or leaking topic ids', async () => {
    const f = await fixture()
    let page = 0
    f.post.mockImplementation(async path => {
      if (path.endsWith('/start')) return { can_export: true, export_session_uid: 'session1', record_count: 101 }
      if (path.endsWith('/page')) {
        const first = page++ === 0
        return { items: Array.from({ length: first ? 100 : 1 }, (_, i) => ({
          ...item, record_uid: `${first ? 'a' : 'b'}${i}`, file_refs: [],
          topic_core: { topic_uid: 'private-internal-id', title: first ? '工作' : '生活' },
        })), has_more: first, next_cursor_send_at: 1000, next_cursor_record_uid: 'a99' }
      }
      return {}
    })
    const result = await f.owner.run(options)
    const files = unzip(await readFile((await f.owner.read(result.fileRef)).path))
    const markdown = [...files.values()][0]!.toString()
    expect(markdown.match(/主题：工作/g)).toHaveLength(100)
    expect(markdown.match(/主题：生活/g)).toHaveLength(1)
    expect(markdown).not.toContain('private-internal-id')
    expect(f.post).toHaveBeenCalledTimes(4)
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('creates a real ZIP with Markdown and exact attachment bytes, reports finish and protects the account', async () => {
    const f = await fixture(), progress = vi.fn()
    const result = await f.owner.run(options, undefined, progress)
    expect(result).toMatchObject({ accountScope: 'test:11', count: 1, quotaFinalized: true })
    expect(JSON.stringify(result)).not.toMatch(/signature|secret|session1/)
    const download = await f.owner.read(result.fileRef)
    expect(download.file.mimeType).toBe('application/zip')
    const files = unzip(await readFile(download.path))
    expect([...files.keys()]).toHaveLength(2)
    const imagePath = [...files.keys()].find(name => name.startsWith('pic/'))!
    expect(imagePath).not.toContain('../')
    expect(files.get(imagePath)).toEqual(Buffer.from([1, 2, 3]))
    expect([...files.entries()].find(([name]) => name.endsWith('.md'))![1].toString()).toContain('标题\n\n正文')
    expect(progress).toHaveBeenLastCalledWith({ count: 1 })
    expect(f.post).toHaveBeenCalledWith(expect.stringContaining('/start'), { order_kind: 1, hide_record_privacy_lock: true }, expect.anything(), expect.anything(), undefined)
    expect(f.post).toHaveBeenCalledWith(expect.stringContaining('/finish'), { export_session_uid: 'session1', success: true }, expect.anything(), expect.anything(), undefined)
    expect(await readdir(join(f.root, 'record-exports/test'))).toEqual([expect.stringMatching(/\.zip$/)])
    f.setUser(12); await expect(f.owner.read(result.fileRef)).rejects.toMatchObject({ code: 'generated-file-unavailable' })
  })
  it('downloads legacy attachments whose size metadata is unknown', async () => {
    const f = await fixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async path => {
      const result = await original(path)
      if (path.endsWith('/batch-sign')) (result.items as Record<string, unknown>[])[0]!.size = 0
      return result
    })
    const result = await f.owner.run(options)
    const files = unzip(await readFile((await f.owner.read(result.fileRef)).path))
    expect([...files.entries()].find(([name]) => name.startsWith('pic/'))![1]).toEqual(Buffer.from([1, 2, 3]))
  })
  it('does not create sessions without confirmation or for a stale account', async () => {
    const f = await fixture()
    await expect(f.owner.run({ ...options, confirmed: false } as never)).rejects.toMatchObject({ code: 'record-export-confirmation-required' })
    await expect(f.owner.run({ ...options, expectedAccountScope: 'test:12' })).rejects.toMatchObject({ code: 'record-export-account-changed' })
    expect(f.post).not.toHaveBeenCalled()
  })
  it.each(['missing-signature', 'short-file', 'private-url', 'count-mismatch', 'bad-cursor', 'switch-account'])('fails closed and removes incomplete artifacts: %s', async mode => {
    const f = await fixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async path => {
      if (mode === 'missing-signature' && path.endsWith('/batch-sign')) return { items: [] }
      if (mode === 'count-mismatch' && path.endsWith('/start')) return { can_export: true, export_session_uid: 'session1', record_count: 2 }
      if (mode === 'bad-cursor' && path.endsWith('/page')) return { items: [item], has_more: true, next_cursor_send_at: 0, next_cursor_record_uid: '' }
      const result = await original(path)
      if (mode === 'private-url' && path.endsWith('/batch-sign')) (result.items as Record<string, unknown>[])[0]!.url = 'https://127.0.0.1/private'
      return result
    })
    if (mode === 'short-file') f.fetchImpl.mockImplementation(async () => new Response(new Uint8Array([1])))
    if (mode === 'switch-account') f.fetchImpl.mockImplementation(async () => { f.setUser(12); return new Response(new Uint8Array([1, 2, 3])) })
    await expect(f.owner.run(options)).rejects.toBeDefined()
    expect(await readdir(join(f.root, 'record-exports/test'))).toEqual([])
    expect(f.post.mock.calls.filter(call => call[0].endsWith('/finish')).length).toBe(mode === 'switch-account' ? 0 : 1)
  })
  it('keeps a valid archive when finish acknowledgement is lost and never contradicts success with failure', async () => {
    const f = await fixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async path => { if (path.endsWith('/finish')) throw new Error('network lost'); return original(path) })
    const result = await f.owner.run(options)
    expect(result.quotaFinalized).toBe(false)
    await expect(f.owner.read(result.fileRef)).resolves.toBeDefined()
    expect(f.post.mock.calls.filter(call => call[0].endsWith('/finish'))).toHaveLength(1)
  })
  it('cancels the active stream on dispose and rejects concurrent export admission', async () => {
    const f = await fixture(); let signal: AbortSignal | undefined
    f.fetchImpl.mockImplementation(((_url: URL, init: RequestInit) => { signal = init.signal!; return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })) }) as never)
    const pending = f.owner.run(options), outcome = pending.catch(error => error)
    await vi.waitFor(() => expect(signal).toBeDefined())
    await expect(f.owner.run(options)).rejects.toMatchObject({ code: 'record-export-busy' })
    f.owner.dispose()
    expect(await outcome).toMatchObject({ code: 'record-export-failed' })
    expect(signal!.aborted).toBe(true)
    expect(await readdir(join(f.root, 'record-exports/test'))).toEqual([])
  })
})
