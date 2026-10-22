import { mkdtemp, readdir, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { GeneratedArtifacts } from '../src/generated-artifacts.js'
vi.mock('node:fs/promises', async original => {
 const actual = await original<typeof import('node:fs/promises')>()
 return { ...actual, open: vi.fn(actual.open) }
})
it('cleans a real partial file when the filesystem rejects a write', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'generated artifact disk '))
 const realOpen = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
 vi.mocked(open).mockImplementationOnce(async (...args) => {
   const handle = await realOpen.open(...args)
   vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
   return handle
 })
 try {
   const store = new GeneratedArtifacts(directory, async () => 'synthetic', async () => 7)
   await expect(store.create(7, 'Arko.md', async write => { await write('partial') })).rejects.toMatchObject({ code: 'ENOSPC' })
   expect(await readdir(directory)).toEqual([])
   const recovered = await store.create(7, 'Arko.md', async write => { await write('complete') })
   expect((await store.read(recovered.file.fileRef)).file.size).toBe(8)
   await expect(store.read(recovered.file.fileRef + 'tampered')).rejects.toMatchObject({ code: 'generated-file-unavailable' })
 } finally { vi.mocked(open).mockRestore(); await rm(directory, { recursive: true, force: true }) }
})
