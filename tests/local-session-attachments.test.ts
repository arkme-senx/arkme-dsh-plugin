import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import LocalSessionAttachments from '../src/local-session-attachments.js'

it('reads verified old objects in place and shares newly written objects with the next executor', async () => {
  const home = await mkdtemp(join(tmpdir(), 'arkme-attachment-')), ctx = new Context(), source = new Context()
  try {
    const old = new LocalAttachmentStore(source, { dshHome: join(home, 'old') })
    const ref = await old.saveFile({ data: Buffer.from('original'), name: 'history.txt' })
    ctx.provide('arkmeLocalHistory', { attachmentHomes: () => [join(home, 'old')] } as never)
    const store = new LocalSessionAttachments(ctx, { dshHome: join(home, 'shared') })
    const read = async (ref: typeof fresh) => { const chunks = []; for await (const chunk of store.readFileStream(ref)) chunks.push(chunk); return Buffer.concat(chunks).toString() }
    expect(store.fileHostPath(ref)).toBe(old.fileHostPath(ref))
    expect(await read(ref)).toBe('original')
    const fresh = await store.saveFile({ data: Buffer.from('continued'), name: 'new.txt' })
    expect(store.fileHostPath(fresh)).toContain(join(home, 'shared'))
    await chmod(old.fileHostPath(ref), 0o600)
    await writeFile(old.fileHostPath(ref), 'corrupted')
    await expect(read(ref)).rejects.toThrow()
    const nextCtx = new Context()
    try {
      const next = new LocalAttachmentStore(nextCtx, { dshHome: join(home, 'shared') })
      const chunks = []; for await (const chunk of next.readFileStream(fresh)) chunks.push(chunk)
      expect(Buffer.concat(chunks).toString()).toBe('continued')
    } finally { await nextCtx.fiber.dispose() }
  } finally { await ctx.fiber.dispose(); await source.fiber.dispose(); await rm(home, { recursive: true, force: true }) }
})
