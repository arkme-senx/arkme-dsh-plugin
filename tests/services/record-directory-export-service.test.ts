import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { RecordDirectoryExportService } from '../../src/services/record-directory-export-service.js';
import { wireExportSelection } from '../../src/services/record-export-range-service.js';
const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});
const all = { mode: 'all', timeZone: 'UTC', includeAttachments: true } as const;
const imagePath = 'pic/' + 'a'.repeat(64) + '.png';
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'arkme-directory-'));
    roots.push(root);
    let user = 11, version = 0, next = 0, changed = false, lostSaved = false, finished = 0, offline = false;
    const plans = new Map<string, any>();
    const baseFile = { file_asset_uid: 'asset', file_uid: 'file', file_kind: 1, mime_type: 'image/png', size: 3, suggested_name: 'image.png', backup_path: imagePath };
    const item = () => ({ record_uid: 'r1', version: changed ? 2 : 1, send_at: Date.UTC(2026, 10, 4, 1), title: '标题', text: changed ? '修改之后' : '正文', file_refs: [{ ...baseFile, reuse: changed }] });
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
            return { items: p.record_count ? [item()] : [], removed_uids: [], next_index: p.record_count, has_more: false };
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
                version++;
                p.status = 'saved';
                changed = false;
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
    return { root, service, post, fetchImpl, run, preview, destinationRef, version: () => version, finished: () => finished, change: () => { changed = true; }, loseSaved: () => { lostSaved = true; }, offline: () => { offline = true; }, switchUser: () => { user = 12; } };
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
