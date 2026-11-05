import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { BackupDirectoryStore } from '../../src/services/backup-directory-store.js'
const item=(i:number)=>({record_uid:'r'+i,send_at:1000+i,title:'标题'+i,text:'完整正文🌏\n'.repeat(30),file_refs:[]})
it('rolls back the entire failed page, then commits a complete page without retaining partial rows',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'backup batch ')),store=new BackupDirectoryStore(await realpath(parent),'test:11');
 try{await store.open(true);expect(()=>store.stagePage('job',[item(1),{...item(2),text:1n}],[])).toThrow();
 store.stagePage('job',[item(3)],[]);store.commit('job','all',{scope:'test:11',version:1,attachments:false,savedAtMillis:1});
 expect([...store.records(1)].map(r=>r.record_uid)).toEqual(['r3']);
 expect(()=>store.stagePage('job',Array.from({length:101},(_,i)=>item(i)),[])).toThrow();
 }finally{store.close();await rm(parent,{recursive:true,force:true})}
});
it('batches Markdown writes without changing bytes, order, count or digest',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'backup output ')),store=new BackupDirectoryStore(await realpath(parent),'test:11');
 try{await store.open(true);const rows=Array.from({length:1000},(_,i)=>item(i));
 for(let i=0;i<rows.length;i+=100)store.stagePage('job',rows.slice(i,i+100),[]);
 const result=await store.writeReadable('job',2,0,Number.MAX_SAFE_INTEGER,'all');
 const expected=Buffer.from('# 即我备份\n\n'+rows.map(r=>`## ${new Date(r.send_at).toLocaleString()}\n\n${r.title}\n\n${r.text}\n\n\n`).join(''));
 expect((await readFile(result.path)).equals(expected)).toBe(true);expect(result.count).toBe(1000);expect(result.size).toBe(expected.length);expect(result.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
 }finally{store.close();await rm(parent,{recursive:true,force:true})}
});
