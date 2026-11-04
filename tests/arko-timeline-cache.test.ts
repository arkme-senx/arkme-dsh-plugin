import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArkoTimelineCacheStore } from '../src/arko-timeline-cache-store.js'
import { parseArkoTimelineCache, ARKO_TIMELINE_CACHE_MAX_BYTES } from '../src/arko-timeline-cache.js'
import { ArkoTimelineMemory } from '../src/client/arko-timeline-memory.js'
import type { ArkmeArkoTimelineCache } from '../src/arko-timeline-contract.js'
const dirs: string[] = []
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }) })
const snapshot = (at=1000): ArkmeArkoTimelineCache => ({ schemaVersion: 1, savedAtMillis: at, messages: [{ id:'history:1', messageId:1, sessionId:88, role:'assistant', text:'已加载回复', status:'done', createdAtMillis:1 }], interactions:[], session:{sessionId:88, name:'Arko', created:false}, historyCursor:'older', viewport:{scrollTop:128,followTail:false} })
it('restores a private atomic account/environment cache across store instances and never lets stale unmount overwrite it', async () => {
 const dir=await mkdtemp(join(tmpdir(),'arko-cache-'));dirs.push(dir);const store=new ArkoTimelineCacheStore(dir)
 await store.access('test:11',snapshot(2000));await store.access('test:11',snapshot(1000))
 expect(await new ArkoTimelineCacheStore(dir).access('test:11')).toEqual(snapshot(2000))
 expect(await store.access('test:12')).toBeUndefined();expect(await store.access('prod:11')).toBeUndefined()
 const files=await readdir(dir);expect(files).toHaveLength(1);expect(files[0]).not.toContain('test:11')
 if(process.platform!=='win32'){expect((await stat(join(dir,files[0]!))).mode&0o777).toBe(0o600);expect((await stat(dir)).mode&0o777).toBe(0o700)}
 expect(JSON.parse(await readFile(join(dir,files[0]!), 'utf8')).scope).toBe('test:11')
 await expect(store.access('../bad')).rejects.toThrow()
})
it('treats corrupt, oversized and mis-scoped files as misses and releases the writer after rejection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'arko-cache-'));dirs.push(dir);const store=new ArkoTimelineCacheStore(dir);await store.access('test:11',snapshot());const file=join(dir,(await readdir(dir))[0]!)
 await writeFile(file,'{bad');expect(await store.access('test:11')).toBeUndefined()
 await writeFile(file,'x'.repeat(ARKO_TIMELINE_CACHE_MAX_BYTES+1));expect(await store.access('test:11')).toBeUndefined()
 await store.access('test:11',snapshot(2000));expect((await store.access('test:11'))?.messages).toHaveLength(1)
 await expect(store.access('test:11',{...snapshot(3000),messages:[{...snapshot().messages[0]!,text:'中'.repeat(262145)}]})).resolves.toMatchObject({messages:[]})
})
it('has bounded admission and isolates synchronous memory by exact account scope',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'arko-cache-'));dirs.push(dir);const store=new ArkoTimelineCacheStore(dir)
 const tasks=Array.from({length:8},()=>store.access('test:11',snapshot()));const results=await Promise.allSettled(tasks)
 expect(results.filter(x=>x.status==='rejected')).toHaveLength(4)
 const memory=new ArkoTimelineMemory();memory.set('test:11',snapshot(2000));memory.set('test:11',snapshot(1000));expect(memory.get('test:11')?.savedAtMillis).toBe(2000)
 expect(memory.get('prod:11')).toBeUndefined();memory.clear();expect(memory.get('test:11')).toBeUndefined()
 expect(parseArkoTimelineCache({})).toBeUndefined()
})
