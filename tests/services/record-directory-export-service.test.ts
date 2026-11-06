import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { backupDocumentName, RecordDirectoryExportService } from '../../src/services/record-directory-export-service.js';
import { wireExportSelection } from '../../src/services/record-export-range-service.js';
const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});
const all = { mode: 'all', timeZone: 'UTC', includeAttachments: true } as const;
const imagePath = 'pic/' + 'a'.repeat(64) + '.png';
async function fixture(topic?: unknown) {
    const root = await mkdtemp(join(tmpdir(), 'arkme-directory-'));
    roots.push(root);
    let user = 11, version = 0, next = 0, changed = false, lostSaved = false, finished = 0, offline = false;
    const plans = new Map<string, any>();
    const baseFile = { file_asset_uid: 'asset', file_uid: 'file', file_kind: 1, mime_type: 'image/png', size: 3, suggested_name: 'image.png', backup_path: imagePath };
    const item = () => ({ record_uid: 'r1', version: changed ? 2 : 1, send_at: Date.UTC(2026, 10, 4, 1), topic_core: topic, title: '标题', text: changed ? '修改之后' : '正文', file_refs: [{ ...baseFile, reuse: changed }] });
    const post = vi.fn(async (path: string, body: any) => {
        if (path.endsWith('/capabilities'))
            return { protocol_version: 2, date_range: true, incremental: true, explicit_saved_confirmation: true, attachment_reuse: true, incremental_no_quota: true, policy_version: 3 };
        if (path.endsWith('/prepare')) {
            if (offline)
                throw new TypeError('offline');
            const isDelta = body.selection.mode === 'incremental', uid = 'plan-' + (++next), count = isDelta ? (changed ? 1 : 0) : 1;
            const plan = { preview_uid: uid, selection: body.selection, selection_fingerprint: 'a'.repeat(64), base_version: version, status: 'ready', record_count: count, new_count: version ? 0 : count, updated_count: version ? count : 0, removed_count: 0, total_image_count: count, total_voice_count: 0, reuse_attachments: body.reuse_attachments === true };
            plans.set(uid, plan);
            return { protocol_version: 2, can_export: !isDelta || version > 0, baseline_required: isDelta && version === 0, chain: { version, saved_at: version ? 1000 : 0 }, plan };
        }
        const p = plans.get(body.preview_uid);
        if (path.endsWith('/status'))
            return p;
        if (path.endsWith('/start')) {
            p.status = 'started';
            return p;
        }
        if (path.endsWith('/page'))
            return { items: p.record_count ? [{ ...item(), file_refs: p.selection.include_attachments ? item().file_refs : [] }] : [], removed_uids: [], next_index: p.record_count, has_more: false };
        if (path.endsWith('/batch-sign'))
            return { items: [{ ...baseFile, method: 'GET', url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/original.png?Signature=rotating', headers: {} }] };
        if (path.endsWith('/finish')) {
            if (body.success) {
                finished++;
                p.status = 'generated';
            }
            else
                p.status = 'failed';
            return { quota_finalized: true };
        }
        if (path.endsWith('/saved')) {
            if (lostSaved) {
                lostSaved = false;
                throw new Error('network lost');
            }
            ;
            if (p.status !== 'saved') {
                if (p.selection.mode !== 'dates') {
                    version++;
                    changed = false;
                }
                p.status = 'saved';
            }
            ;
            return { version, saved_at: 1000 + version };
        }
        throw new Error(path);
    });
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } }));
    const runtime = { config: { environment: 'test', fileStateDirectory: join(root, 'cache') }, requireSession: async () => ({ userId: user, refreshToken: 'secret' }), stateStore: { uniqueCode: async () => root }, authenticatedPost: post, fetchImpl };
    const service = new RecordDirectoryExportService(runtime as never);
    service.attach(async () => root);
    const picked = await service.pick('test:11');
    const destinationRef = picked.destinationRef!;
    const preview = async (selection: any = all) => service.preview('test:11', selection, 1, destinationRef);
    const run = async (selection: any = all) => { const p = await preview(selection); return service.run({ expectedAccountScope: 'test:11', confirmed: true, orderKind: 1, selection, previewUid: p.previewUid!, destinationRef }); };
    return { root, runtime, service, post, fetchImpl, run, preview, destinationRef, version: () => version, finished: () => finished, change: () => { changed = true; }, setTopic: (value: unknown) => { topic = value; changed = true; }, loseSaved: () => { lostSaved = true; }, offline: () => { offline = true; }, switchUser: () => { user = 12; } };
}
it('writes a readable folder and automatically confirms exactly one complete backup', async () => {
    const f = await fixture(), r = await f.run();
    expect(r.kind).toBe('directory');
    expect(r.savedConfirmationRef).toBeUndefined();
    expect(f.version()).toBe(1);
    expect(f.finished()).toBe(1);
    const content = await readFile(join(f.root, '即我备份-test-11', r.fileName), 'utf8');
    expect(content).toContain('正文');
    expect(content).toContain(`./${imagePath}`);
    expect(await readFile(join(f.root, '即我备份-test-11', imagePath))).toEqual(Buffer.from([1, 2, 3]));
});
it('reuses originals across a changed-text delta and subsequent full local repack', async () => {
    const f = await fixture();
    await f.run();
    f.change();
    const second = await f.run({ ...all, mode: 'incremental' });
    expect(second.count).toBe(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.version()).toBe(2);
    const p = await f.preview();
    expect(p.localReplica).toBe(true);
    const third = await f.run();
    expect(third.count).toBe(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.finished()).toBe(2);
    expect(await readFile(join(f.root, '即我备份-test-11', third.fileName), 'utf8')).toContain('修改之后');
});
it('keeps a generated folder recoverable when the saved response is lost, without a second finish', async () => {
    const f = await fixture();
    f.loseSaved();
    await expect(f.run()).rejects.toBeDefined();
    expect(f.finished()).toBe(1);
    expect(f.version()).toBe(0);
    const p = await f.preview();
    expect(p.localReplica).toBe(true);
    expect(f.version()).toBe(1);
    expect(f.finished()).toBe(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});
it('does not confirm a reused attachment that was modified in place', async () => {
    const f = await fixture();
    await f.run();
    await writeFile(join(f.root, '即我备份-test-11', imagePath), new Uint8Array([9, 9, 9]));
    f.change();
    await expect(f.run({ ...all, mode: 'incremental' })).rejects.toThrow('被修改');
    expect(f.version()).toBe(1);
    expect(f.finished()).toBe(1);
});
it('filters a local date export instead of returning the entire local replica', async () => {
    const f = await fixture();
    await f.run();
    const r = await f.run({ ...all, mode: 'dates', startDate: '2026-11-01', endDate: '2026-11-02' });
    expect(r.count).toBe(0);
    expect(await readFile(join(f.root, '即我备份-test-11', r.fileName), 'utf8')).not.toContain('正文');
    expect(f.finished()).toBe(1);
});
it('rejects another account and forged paths without sending an export request', async () => {
    const f = await fixture();
    const before = f.post.mock.calls.length;
    f.switchUser();
    await expect(f.service.run({ expectedAccountScope: 'test:11', selection: all, previewUid: 'x', confirmed: true, orderKind: 1, destinationRef: f.destinationRef })).rejects.toBeDefined();
    expect(f.post).toHaveBeenCalledTimes(before);
});
it('exports the complete local replica offline with its saved timestamp and no new quota use', async () => {
    const f = await fixture();
    await f.run();
    f.offline();
    const preview = await f.preview();
    expect(preview.localSnapshotOnly).toBe(true);
    const result = await f.run();
    expect(result.count).toBe(1);
    expect(result.savedAtMillis).toBe(1001);
    expect(f.finished()).toBe(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});
it('requires the selected folder to contain the matching baseline before offering an incremental run', async () => {
    const f = await fixture();
    const preview = await f.preview({ ...all, mode: 'incremental' });
    expect(preview.canExport).toBe(false);
    expect(preview.baselineRequired).toBe(true);
    expect(preview.previewUid).toBeUndefined();
    expect(f.finished()).toBe(0);
});
it('shows local date counts for that range and retained image counts for local full exports', async () => {
    const f = await fixture();
    await f.run();
    const allPreview = await f.preview();
    expect(allPreview).toMatchObject({ recordCount: 1, imageCount: 1 });
    const datePreview = await f.preview({ ...all, mode: 'dates', startDate: '2026-11-01', endDate: '2026-11-02' });
    expect(datePreview).toMatchObject({ recordCount: 0, imageCount: 0 });
    f.change();
    expect(await f.preview()).toMatchObject({ recordCount: 1, imageCount: 1, countsPending: true });
});
it('does not acknowledge a recovered date export whose original file was changed after the finish response', async () => {
    const f = await fixture();
    f.loseSaved();
    await expect(f.run({ ...all, mode: 'dates', startDate: '2026-11-04', endDate: '2026-11-04' })).rejects.toBeDefined();
    await writeFile(join(f.root, '即我备份-test-11', imagePath), new Uint8Array([9, 9, 9]));
    await expect(f.preview()).rejects.toThrow('被修改');
    expect(f.version()).toBe(0);
    expect(f.finished()).toBe(1);
});
it('does not treat an equal checkpoint version from a different device as the selected folder baseline', async () => {
    const f = await fixture();
    await f.run();
    const other = new RecordDirectoryExportService({ ...f.runtime, stateStore: { uniqueCode: async () => f.root + 'other-device' } } as never);
    other.attach(async () => f.root);
    const picked = await other.pick('test:11');
    const preview = await other.preview('test:11', { ...all, mode: 'incremental' }, 1, picked.destinationRef);
    expect(preview).toMatchObject({ canExport: false, baselineRequired: true });
    expect((await other.preview('test:11', all, 1, picked.destinationRef)).localReplica).not.toBe(true);
    expect(f.finished()).toBe(1);
});
it('preserves the original folder initialization error and releases the owner for a later export', async () => {
    const f = await fixture(), p = await f.preview(), dir = join(f.root, '即我备份-test-11');
    await mkdir(dir);
    await writeFile(join(dir, '.arkme-backup.json'), JSON.stringify({ schema: 1, scope: 'test:12' }));
    const options = { expectedAccountScope: 'test:11', confirmed: true, orderKind: 1, selection: all, previewUid: p.previewUid!, destinationRef: f.destinationRef } as const;
    await expect(f.service.run(options)).rejects.toThrow('不属于当前账号');
    await writeFile(join(dir, '.arkme-backup.json'), JSON.stringify({ schema: 1, scope: 'test:11' }));
    const result = await f.service.run(options);
    expect(result.count).toBe(1);
    expect(f.version()).toBe(1);
});
it('persists an accepted start with a lost response and reconciles that exact task after service restart', async () => {
    const f = await fixture(), original = f.post.getMockImplementation()!;
    let lose = true, statusOffline = true;
    let accepted = '';
    f.post.mockImplementation(async (path, body) => { if (path.endsWith('/start') && lose) {
        lose = false;
        accepted = body.preview_uid;
        await original(path, body);
        throw new TypeError('start response lost');
    } if (path.endsWith('/status') && statusOffline)
        throw new TypeError('temporarily offline'); return original(path, body); });
    await expect(f.run()).rejects.toThrow('未完成');
    statusOffline = false;
    const restarted = new RecordDirectoryExportService(f.runtime as never);
    restarted.attach(async () => f.root);
    const directory = await restarted.pick('test:11');
    const p = await restarted.preview('test:11', all, 1, directory.destinationRef);
    expect(f.post.mock.calls.filter(([path, body]) => path.endsWith('/finish') && body.preview_uid === accepted && body.success === false)).toHaveLength(1);
    const result = await restarted.run({ expectedAccountScope: 'test:11', confirmed: true, selection: all, orderKind: 1, destinationRef: directory.destinationRef!, previewUid: p.previewUid! });
    expect(result.count).toBe(1);
    expect(f.finished()).toBe(1);
    expect(f.version()).toBe(1);
});
it('does not start a second task while an interrupted start is still being confirmed', async () => {
    const f = await fixture(), original = f.post.getMockImplementation()!;
    let lose = true, starting = true;
    f.post.mockImplementation(async (path, body) => { if (path.endsWith('/start') && lose) {
        lose = false;
        await original(path, body);
        throw new TypeError('start response lost');
    } if (path.endsWith('/status') && starting)
        return { ...await original(path, body), status: 'starting' }; return original(path, body); });
    await expect(f.run()).rejects.toBeDefined();
    await expect(f.preview()).rejects.toThrow('正在确认');
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/start'))).toHaveLength(1);
    starting = false;
    expect((await f.run()).count).toBe(1);
});
it('recovers a lost finish response by confirming saved bytes without repeating the quota finish', async () => {
    const f = await fixture(), original = f.post.getMockImplementation()!;
    let lose = true;
    f.post.mockImplementation(async (path, body) => { const response = await original(path, body); if (path.endsWith('/finish') && body.success && lose) {
        lose = false;
        throw new TypeError('finish response lost');
    } return response; });
    await expect(f.run()).rejects.toBeDefined();
    expect(f.finished()).toBe(1);
    expect((await f.preview()).localReplica).toBe(true);
    expect(f.finished()).toBe(1);
    expect(f.version()).toBe(1);
});
it('keeps quota uncertainty visible after successful saved recovery and local repacking', async () => {
    const f = await fixture(), original = f.post.getMockImplementation()!;
    f.post.mockImplementation(async (path, body) => { const value = await original(path, body); return path.endsWith('/finish') && body.success ? { ...value, quota_finalized: false } : value; });
    f.loseSaved();
    await expect(f.run()).rejects.toBeDefined();
    expect((await f.run()).quotaFinalized).toBe(false);
    expect(f.finished()).toBe(1);
});
it('recovers a date export with another attachment option without changing the complete folder baseline', async () => {
    const f = await fixture();
    await f.run();
    f.loseSaved();
    await expect(f.run({ ...all, mode: 'dates', includeAttachments: false, startDate: '2026-11-04', endDate: '2026-11-04' })).rejects.toBeDefined();
    expect((await f.preview()).localReplica).toBe(true);
    expect(f.version()).toBe(1);
});

it.each([true, false])('retains current topic names across full, dates, delta and offline exports; attachments=%s', async includeAttachments => {
    const f = await fixture({ topic_uid: 'topic', title: '旧名' }), selection = { ...all, includeAttachments };
    const content = async (r: { fileName: string }) => readFile(join(f.root, '即我备份-test-11', r.fileName), 'utf8');
    expect(await content(await f.run(selection))).toContain('主题：旧名\n\n标题\n\n正文');
    f.setTopic({ topic_uid: 'topic', title: '改名 <&> [x]\n# line' });
    const updated = await content(await f.run({ ...selection, mode: 'incremental' }));
    expect(updated).toContain('主题：改名 &lt;&amp;&gt; \\[x\\] \\# line');
    expect(updated).not.toContain('旧名');
    expect(await content(await f.run({ ...selection, mode: 'dates', startDate: '2026-11-04', endDate: '2026-11-04' }))).toContain('主题：改名');
    f.setTopic({ topic_uid: 'other', title: '' });
    expect(await content(await f.run({ ...selection, mode: 'incremental' }))).toContain('主题：未命名主题');
    f.setTopic(undefined);
    expect(await content(await f.run({ ...selection, mode: 'incremental' }))).not.toContain('主题：');
    f.offline();
    expect(await content(await f.run(selection))).not.toContain('主题：');
    expect(f.fetchImpl).toHaveBeenCalledTimes(includeAttachments ? 1 : 0);
});

it('accepts legacy Windows receipt names only inside the original backup root', () => {
    const root = 'C:\\Backup Folder\\即我备份-test-11';
    expect(backupDocumentName(root, '导出.md')).toBe('导出.md');
    expect(backupDocumentName(root, root + '\\导出.md')).toBe('导出.md');
    for (const value of ['C:\\other\\导出.md', 'D:\\Backup Folder\\即我备份-test-11\\导出.md',
        '..\\导出.md', 'sub\\导出.md', 'bad:stream.md', 'bad\0.md', 1]) {
        expect(() => backupDocumentName(root, value)).toThrow('凭据无效');
    }
    expect(() => backupDocumentName('/tmp/backup', '/tmp/backup/导出.md')).toThrow('凭据无效');
});

it('reuses an opted-in frozen preview across tab/directory checks, with refresh, TTL and export invalidation', async () => {
 const f=await fixture();
 const cached=(destination?:string,refresh=false)=>f.service.preview('test:11',all,1,destination,undefined,refresh);
 const first=await cached();expect((await cached(f.destinationRef)).previewUid).toBe(first.previewUid);
 expect(f.post.mock.calls.filter(([p])=>p.endsWith('/prepare'))).toHaveLength(1);
 await cached(f.destinationRef,true);
 expect(f.post.mock.calls.filter(([p])=>p.endsWith('/prepare'))).toHaveLength(2);
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+60_001);
 try {await cached(f.destinationRef)} finally {clock.mockRestore()}
 expect(f.post.mock.calls.filter(([p])=>p.endsWith('/prepare'))).toHaveLength(3);
 await f.run();
 expect((await cached(f.destinationRef)).localReplica).toBe(true);
 f.switchUser();await expect(cached(f.destinationRef)).rejects.toMatchObject({code:'record-export-account-changed'});
});
it('joins preview readers without letting one canceled reader abort the other',async()=>{
 const f=await fixture(), original=f.post.getMockImplementation()!;
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r});
 f.post.mockImplementation(async(path,body)=>{if(path.endsWith('/prepare'))await gate;return original(path,body)});
 const a=new AbortController(),b=new AbortController();
 const one=f.service.preview('test:11',all,1,undefined,a.signal,false);const failed=expect(one).rejects.toBeDefined();
 const two=f.service.preview('test:11',all,1,undefined,b.signal,false);
 await vi.waitFor(()=>expect(f.post.mock.calls.filter(([p])=>p.endsWith('/prepare'))).toHaveLength(1));
 a.abort();await failed;release();expect((await two).recordCount).toBe(1);
 expect(f.post.mock.calls.filter(([p])=>p.endsWith('/prepare'))).toHaveLength(1);f.service.dispose();
});
it('bounds original downloads at four, deduplicates shared files and preserves every verified attachment',async()=>{
 const f=await fixture(),original=f.post.getMockImplementation()!;
 const refs=Array.from({length:8},(_,i)=>({file_asset_uid:'a'+i,file_kind:1,size:3,backup_path:'pic/'+String(i).padStart(64,'0')+'.png',reuse:false}));
 f.post.mockImplementation(async(path,body)=>{
  if(path.endsWith('/page'))return{items:[{record_uid:'r1',version:1,send_at:1,title:'标题',text:'正文',file_refs:[...refs,refs[0]]}],removed_uids:[],has_more:false,next_index:1};
  if(path.endsWith('/batch-sign'))return{items:refs.map((f,i)=>({...f,method:'GET',url:'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/'+i+'.png',headers:{}}))};
  return original(path,body);
 });
 let active=0,max=0;
 f.fetchImpl.mockImplementation(async()=>{active++;max=Math.max(max,active);try{await new Promise(r=>setTimeout(r,10));return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Length':'3'}})}finally{active--}});
 const result=await f.run();expect(max).toBe(4);expect(active).toBe(0);expect(f.fetchImpl).toHaveBeenCalledTimes(8);
 const receipt=JSON.parse(await readFile(join(f.root,'即我备份-test-11',result.fileName+'.json'),'utf8'));
 expect(receipt.records).toBe(1);expect(receipt.files).toHaveLength(8);
 for(const file of refs)expect(await readFile(join(f.root,'即我备份-test-11',file.backup_path))).toEqual(Buffer.from([1,2,3]));
});

it('settles concurrent attachment writers before failing and never acknowledges an incomplete export',async()=>{
 const f=await fixture(),original=f.post.getMockImplementation()!;
 const refs=Array.from({length:4},(_,i)=>({file_asset_uid:'a'+i,file_kind:1,size:3,backup_path:'pic/'+String(i).padStart(64,'0')+'.png',reuse:false}));
 f.post.mockImplementation(async(path,body)=>{
  if(path.endsWith('/page'))return{items:[{record_uid:'r1',version:1,send_at:1,title:'标题',text:'正文',file_refs:refs}],removed_uids:[],has_more:false,next_index:1};
  if(path.endsWith('/batch-sign'))return{items:refs.map((f,i)=>({...f,method:'GET',url:'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/'+i+'.png',headers:{}}))};
  return original(path,body);
 });
 let active=0,started=0;
 f.fetchImpl.mockImplementation(async()=>{active++;const index=started++;try{await new Promise(r=>setTimeout(r,index===0?5:20));if(index===0)throw new Error('download failed');return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Length':'3'}})}finally{active--}});
 await expect(f.run()).rejects.toMatchObject({code:'directory-export-failed'});expect(active).toBe(0);expect(f.version()).toBe(0);
 expect(f.post.mock.calls.some(([path,body])=>path.endsWith('/finish')&&body.success===true)).toBe(false);
 expect(f.post.mock.calls.some(([path])=>path.endsWith('/saved'))).toBe(false);
 f.fetchImpl.mockImplementation(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Length':'3'}}));
 expect((await f.run()).count).toBe(1);
});

it('reports syncing, file generation and save confirmation in order, and blocks preview recovery during a live export',async()=>{
 const f=await fixture(),original=f.post.getMockImplementation()!;let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r});let saving=false;
 f.post.mockImplementation(async(path,body)=>{if(path.endsWith('/saved')){saving=true;await gate}return original(path,body)});
 const p=await f.preview(),updates:any[]=[];
 const run=f.service.run({expectedAccountScope:'test:11',confirmed:true,orderKind:1,selection:all,previewUid:p.previewUid!,destinationRef:f.destinationRef},undefined,p=>updates.push(p));
 await vi.waitFor(()=>expect(saving).toBe(true));
 expect(updates).toEqual([{count:0,phase:'preparing'},{count:0,phase:'syncing'},{count:1,phase:'syncing'},{count:1,phase:'writing'},{count:1,phase:'confirming'}]);
 const calls=f.post.mock.calls.length;await expect(f.preview()).rejects.toThrow('已有导出');expect(f.post.mock.calls).toHaveLength(calls);
 release();await run;
 const local=await f.preview();updates.length=0;
 await f.service.run({expectedAccountScope:'test:11',confirmed:true,orderKind:1,selection:all,previewUid:local.previewUid!,destinationRef:f.destinationRef},undefined,p=>updates.push(p));
 expect(updates).toEqual([{count:0,phase:'preparing'},{count:0,phase:'writing'}]);
});
it('rejects conflicting attachment identities before writing or advancing the backup',async()=>{
 const f=await fixture(),original=f.post.getMockImplementation()!;
 f.post.mockImplementation(async(path,body)=>{const value=await original(path,body);if(path.endsWith('/page'))value.items[0].file_refs.push({...value.items[0].file_refs[0],file_asset_uid:'conflict'});return value});
 await expect(f.run()).rejects.toThrow('附件身份冲突');expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.version()).toBe(0);expect(f.finished()).toBe(0);
});
it('bounds prepared plans and simultaneous distinct prepares, and clears work on disposal',async()=>{
 const f=await fixture(),date=(n:number)=>({...all,mode:'dates' as const,startDate:`2026-11-${String(n).padStart(2,'0')}`,endDate:`2026-11-${String(n).padStart(2,'0')}`});
 for(let n=1;n<=13;n++)await f.service.preview('test:11',date(n),1,undefined,undefined,false);
 const before=f.post.mock.calls.filter(([path])=>path.endsWith('/prepare')).length;
 await f.service.preview('test:11',date(13),1,undefined,undefined,false);expect(f.post.mock.calls.filter(([path])=>path.endsWith('/prepare'))).toHaveLength(before);
 await f.service.preview('test:11',date(1),1,undefined,undefined,false);expect(f.post.mock.calls.filter(([path])=>path.endsWith('/prepare'))).toHaveLength(before+1);
 const signals:AbortSignal[]=[];
 f.runtime.authenticatedPost=vi.fn(async(_path,_body,_session,signal:AbortSignal)=>{signals.push(signal);await new Promise((_r,j)=>signal.addEventListener('abort',()=>j(signal.reason),{once:true}));return {}}) as never;
 const pending=Array.from({length:4},(_,i)=>f.service.preview('test:11',date(20+i),1,undefined,undefined,false).then(()=>false,()=>true));
 await vi.waitFor(()=>expect(signals).toHaveLength(4));await expect(f.service.preview('test:11',date(24),1,undefined,undefined,false)).rejects.toThrow('正在准备其他');
 f.service.dispose();expect(await Promise.all(pending)).toEqual([true,true,true,true]);expect(signals.every(s=>s.aborted)).toBe(true);
});
