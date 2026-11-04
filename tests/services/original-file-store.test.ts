import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { OriginalFileStore, originalFileKey } from '../../src/services/original-file-store.js';
const roots: string[] = [];
afterEach(async () => {
    for (const p of roots.splice(0))
        await rm(p, { recursive: true, force: true });
});
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'original-store-')); roots.push(dir); const runtime = { config: { environment: 'test', fileStateDirectory: dir } }; return { store: new OriginalFileStore(runtime as never), runtime }; }
const url = new URL('https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/account/original.png?Signature=first');
it('shares completed original bytes across requests, renewed signatures, and service restarts', async () => { const f = await fixture(), fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } })); const first = await f.store.obtain(11, url, 3, fetch); const another = new OriginalFileStore(f.runtime as never), changed = new URL(url); changed.search = 'Signature=second'; expect((await another.obtain(11, changed, 3, fetch)).sha256).toBe(first.sha256); expect(fetch).toHaveBeenCalledOnce(); });
it('does not share data across accounts or original/thumbnail transformations', async () => { const f = await fixture(), fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))); await f.store.obtain(11, url, 3, fetch); await f.store.obtain(12, url, 3, fetch); expect(fetch).toHaveBeenCalledTimes(2); const thumb = new URL(url); thumb.searchParams.set('x-oss-process', 'image/resize,w_80'); expect(originalFileKey('test', 11, thumb)).toBeUndefined(); expect(originalFileKey('prod', 11, url)).toBeUndefined(); });
it('rejects incomplete data and detects same-length local corruption before reuse', async () => { const f = await fixture(); await expect(f.store.obtain(11, url, 3, async () => new Response(new Uint8Array([1])))).rejects.toBeDefined(); const a = await f.store.obtain(11, url, 3, async () => new Response(new Uint8Array([1, 2, 3]))); await writeFile(a.path, new Uint8Array([9, 9, 9])); expect(await f.store.read(11, originalFileKey('test', 11, url)!, 3)).toBeUndefined(); });

it('cancels an abandoned original capture without keeping a partial file or publishing incomplete bytes',async()=>{
 const f=await fixture(),signal=new AbortController();const source=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1,2,3]))}});const response=await f.store.capture(11,originalFileKey('test',11,url)!,new Response(source,{headers:{'Content-Length':'6'}}),6,signal.signal);const reader=response.body!.getReader();expect((await reader.read()).value?.length).toBe(3);const waiting=reader.read().catch(()=>undefined);signal.abort();await waiting;await reader.cancel().catch(()=>{});await vi.waitFor(async()=>expect((await readdir(join(f.runtime.config.fileStateDirectory,'originals-v1','test','11'))).filter(name=>name.endsWith('.partial'))).toEqual([]));expect(await f.store.read(11,originalFileKey('test',11,url)!,6)).toBeUndefined();
});
