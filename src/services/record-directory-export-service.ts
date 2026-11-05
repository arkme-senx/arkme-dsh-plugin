import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { basename, win32 } from 'node:path';
import { EncryptedReferenceCodec } from '../encrypted-reference.js';
import type { ArkmeExportSelection, ArkmeRangeExportPreview, ArkmeRecordExport, ArkmeRecordExportOptions, ArkmeRecordExportProgress } from '../data-management.js';
import { ArkmePluginError, type ServiceRuntime } from './service.js';
import { RecordExportRangeService, exportSelection, wireExportSelection } from './record-export-range-service.js';
import { OriginalFileStore } from './original-file-store.js';
import { BackupDirectoryStore, atomicWrite, backupFailure, object, hashFile } from './backup-directory-store.js';
// Older Windows receipts stored an absolute path; resolve only the original root,
// without rewriting the receipt whose digest was already acknowledged remotely.
export function backupDocumentName(root: string, value: unknown): string {
    if (typeof value !== 'string')
        throw backupFailure('上次备份的本地凭据无效');
    let name = value;
    if (win32.isAbsolute(root) && win32.isAbsolute(value) && win32.dirname(value) === win32.normalize(root))
        name = win32.basename(value);
    if (!/^[^/\\:\0]+\.md$/.test(name))
        throw backupFailure('上次备份的本地凭据无效');
    return name;
}
interface Target {
    scope: string;
    path: string;
    dev: number;
    ino: number;
    expires: number;
}
interface LocalPreview {
    scope: string;
    destinationRef: string;
    selection: ArkmeExportSelection;
    order: 1 | 2;
    preview?: ArkmeRangeExportPreview;
    version: number;
}
export class RecordDirectoryExportService {
    private picker?: (signal: AbortSignal) => Promise<string | null>;
    private opener: ((path: string, signal: AbortSignal) => Promise<void>) | undefined;
    private controller: AbortController | undefined;
    private readonly codec: EncryptedReferenceCodec;
    private readonly ranges: RecordExportRangeService;
    private readonly files: OriginalFileStore;
    private readonly previews = new Map<string, LocalPreview>();
    constructor(private readonly runtime: ServiceRuntime) { this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), () => backupFailure('导出目录授权已失效，请重新选择')); this.ranges = new RecordExportRangeService(runtime, true); this.files = new OriginalFileStore(runtime); }
    attach(picker: (signal: AbortSignal) => Promise<string | null>, opener?: (path: string, signal: AbortSignal) => Promise<void>) { this.picker = picker; this.opener = opener; }
    dispose() { this.controller?.abort(); }
    async pick(scope: string, signal?: AbortSignal) {
        await this.ranges.session(scope);
        if (!this.picker)
            throw backupFailure('当前宿主没有本机目录选择能力，请在桌面客户端导出');
        const path = await this.picker(signal ?? new AbortController().signal);
        if (path === null)
            return { accountScope: scope, canceled: true as const };
        await this.ranges.session(scope);
        const actual = await realpath(path), stat = await lstat(actual);
        if (!stat.isDirectory())
            throw backupFailure('请选择文件夹');
        const value: Target = { scope, path: actual, dev: stat.dev, ino: stat.ino, expires: Date.now() + 24 * 60 * 60000 };
        return { accountScope: scope, canceled: false as const, destinationRef: await this.codec.seal('arkme-export-directory-v1', value), displayName: basename(actual), displayPath: actual };
    }
    private async target(scope: string, ref: string) {
        await this.ranges.session(scope);
        const value = await this.codec.open('arkme-export-directory-v1', ref) as unknown as Target;
        if (value.scope !== scope || value.expires < Date.now() || typeof value.path !== 'string')
            throw backupFailure('导出目录授权已失效，请重新选择');
        const stat = await lstat(value.path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== value.dev || stat.ino !== value.ino || await realpath(value.path) !== value.path)
            throw backupFailure('导出目录已变化，请重新选择');
        return new BackupDirectoryStore(value.path, scope);
    }
    async open(scope: string, ref: string, signal?: AbortSignal) {
        const store = await this.target(scope, ref);
        if (!await store.open())
            throw backupFailure('备份目录不存在');
        try {
            if (!this.opener)
                throw backupFailure('当前宿主无法打开文件夹');
            await this.opener(store.root, signal ?? new AbortController().signal);
        }
        finally {
            store.close();
        }
    }
    private async chainIdentity(scope: string, attachments: boolean) {
        const session = await this.ranges.session(scope);
        return createHash('sha256').update(`${session.userId}:${await this.ranges.device(scope)}:${attachments}`).digest('hex');
    }
    private async recoverStart(scope: string, store: BackupDirectoryStore, signal?: AbortSignal) {
        const meta = store.meta(), pending = meta?.pendingStart;
        if (!meta || !pending || meta.pending)
            return;
        if (typeof pending.uid !== 'string' || !pending.uid || pending.uid.length > 100 || pending.chainUid !== await this.chainIdentity(scope, pending.attachments))
            throw backupFailure('待恢复导出属于其他设备或凭据无效，请在原设备恢复。');
        const status = await this.ranges.post(scope, 'status', { preview_uid: pending.uid }, signal, true);
        let quotaPending = meta.quotaPending === true;
        if (status.status === 'started') {
            const finish = await this.ranges.post(scope, 'finish', { preview_uid: pending.uid, success: false, artifact_sha256: '', artifact_size: 0 }, signal);
            quotaPending ||= finish.quota_finalized !== true;
        }
        else if (!['ready', 'failed', 'superseded', 'unavailable'].includes(String(status.status))) {
            throw backupFailure('上次导出正在确认状态，请稍后重试；不会重复使用导出额度。');
        }
        store.setMeta({ ...meta, quotaPending, pendingStart: undefined });
    }
    private async recover(scope: string, store: BackupDirectoryStore, signal?: AbortSignal) {
        const meta = store.meta();
        if (!meta?.pending)
            return;
        if ((meta.pending.chainUid ?? meta.chainUid) !== await this.chainIdentity(scope, typeof meta.pending.attachments === 'boolean' ? meta.pending.attachments : meta.attachments))
            throw backupFailure('待确认备份属于其他设备，请在原设备恢复或选择新的文件夹。');
        const pending = meta.pending;
        const documentName = backupDocumentName(store.root, pending.document);
        const document = await hashFile(store.root + '/' + documentName);
        if (document.sha256 !== pending.documentHash || document.size !== pending.documentSize)
            throw backupFailure('上次备份文件被修改，不能确认增量进度');
        const receiptPath = store.root + '/' + documentName + '.json';
        const receiptFile = await hashFile(receiptPath);
        if (receiptFile.sha256 !== pending.digest || receiptFile.size > 32 * 1024 * 1024)
            throw backupFailure('上次备份的保存凭据无效');
        const receipt = object(JSON.parse(await readFile(receiptPath, 'utf8')));
        if (receipt.scope !== scope || receipt.preview_uid !== pending.uid || receipt.sha256 !== pending.documentHash || receipt.size !== pending.documentSize || !Array.isArray(receipt.files) || receipt.files.length > 100000)
            throw backupFailure('上次备份的文件清单无效');
        let attachmentBytes = 0;
        const seen = new Set<string>();
        for (const raw of receipt.files) {
            const f = object(raw);
            if (typeof f.path !== 'string' || seen.has(f.path))
                throw backupFailure('上次备份的文件清单无效');
            seen.add(f.path);
            await store.reuseFile(f.path, Number(f.size));
            const known = store.file(f.path)!;
            if (known.sha256 !== f.sha256 || known.size !== f.size)
                throw backupFailure('上次备份原文件被修改');
            attachmentBytes += known.size;
        }
        if (receiptFile.size + document.size + attachmentBytes !== pending.size)
            throw backupFailure('上次备份不完整');
        const status = await this.ranges.post(scope, 'status', { preview_uid: pending.uid }, signal, true);
        let quotaPending = meta.quotaPending === true || status.quota_pending === true || status.status === 'generated-unconfirmed';
        if (status.status === 'started') {
            const finish = await this.ranges.post(scope, 'finish', { preview_uid: pending.uid, success: true, artifact_sha256: pending.digest, artifact_size: pending.size }, signal);
            quotaPending ||= finish.quota_finalized !== true;
        }
        else if (!['generated', 'generated-unconfirmed', 'saved'].includes(String(status.status)))
            throw backupFailure('上次备份正在确认，请稍后重试；已写入的文件仍保留');
        const response = await this.ranges.post(scope, 'saved', { preview_uid: pending.uid, artifact_sha256: pending.digest, artifact_size: pending.size, user_confirmed_saved: true }, signal);
        store.setMeta(pending.mode === 'dates' ? { ...meta, quotaPending, pendingStart: undefined, pending: undefined } : { ...meta, quotaPending, pendingStart: undefined, version: Number(response.version), savedAtMillis: Number(response.saved_at), pending: undefined });
    }
    async preview(scope: string, raw: unknown, order: 1 | 2, destinationRef?: string, signal?: AbortSignal): Promise<ArkmeRangeExportPreview> {
        const selection = exportSelection(raw);
        if (!destinationRef)
            return this.ranges.preview(scope, selection, order, signal);
        const store = await this.target(scope, destinationRef);
        const baselineMissing = (preview: ArkmeRangeExportPreview): ArkmeRangeExportPreview => { const result = { ...preview, canExport: false, baselineRequired: true, message: '此文件夹没有匹配的完整备份，请先选择全部建立备份。' }; delete result.previewUid; return result; };
        try {
            if (!await store.open()) {
                const preview = await this.ranges.preview(scope, selection, order, signal);
                return selection.mode === 'incremental' ? baselineMissing(preview) : preview;
            }
            await this.recoverStart(scope, store, signal);
            await this.recover(scope, store, signal);
            const meta = store.meta();
            if (!meta?.version || meta.attachments !== selection.includeAttachments || meta.chainUid !== await this.chainIdentity(scope, selection.includeAttachments)) {
                const preview = await this.ranges.preview(scope, selection, order, signal);
                return selection.mode === 'incremental' ? baselineMissing(preview) : preview;
            }
            if (selection.mode === 'incremental') {
                const preview = await this.ranges.preview(scope, selection, order, signal);
                return preview.chainVersion === meta.version ? preview : baselineMissing(preview);
            }
            let delta: ArkmeRangeExportPreview;
            let offline = false;
            try {
                delta = await this.ranges.preview(scope, { mode: 'incremental', timeZone: selection.timeZone, includeAttachments: selection.includeAttachments }, order, signal);
            }
            catch (error) {
                if (signal?.aborted || !(error instanceof TypeError || error instanceof ArkmePluginError && error.retryable && error.httpStatus >= 500 && !error.upstreamStatus))
                    throw error;
                offline = true;
                delta = { accountScope: scope, supported: true, folderSupported: true, canExport: true, baselineRequired: false, message: '', recordCount: 0, imageCount: 0, voiceCount: 0, newCount: 0, updatedCount: 0, removedCount: 0, chainVersion: meta.version, savedAtMillis: meta.savedAtMillis };
            }
            if (delta.baselineRequired || delta.chainVersion !== meta.version)
                return this.ranges.preview(scope, selection, order, signal);
            const uid = 'local-' + randomUUID();
            if (this.previews.size > 30)
                this.previews.clear();
            this.previews.set(uid, { scope, destinationRef, selection, order, preview: delta, version: meta.version });
            const counts = store.statistics(selection.mode === 'dates' ? { start: selection.startDate!, end: selection.endDate!, timeZone: selection.timeZone } : undefined);
            return { ...delta, ...counts, countsPending: delta.recordCount + delta.removedCount > 0, previewUid: uid, selectionFingerprint: createHash('sha256').update(JSON.stringify([selection, order])).digest('hex'), canExport: true, localReplica: true, localSnapshotOnly: offline, message: offline ? '当前离线，将导出上次完整保存的本地副本。' : '复用本地备份，仅从云端同步变化，不占用全量导出次数。' };
        }
        finally {
            store.close();
        }
    }
    async run(options: ArkmeRecordExportOptions, parent?: AbortSignal, progress?: (v: ArkmeRecordExportProgress) => void): Promise<ArkmeRecordExport> {
        if (!options.destinationRef || !options.selection || !options.previewUid || options.confirmed !== true)
            throw backupFailure('请先选择导出文件夹并确认导出');
        if (this.controller)
            throw backupFailure('已有导出正在进行，请稍后重试');
        const scope = options.expectedAccountScope, selection = exportSelection(options.selection), store = await this.target(scope, options.destinationRef), job = randomUUID();
        if (this.controller)
            throw backupFailure('已有导出正在进行，请稍后重试');
        const controller = new AbortController();
        this.controller = controller;
        const signal = AbortSignal.any([controller.signal, ...(parent ? [parent] : [])]), timer = setTimeout(() => controller.abort(), 90 * 60000);
        let uid = '', finishAttempted = false, completed = false, failed = false;
        try {
            await store.open(true);
            await this.recoverStart(scope, store, signal);
            await this.recover(scope, store, signal);
            const local = this.previews.get(options.previewUid);
            if (local && (local.scope !== scope || local.destinationRef !== options.destinationRef || JSON.stringify(local.selection) !== JSON.stringify(selection) || local.order !== options.orderKind))
                throw backupFailure('导出范围已变化，请刷新');
            if (options.previewUid.startsWith('local-') && !local)
                throw backupFailure('导出预览已失效，请刷新后重试');
            let requested = selection, previewUid = options.previewUid;
            if (local) {
                if (store.meta()?.version !== local.version || store.meta()?.chainUid !== await this.chainIdentity(scope, selection.includeAttachments))
                    throw backupFailure('本地备份已变化，请刷新');
                requested = { mode: 'incremental', timeZone: selection.timeZone, includeAttachments: selection.includeAttachments };
                previewUid = local.preview!.previewUid!;
            }
            const hasChanges = !local || local.preview!.recordCount + local.preview!.removedCount > 0;
            let start: Record<string, any> | undefined, count = 0;
            if (hasChanges) {
                uid = previewUid;
                const previous = store.meta() ?? { scope, version: 0, attachments: selection.includeAttachments, savedAtMillis: 0 };
                store.setMeta({ ...previous, pendingStart: { uid, attachments: requested.includeAttachments, chainUid: await this.chainIdentity(scope, requested.includeAttachments) } });
                start = await this.ranges.post(scope, 'start', { preview_uid: uid }, signal);
                const expected = wireExportSelection(requested, options.orderKind);
                if (start.preview_uid !== uid || start.status !== 'started' || Object.entries(expected).some(([k, v]) => start!.selection?.[k] !== v) || start.reuse_attachments !== true)
                    throw backupFailure('后端目录导出协议暂不可用，请升级后重试');
                if (requested.mode === 'incremental' && (store.meta()?.version !== Number(start.base_version) || store.meta()?.attachments !== requested.includeAttachments || store.meta()?.chainUid !== await this.chainIdentity(scope, requested.includeAttachments)))
                    throw backupFailure('此文件夹没有对应的完整备份，请选择原文件夹或先导出全部');
                let after = 0;
                const seen = new Set<string>(), removed = new Set<string>();
                for (let pageNumber = 0;; pageNumber++) {
                    if (pageNumber > 1000)
                        throw backupFailure('导出分页超出上限');
                    const page = await this.ranges.post(scope, 'page', { preview_uid: uid, after_index: after, limit: 100 }, signal, true);
                    if (!Array.isArray(page.items) || !Array.isArray(page.removed_uids) || page.items.length + page.removed_uids.length > 100)
                        throw backupFailure('导出分页无效');
                    for (const raw of page.items) {
                        const row = object(raw);
                        if (typeof row.record_uid !== 'string' || !row.record_uid || row.record_uid.length > 200 || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isSafeInteger(row.send_at) || row.send_at < 0 || typeof row.title !== 'string' || typeof row.text !== 'string' || !Array.isArray(row.file_refs) || row.file_refs.length > 100)
                            throw backupFailure('导出记录格式无效');
                    }
                    const downloadable = page.items.flatMap((i: Record<string, any>) => (i.file_refs ?? []).filter((f: Record<string, any>) => !f.reuse)) as Record<string, any>[];
                    const signed = new Map<string, Record<string, any>>();
                    for (let offset = 0; offset < downloadable.length; offset += 100) {
                        const refs = downloadable.slice(offset, offset + 100);
                        const response = await this.ranges.post(scope, 'files/batch-sign', { preview_uid: uid, record_uids: page.items.map((i: Record<string, any>) => i.record_uid), file_asset_uids: [...new Set(refs.map(f => f.file_asset_uid))] }, signal, true);
                        if (!Array.isArray(response.items))
                            throw backupFailure('原文件签名无效');
                        for (const raw of response.items) {
                            const f = object(raw);
                            signed.set(String(f.file_asset_uid), f);
                        }
                    }
                    for (const raw of page.items) {
                        const item = object(raw), recordUid = String(item.record_uid);
                        if (!recordUid || seen.has(recordUid) || removed.has(recordUid) || !Array.isArray(item.file_refs))
                            throw backupFailure('导出记录不完整');
                        seen.add(recordUid);
                        for (const value of item.file_refs) {
                            const f = object(value), relative = String(f.backup_path);
                            if (f.reuse === true) {
                                await store.reuseFile(relative, Number(f.size), signal);
                                continue;
                            }
                            const signature = signed.get(String(f.file_asset_uid));
                            if (!signature || signature.method !== 'GET')
                                throw backupFailure('原文件暂不可用');
                            const original = await this.files.obtain((await this.ranges.session(scope)).userId, new URL(String(signature.url)), Number(signature.size), async () => {
                                const headers = object(signature.headers ?? {});
                                if (Object.keys(headers).some(k => !/^x-oss-/i.test(k) || typeof headers[k] !== 'string'))
                                    throw backupFailure('原文件请求无效');
                                return this.runtime.fetchImpl(String(signature.url), { method: 'GET', redirect: 'error', headers: headers as Record<string, string>, signal });
                            }, signal);
                            await store.putFile(relative, original);
                        }
                        await this.ranges.session(scope);
                        signal.throwIfAborted();
                        store.stage(job, item);
                        count++;
                        progress?.({ count });
                    }
                    for (const raw of page.removed_uids) {
                        if (typeof raw !== 'string' || seen.has(raw) || removed.has(raw))
                            throw backupFailure('删除清单无效');
                        removed.add(raw);
                        store.remove(job, raw);
                    }
                    if (typeof page.has_more !== 'boolean')
                        throw backupFailure('导出分页无效');
                    if (!page.has_more)
                        break;
                    const next = Number(page.next_index);
                    if (!Number.isSafeInteger(next) || next <= after)
                        throw backupFailure('导出分页不连续');
                    after = next;
                }
                if (count !== Number(start.record_count) || removed.size !== Number(start.removed_count))
                    throw backupFailure('导出内容不完整，请重试');
            }
            // Render against staged rows before changing the complete local replica.
            const output = await store.writeReadable(job, options.orderKind, 0, Number.MAX_SAFE_INTEGER, start ? requested.mode : undefined, selection.mode === 'dates' ? { start: selection.startDate!, end: selection.endDate!, timeZone: selection.timeZone } : undefined, signal);
            await this.ranges.session(scope);
            signal.throwIfAborted();
            const receipt = JSON.stringify({ schema: 1, scope, preview_uid: uid, document: basename(output.path), sha256: output.sha256, size: output.size, records: output.count, files_digest: output.filesDigest, attachment_bytes: output.attachmentBytes, files: output.files });
            const digest = createHash('sha256').update(receipt).digest('hex'), size = output.size + output.attachmentBytes + Buffer.byteLength(receipt);
            await atomicWrite(output.path + '.json', receipt);
            let meta = store.meta() ?? { scope, version: 0, attachments: selection.includeAttachments, savedAtMillis: 0 };
            const chainUid = await this.chainIdentity(scope, selection.includeAttachments);
            if (start) {
                const pending = { uid, digest, size, mode: requested.mode, chainUid, attachments: requested.includeAttachments, document: basename(output.path), documentHash: output.sha256, documentSize: output.size };
                if (requested.mode === 'dates') {
                    store.setMeta({ ...meta, pendingStart: undefined, pending });
                    store.discard(job);
                }
                else {
                    meta = { ...meta, attachments: selection.includeAttachments, chainUid, pendingStart: undefined, pending };
                    store.commit(job, requested.mode, meta);
                }
                finishAttempted = true;
                const finish = await this.ranges.post(scope, 'finish', { preview_uid: uid, success: true, artifact_sha256: digest, artifact_size: size }, signal);
                meta = { ...(store.meta() ?? meta), quotaPending: meta.quotaPending === true || finish.quota_finalized !== true };
                store.setMeta(meta);
                const saved = await this.ranges.post(scope, 'saved', { preview_uid: uid, artifact_sha256: digest, artifact_size: size, user_confirmed_saved: true }, signal);
                meta = requested.mode === 'dates' ? { ...meta, pending: undefined } : { ...meta, version: Number(saved.version), savedAtMillis: Number(saved.saved_at), pending: undefined };
                store.setMeta(meta);
                completed = true;
                return { accountScope: scope, kind: 'directory', directoryRef: options.destinationRef, fileRef: '', fileName: basename(output.path)!, size, expiresAtMillis: 0, count: output.count, quotaFinalized: !meta.quotaPending, rangeMode: selection.mode, savedAtMillis: meta.savedAtMillis };
            }
            completed = true;
            return { accountScope: scope, kind: 'directory', directoryRef: options.destinationRef, fileRef: '', fileName: basename(output.path)!, size, expiresAtMillis: 0, count: output.count, quotaFinalized: !meta.quotaPending, rangeMode: selection.mode, savedAtMillis: meta.savedAtMillis };
        }
        catch (error) {
            failed = true;
            if (uid && !finishAttempted) {
                await this.recoverStart(scope, store, AbortSignal.timeout(10000)).catch(() => { });
            }
            if (error instanceof ArkmePluginError)
                throw error;
            throw new ArkmePluginError('directory-export-failed', signal.aborted ? '导出已取消，已下载的原文件保留供重试。' : '导出未完成，已保留可复用的原文件，请重试。', true, 502);
        }
        finally {
            clearTimeout(timer);
            let cleanupError: unknown;
            try {
                if (!completed && !finishAttempted && store.isOpen)
                    store.discard(job);
            }
            catch (error) {
                cleanupError = error;
            }
            finally {
                try {
                    store.close();
                }
                catch (error) {
                    cleanupError ??= error;
                }
                finally {
                    this.previews.delete(options.previewUid);
                    this.controller = undefined;
                }
            }
            // Cleanup cannot mask a failure or strand the execution owner.
            if (cleanupError && !failed)
                throw new ArkmePluginError('directory-cleanup-failed', '备份已保存，但关闭本地索引失败，请重新打开导出页面。', true, 502);
        }
    }
}
