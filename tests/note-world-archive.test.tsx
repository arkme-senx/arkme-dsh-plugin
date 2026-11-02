import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(()=>({call:vi.fn(),snapshot:{} as any,auth:{status:'authenticated',environment:'test',userId:7} as any}))
vi.mock('../src/client/api.js',()=>({callArkme:mocked.call}))
vi.mock('../src/client/auth-store.js',()=>({arkmeAuthStore:{subscribe:()=>()=>{},getSnapshot:()=>mocked.snapshot}}))
vi.mock('../src/client/ArkmeWorldReactionHistory.js',()=>({WorldReactionArchive:(p:any)=><div data-archive={p.target.id}>{p.title}</div>}))
import { NoteWorldReactionArchive } from '../src/client/NoteWorldReactionArchive.js'
let ui:ReturnType<typeof create>|undefined
beforeEach(()=>{ mocked.snapshot={auth:mocked.auth}; mocked.call.mockReset() })
afterEach(async()=>{await act(async()=>ui?.unmount());ui=undefined})
it('keeps private sources empty and shows a separate archive only for the owned publication', async()=>{
 mocked.call.mockResolvedValue({items:[],unavailableRecordRefs:[]})
 await act(async()=>{ui=create(<NoteWorldReactionArchive sourceRef="private-source" messageActionRef="private-message"/>)})
 expect(ui!.toJSON()).toBeNull()
 mocked.call.mockResolvedValue({items:[{recordRef:'original',target:{id:'world-only',worldRecordRef:'sealed'},visibility:'unpublished'}],unavailableRecordRefs:[]})
 await act(async()=>ui!.update(<NoteWorldReactionArchive sourceRef="owned-source" messageActionRef="owned-message"/>))
 expect(JSON.stringify(ui!.toJSON())).toContain('世界表态 · 已取消公开')
 expect(mocked.call).toHaveBeenLastCalledWith('world.reactions.from-note',{accountKey:'test:7',sourceRef:'owned-source',messageActionRef:'owned-message'},expect.any(AbortSignal))
})
it('cancels an old original read and never attaches its archive to the next note', async()=>{
 let finish:(v:any)=>void=()=>{}
 mocked.call.mockImplementationOnce(()=>new Promise(r=>finish=r)).mockResolvedValue({items:[],unavailableRecordRefs:[]})
 await act(async()=>{ui=create(<NoteWorldReactionArchive sourceRef="s" messageActionRef="first"/>)})
 const signal=mocked.call.mock.calls[0]![2] as AbortSignal
 await act(async()=>ui!.update(<NoteWorldReactionArchive sourceRef="s" messageActionRef="second"/>))
 expect(signal.aborted).toBe(true)
 await act(async()=>finish({items:[{target:{id:'wrong'},visibility:'unpublished'}]}))
 expect(ui!.toJSON()).toBeNull()
})
