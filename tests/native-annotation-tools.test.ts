import { expect, it, vi } from 'vitest'
import { arkmeToolCatalog, createArkmeCoreToolDefinitions } from '../src/tools/index.js'
it('includes both annotation tools in the actual business registry with explicit write grant', async () => {
 expect(arkmeToolCatalog.toolNamesFor('business')).toEqual(expect.arrayContaining(['arkme_dsh_annotations_read','arkme_dsh_annotations_write']))
 const modules=arkmeToolCatalog.modulesFor('business').filter(m=>m.meta.toolName.startsWith('arkme_dsh_annotations_'))
 expect(modules.find(m=>m.meta.effect==='write')!.meta.grant).toBe('explicit-user-write')
 const nativeAnnotations=vi.fn().mockResolvedValue({supported:true})
 const read=createArkmeCoreToolDefinitions({nativeAnnotations} as never).find(t=>t.name==='arkme_dsh_annotations_read')!
 await read.execute({request_json:'{"action":"capabilities"}'},{signal:new AbortController().signal} as never)
 expect(nativeAnnotations).toHaveBeenCalledWith({action:'capabilities'},expect.any(AbortSignal))
})
