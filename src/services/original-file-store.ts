import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, lstat, statfs, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { ArkmePluginError, type ServiceRuntime } from './service.js';
const reservedBytes = new Map<string, number>();
export const ORIGINAL_MAX_BYTES = 64 * 1024 ** 3;
const validKey = /^[a-f0-9]{64}$/;
export interface OriginalFile {
    path: string;
    size: number;
    sha256: string;
}
/** Identity excludes expiring signatures, and never conflates a thumbnail with
 * an original. The signed URL itself is not persisted. */
export function originalFileKey(environment: string, user: number, input: URL): string | undefined {
    const suffix = environment === 'prod' ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc', 'jotmo-useraudio.oss-cn-hangzhou.aliyuncs.com'] : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me', 'jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com'];
    if (!suffix.includes(input.hostname) || input.protocol !== 'https:' || input.username || input.password || input.port || input.hash || input.searchParams.has('x-oss-process'))
        return undefined;
    const bucket = input.hostname.includes('useraudio') ? 'audio' : 'files';
    return createHash('sha256').update(`${environment}:${user}:${bucket}:${input.pathname}`).digest('hex');
}
/** Shared, account-isolated originals used by normal media reads and export.
 * A file is visible only after EOF, length verification, fsync and atomic rename. */
export class OriginalFileStore {
    private readonly verified = new Map<string, {
        mtime: number;
        size: number;
        sha256: string;
    }>();
    private readonly root: string;
    constructor(private readonly runtime: ServiceRuntime) { this.root = join(runtime.config.fileStateDirectory ?? join(homedir(), '.arkme'), 'originals-v1', runtime.config.environment ?? 'unconfigured'); }
    private folder(user: number) {
        if (!Number.isSafeInteger(user) || user <= 0)
            throw new Error('invalid original owner');
        return join(this.root, String(user));
    }
    async read(user: number, key: string, expected = 0): Promise<OriginalFile | undefined> {
        if (!validKey.test(key))
            return undefined;
        const dir = this.folder(user), path = join(dir, `${key}.blob`);
        try {
            const info = await lstat(path);
            if (!info.isFile() || expected > 0 && info.size !== expected)
                return undefined;
            const meta = JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8'));
            if (meta.size !== info.size || !validKey.test(meta.sha256))
                return undefined;
            const verificationKey = `${user}:${key}`, prior = this.verified.get(verificationKey);
            if (prior?.mtime === info.mtimeMs && prior.size === info.size && prior.sha256 === meta.sha256)
                return { path, size: info.size, sha256: meta.sha256 };
            const digest = createHash('sha256');
            const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                for await (const chunk of file.createReadStream({ autoClose: false }))
                    digest.update(chunk);
            }
            finally {
                await file.close();
            }
            if (digest.digest('hex') !== meta.sha256)
                return undefined;
            this.verified.set(verificationKey, { mtime: info.mtimeMs, size: info.size, sha256: meta.sha256 });
            return { path, size: info.size, sha256: meta.sha256 };
        }
        catch {
            return undefined;
        }
    }
    private async trim(directory: string, incoming: number, keep: string) {
        const rows: Array<{
            path: string;
            key: string;
            size: number;
            at: number;
        }> = [];
        let total = 0;
        for (const name of await readdir(directory)) {
            if (!/^[a-f0-9]{64}\.blob$/.test(name))
                continue;
            const path = join(directory, name), stat = await lstat(path);
            if (!stat.isFile())
                continue;
            total += stat.size;
            rows.push({ path, key: name.slice(0, 64), size: stat.size, at: stat.mtimeMs });
        }
        rows.sort((a, b) => a.at - b.at);
        for (const row of rows) {
            if (total + incoming <= ORIGINAL_MAX_BYTES)
                break;
            if (row.key === keep)
                continue;
            try {
                await unlink(row.path);
                await unlink(join(directory, row.key + '.json')).catch(() => { });
                total -= row.size;
            }
            catch { }
        }
        if (total + incoming > ORIGINAL_MAX_BYTES)
            throw new Error('original cache capacity reached');
    }
    response(file: OriginalFile, mime: string): Response {
        return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>, { headers: { 'Content-Type': mime, 'Content-Length': String(file.size) } });
    }
    async capture(user: number, key: string, response: Response, expected: number, signal?: AbortSignal): Promise<Response> {
        if (!validKey.test(key) || response.status !== 200 || !response.body || response.headers.has('content-range'))
            return response;
        const dir = this.folder(user);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const space = await statfs(dir);
        const declared = Number(response.headers.get('content-length')) || expected;
        if (declared > ORIGINAL_MAX_BYTES || space.bavail * space.bsize < Math.max(declared, 64 * 1024 * 1024))
            return response;
        if (declared <= 0)
            return response;
        for (;;) {
            const prior = reservedBytes.get(dir) ?? 0;
            await this.trim(dir, declared + prior, key);
            if ((reservedBytes.get(dir) ?? 0) === prior) {
                reservedBytes.set(dir, prior + declared);
                break;
            }
        }
        let reservation = true;
        const release = () => { if (!reservation)
            return; reservation = false; const remaining = (reservedBytes.get(dir) ?? declared) - declared; if (remaining > 0)
            reservedBytes.set(dir, remaining);
        else
            reservedBytes.delete(dir); };
        const partial = join(dir, `${key}.${randomUUID()}.partial`), file = await open(partial, 'wx', 0o600).catch(error => { release(); throw error; });
        const reader = response.body.getReader(), hash = createHash('sha256');
        let size = 0, closed = false, caching = true;
        let tempMeta: string | undefined;
        const discard = async () => { release(); if (!closed) {
            closed = true;
            await file.close().catch(() => { });
        } await unlink(partial).catch(() => { }); if (tempMeta)
            await unlink(tempMeta).catch(() => { }); };
        const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    signal?.throwIfAborted();
                    const part = await reader.read();
                    if (!part.done) {
                        size += part.value.byteLength;
                        if (size > ORIGINAL_MAX_BYTES || declared > 0 && size > declared || expected > 0 && size > expected)
                            throw new Error('incomplete original');
                        if (caching) {
                            try {
                                await file.writeFile(part.value);
                                hash.update(part.value);
                            }
                            catch {
                                caching = false;
                                await discard();
                            }
                        }
                        controller.enqueue(part.value);
                        return;
                    }
                    if (!size || declared > 0 && size !== declared || expected > 0 && size !== expected)
                        throw new Error('incomplete original');
                    if (!caching) {
                        controller.close();
                        return;
                    }
                    try {
                        await file.sync();
                        await file.close();
                        closed = true;
                        const path = join(dir, `${key}.blob`), meta = join(dir, `${key}.json`);
                        tempMeta = meta + '.' + randomUUID() + '.partial';
                        const m = await open(tempMeta, 'wx', 0o600);
                        try {
                            await m.writeFile(JSON.stringify({ size, sha256: hash.digest('hex') }));
                            await m.sync();
                        }
                        finally {
                            await m.close();
                        }
                        await rename(partial, path);
                        await rename(tempMeta, meta);
                    }
                    catch {
                        // Ordinary media reads must not fail because an optional
                        // cache write hit ENOSPC or the filesystem disappeared.
                        await discard();
                    }
                    release();
                    controller.close();
                }
                catch (error) {
                    await reader.cancel().catch(() => { });
                    await discard();
                    controller.error(error);
                }
            },
            async cancel() { await reader.cancel().catch(() => { }); await discard(); },
        });
        return new Response(stream, { status: response.status, headers: response.headers });
    }
    async obtain(user: number, url: URL, expected: number, fetchOriginal: () => Promise<Response>, signal?: AbortSignal): Promise<OriginalFile> {
        const key = originalFileKey(this.runtime.config.environment, user, url);
        if (!key)
            throw new ArkmePluginError('original-source-invalid', '原文件来源无效', false, 400);
        const existing = await this.read(user, key, expected);
        if (existing)
            return existing;
        const remote = await fetchOriginal();
        if (!remote.ok || !remote.body)
            throw new ArkmePluginError('original-download-failed', '原文件下载失败，请重试', true, 502);
        const captured = await this.capture(user, key, remote, expected, signal);
        if (captured === remote) {
            await remote.body.cancel();
            throw new ArkmePluginError('original-space-insufficient', '本地空间不足，无法完整保存原文件', false, 413);
        }
        for await (const _ of captured.body as unknown as AsyncIterable<Uint8Array>) {
            signal?.throwIfAborted();
        }
        const saved = await this.read(user, key, expected);
        if (!saved)
            throw new ArkmePluginError('original-incomplete', '原文件校验失败，请重试', true, 502);
        return saved;
    }
}
