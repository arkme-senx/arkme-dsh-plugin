import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LocalPersonImpactStore } from '../src/local-person-impact.js'

describe('bounded identity impact checkpoints',()=>{
  it('counts over 3000 originals exactly, survives service reconstruction and replays old pages',()=>{
    const db=new DatabaseSync(':memory:')
    try {
      const transaction=(work:()=>void)=>{db.exec('BEGIN');try{work();db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}
      let store=new LocalPersonImpactStore(db,transaction)
      const command='a'.repeat(64),expires=Date.now()+300000,scope='test:510'
      const key=(n:number)=>createHash('sha256').update(`audio:${n}`).digest('base64url')
      let counts={recordingCount:0,chatCount:0}
      for(let page=0;page<101;page++){
        const keys=Array.from({length:100},(_,i)=>key(page*99+i))
        counts=store.append(scope,command,page+1,counts,keys,true,expires)
        if(page===50)store=new LocalPersonImpactStore(db,transaction)
      }
      expect(counts).toEqual({recordingCount:10000,chatCount:0})
      expect(store.append(scope,command,1,{recordingCount:0,chatCount:0},Array.from({length:100},(_,i)=>key(i)),true,expires)).toEqual({recordingCount:100,chatCount:0})
      expect(()=>store.append(scope,command,1,{recordingCount:0,chatCount:0},[key(999999)],true,expires)).toThrow('来源已变化')
      expect(()=>store.append('test:511',command,102,counts,[],true,expires)).toThrow('进度已失效')
      expect(()=>store.append(scope,command,103,counts,[],true,expires)).toThrow('进度已失效')
      expect(store.append(scope,command,102,counts,[key(0),key(1)],true,expires)).toEqual(counts)
      db.prepare('UPDATE person_impact_keys SET expires_at=0').run();db.prepare('UPDATE person_impact_pages SET expires_at=0').run()
      expect(()=>store.append(scope,command,103,counts,[],true,expires)).toThrow('进度已失效')
    }finally{db.close()}
  })
})
