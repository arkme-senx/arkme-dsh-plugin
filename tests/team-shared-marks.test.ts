import {expect,it} from 'vitest'
import {readTeamUnderlineSnapshot,readUnderlineSnapshot} from '../src/message-annotations.js'

const quote={version:1,projection:'arkme-text-v1',sourceDigest:'a'.repeat(64),recordVersion:1,start:0,end:1,text:'中',prefix:'',suffix:''}
it('uses server ownership without manufacturing a numeric Team actor identity',()=>{
 const snapshot=readTeamUnderlineSnapshot({complete:true,revision:7,items:[{id:'mark',mine:false,actor_name:'成员',state:'available',anchor:quote,actor_user_id:99}]})
 expect(snapshot.items[0]).toMatchObject({mine:false,actorName:'成员'})
 expect(snapshot.items[0]).not.toHaveProperty('actorId')
 expect(()=>readUnderlineSnapshot({complete:true,accessible:true,revision:7,annotations:[{annotation_uid:'mark',mine:true,actor_name:'成员',state:'available',anchor:quote}]},42)).toThrow()
})
it('retains cancellable stale identity while refusing any historical quote content',()=>{
 expect(readTeamUnderlineSnapshot({complete:true,revision:8,items:[{id:'stale',mine:true,actor_name:'你',state:'stale'}]}).items).toEqual([{id:'stale',mine:true,actorName:'你',state:'stale'}])
 expect(()=>readTeamUnderlineSnapshot({complete:true,revision:8,items:[{id:'stale',mine:true,actor_name:'你',state:'stale',anchor:quote}]})).toThrow()
 expect(()=>readTeamUnderlineSnapshot({complete:false,revision:8,items:[]})).toThrow()
})
