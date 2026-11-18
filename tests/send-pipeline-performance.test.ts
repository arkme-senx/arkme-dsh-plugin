import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FileTransfers, type FileTransferPorts } from '../src/services/file-transfers.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'

it('reduces physical requests for ten ordered bodies without delaying receipts until batch end', async () => {
  const reports: object[] = []
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  for (const ordered of [false, true]) {
    let requests = 0, sequence = 0
    const accepted: string[] = [], committed: number[] = []
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests++
      await wait(60) // Identical per-request transport overhead in both workloads.
      const stream = req.url?.endsWith('/send-ordered')
      res.setHeader('Content-Type', stream ? 'application/x-ndjson' : 'application/json')
      const items = stream ? body.items : [body]
      for (let index = 0; index < items.length; index++) {
        await wait(5)
        const item = items[index]
        accepted.push(item.record_uid)
        const payload = { code: 200, data: { ...item, seq: ++sequence, ordered_send_version: 1 } }
        if (stream) res.write(JSON.stringify({ index, status: 200, attempted: true, payload }) + '\n')
        else res.write(JSON.stringify(payload))
      }
      res.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const directory = await mkdtemp(join(tmpdir(), 'arkme pipeline benchmark '))
    const session = { userId: 42, accessToken: 'local-only', refreshToken: 'local-only' }
    const config = { environment: 'test', chatBaseUrl: `http://127.0.0.1:${address.port}`, requestTimeoutMs: 5000 } as ArkmeServiceConfig
    const runtime = new ServiceRuntime(config, { read: async () => session, write: async () => {}, delete: async () => {} }, {} as never)
    const started = performance.now()
    const ports: FileTransferPorts = {
      currentUser: async () => 42, validateSource: async () => 'private_chat:chat',
      upload: async () => { throw new Error('unexpected upload') }, fetchMedia: async () => { throw new Error('unexpected download') },
      orderedSendsReady: () => ordered && runtime.orderedChatSendsReady(), runOrderedSends: actions => runtime.runOrderedChatSends(actions),
      send: async task => {
        const result = await runtime.authenticatedChatPost<{ seq: number }>('/api/v1/chats/records/send', {
          chat_session_uid: 'chat', record_uid: task.recordUid, rel_uid: task.relationUid, text_content: task.content.textContent,
        }, session)
        return { kind: 'owner_accepted', result: { sourceRef: task.sourceRef, itemUid: task.recordUid, sequence: result.seq, status: 1, localState: 'synced' } }
      },
      onProgressChange: (_user, _ref, task) => { if (task?.state === 'sent') committed.push(performance.now() - started) },
    }
    const owner = new FileTransfers(directory, ports, 1000)
    const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
    try {
      for (const [i, recordUid] of ids.entries()) await owner.enqueue({ sourceRef: 'source', recordUid,
        relationUid: `00000000-0000-4000-8001-${String(i + 1).padStart(12, '0')}`, fileRefs: [], content: { textContent: String(i) } })
      await owner.settled()
      expect(accepted).toEqual(ids)
      expect(new Set(accepted).size).toBe(10)
      expect((await owner.tasks()).every(task => task.state === 'sent')).toBe(true)
      expect(committed).toHaveLength(10)
      expect(requests).toBe(ordered ? 3 : 10)
      reports.push({ ordered, requests, messages: accepted.length, firstCommittedMs: committed[0], lastCommittedMs: committed.at(-1) })
    } finally {
      owner.dispose(); runtime.dispose(); server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true })
    }
  }
  if (process.env.ARKME_SEND_BENCHMARK_REPORT) await writeFile(process.env.ARKME_SEND_BENCHMARK_REPORT, JSON.stringify({ workload: 'isolated loopback; 60ms per request + 5ms per message; no production traffic or UI', reports }, null, 2) + '\n')
})
