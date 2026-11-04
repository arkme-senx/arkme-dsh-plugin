import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { mkdir, open, rename, lstat, readFile, realpath, unlink, copyFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArkmePluginError } from './service.js';
export const backupFailure = (message: string) => new ArkmePluginError('backup-directory-invalid', message, false, 409);
export const object = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw backupFailure('备份数据无效');
    return value as Record<string, any>;
};
export async function regularFile(path: string): Promise<void> {
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink())
        throw backupFailure('备份文件不是普通文件，请重新选择文件夹');
}
export async function safeFolder(path: string): Promise<void> {
    await mkdir(path, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST')
            throw e;
    });
    const s = await lstat(path);
    if (!s.isDirectory() || s.isSymbolicLink())
        throw backupFailure('备份目录已变化，请重新选择文件夹');
}
export async function atomicWrite(path: string, value: string | Uint8Array): Promise<void> {
    const temp = path + '.' + randomUUID() + '.partial';
    const out = await open(temp, 'wx', 0o600);
    try {
        await out.writeFile(value);
        await out.sync();
        await out.close();
        await rename(temp, path);
    }
    finally {
        await out.close().catch(() => { });
        await unlink(temp).catch(() => { });
    }
}
export async function hashFile(path: string, signal?: AbortSignal): Promise<{
    size: number;
    sha256: string;
}> {
    await regularFile(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const hash = createHash('sha256');
    let size = 0;
    try {
        for await (const chunk of file.createReadStream({ autoClose: false })) {
            signal?.throwIfAborted();
            size += chunk.length;
            hash.update(chunk);
        }
    }
    finally {
        await file.close();
    }
    return { size, sha256: hash.digest('hex') };
}
export interface BackupFile {
    path: string;
    size: number;
    sha256: string;
}
export interface BackupMeta {
    scope: string;
    version: number;
    chainUid?: string;
    attachments: boolean;
    savedAtMillis: number;
    pending?: Record<string, any> | undefined;
}
/** The chosen folder is an output replica, not a path submitted by a browser.
 * Only fixed names under an attested real directory are used. */
export class BackupDirectoryStore {
    readonly root: string;
    private db: DatabaseSync | undefined;
    constructor(readonly parent: string, readonly scope: string) { this.root = join(parent, `即我备份-${scope.replace(':', '-')}`); }
    async open(create = false): Promise<boolean> {
        await safeFolder(this.parent);
        try {
            await lstat(this.root);
        }
        catch (e) {
            if (!create)
                return false;
            await safeFolder(this.root);
        }
        const info = await lstat(this.root);
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(this.root) !== this.root)
            throw backupFailure('备份目录已变化，请重新选择');
        const marker = join(this.root, '.arkme-backup.json');
        try {
            await regularFile(marker);
            const value = object(JSON.parse(await readFile(marker, 'utf8')));
            if (value.scope !== this.scope || value.schema !== 1)
                throw backupFailure('此文件夹不属于当前账号的即我备份');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
            if (!create)
                throw backupFailure('备份目录缺少身份清单');
            await atomicWrite(marker, JSON.stringify({ schema: 1, scope: this.scope }));
        }
        await safeFolder(join(this.root, 'pic'));
        await safeFolder(join(this.root, 'voice'));
        const file = join(this.root, '.arkme-backup.sqlite');
        try {
            await regularFile(file);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        // SQLite may open its journal sidecars as well as the main file.
        for (const sidecar of [file + '-wal', file + '-shm', file + '-journal']) {
            try {
                await regularFile(sidecar);
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw error;
            }
        }
        this.db = new DatabaseSync(file);
        await chmod(file, 0o600);
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records(uid TEXT PRIMARY KEY,send_at INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS record_date ON records(send_at,uid); CREATE TABLE IF NOT EXISTS staged(job TEXT NOT NULL,uid TEXT NOT NULL,send_at INTEGER NOT NULL,payload TEXT,PRIMARY KEY(job,uid)); CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,size INTEGER NOT NULL,sha256 TEXT NOT NULL);');
        return true;
    }
    close() { this.db?.close(); this.db = undefined; }
    meta(): BackupMeta | undefined { const row = this.db?.prepare('SELECT value FROM metadata WHERE id=1').get(); return row ? JSON.parse(String(row.value)) : undefined; }
    setMeta(meta: BackupMeta) {
        if (meta.scope !== this.scope)
            throw backupFailure('账号已切换');
        this.db!.prepare('INSERT INTO metadata VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(meta));
    }
    stage(job: string, item: Record<string, any>) { this.db!.prepare('INSERT INTO staged VALUES(?,?,?,?) ON CONFLICT(job,uid) DO UPDATE SET send_at=excluded.send_at,payload=excluded.payload').run(job, String(item.record_uid), Number(item.send_at), JSON.stringify(item)); }
    remove(job: string, uid: string) { this.db!.prepare('INSERT INTO staged VALUES(?,?,0,NULL) ON CONFLICT(job,uid) DO UPDATE SET payload=NULL').run(job, uid); }
    discard(job: string) { this.db!.prepare('DELETE FROM staged WHERE job=?').run(job); }
    file(path: string): BackupFile | undefined { const v = this.db!.prepare('SELECT path,size,sha256 FROM files WHERE path=?').get(path); return v ? { path: String(v.path), size: Number(v.size), sha256: String(v.sha256) } : undefined; }
    async filePath(relative: string): Promise<string> {
        if (!/^(pic|voice)\/[a-f0-9]{64}(\.[a-z0-9]{1,8})?$/.test(relative))
            throw backupFailure('备份附件路径无效');
        await safeFolder(join(this.root, relative.split('/')[0]!));
        return join(this.root, relative);
    }
    async putFile(relative: string, source: {
        path: string;
        size: number;
        sha256: string;
    }) {
        const destination = await this.filePath(relative), temp = destination + '.' + randomUUID() + '.partial';
        const known = this.file(relative);
        if (known) {
            try {
                const check = await hashFile(destination);
                if (check.size === source.size && check.sha256 === source.sha256)
                    return;
            }
            catch { }
        }
        await regularFile(source.path);
        await copyFile(source.path, temp, constants.COPYFILE_EXCL);
        try {
            const out = await open(temp, 'r+');
            try {
                await out.sync();
            }
            finally {
                await out.close();
            }
            ;
            const verified = await hashFile(temp);
            if (verified.size !== source.size || verified.sha256 !== source.sha256)
                throw backupFailure('本地附件校验失败');
            await rename(temp, destination);
        }
        finally {
            await unlink(temp).catch(() => { });
        }
        this.db!.prepare('INSERT INTO files VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET size=excluded.size,sha256=excluded.sha256').run(relative, source.size, source.sha256);
    }
    async reuseFile(relative: string, expected: number, signal?: AbortSignal) {
        const known = this.file(relative);
        if (!known)
            throw backupFailure('此文件夹缺少之前的备份附件，请选择原文件夹或重新建立完整备份');
        const actual = await hashFile(await this.filePath(relative), signal);
        if (actual.size !== known.size || actual.sha256 !== known.sha256 || expected > 0 && actual.size !== expected)
            throw backupFailure('已有备份附件缺失或被修改，请重新建立完整备份');
    }
    commit(job: string, mode: string, meta: BackupMeta) {
        const db = this.db!;
        db.exec('BEGIN IMMEDIATE');
        try {
            if (mode === 'all')
                db.exec('DELETE FROM records');
            db.prepare('DELETE FROM records WHERE uid IN (SELECT uid FROM staged WHERE job=? AND payload IS NULL)').run(job);
            db.prepare('INSERT INTO records SELECT uid,send_at,payload FROM staged WHERE job=? AND payload IS NOT NULL ON CONFLICT(uid) DO UPDATE SET send_at=excluded.send_at,payload=excluded.payload').run(job);
            this.setMeta(meta);
            db.prepare('DELETE FROM staged WHERE job=?').run(job);
            db.exec('COMMIT');
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    }
    count(from = 0, to = Number.MAX_SAFE_INTEGER) { return Number(this.db!.prepare('SELECT count(*) AS n FROM records WHERE send_at>=? AND send_at<?').get(from, to)!.n); }
    *records(order: 1 | 2, from = 0, to = Number.MAX_SAFE_INTEGER): Generator<Record<string, any>> {
        const direction = order === 1 ? 'DESC' : 'ASC';
        for (const row of this.db!.prepare(`SELECT payload FROM records WHERE send_at>=? AND send_at<? ORDER BY send_at ${direction},uid ${direction}`).iterate(from, to))
            yield JSON.parse(String(row.payload));
    }
    statistics(dates?: {
        start: string;
        end: string;
        timeZone: string;
    }) {
        const formatter = dates ? new Intl.DateTimeFormat('en-CA', { timeZone: dates.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }) : undefined;
        let recordCount = 0, imageCount = 0, voiceCount = 0;
        for (const item of this.records(1)) {
            if (formatter && dates) {
                const parts = formatter.formatToParts(Number(item.send_at));
                const date = ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)?.value).join('-');
                if (date < dates.start || date > dates.end)
                    continue;
            }
            recordCount++;
            for (const raw of item.file_refs ?? []) {
                const file = object(raw);
                if (file.file_kind === 1)
                    imageCount++;
                if (file.file_kind === 2)
                    voiceCount++;
            }
        }
        return { recordCount, imageCount, voiceCount };
    }
    async writeReadable(job: string, order: 1 | 2, from = 0, to = Number.MAX_SAFE_INTEGER, mode?: string, dates?: {
        start: string;
        end: string;
        timeZone: string;
    }, signal?: AbortSignal): Promise<{
        path: string;
        size: number;
        sha256: string;
        count: number;
        attachmentBytes: number;
        filesDigest: string;
        files: BackupFile[];
    }> {
        const relative = `导出-${new Date().toISOString().replace(/[:.]/g, '-')}-${job.slice(-8)}.md`, path = join(this.root, relative), temp = path + '.partial', out = await open(temp, 'wx', 0o600), hash = createHash('sha256');
        let size = 0, count = 0, attachmentBytes = 0;
        const files: BackupFile[] = [];
        const seenFiles = new Set<string>(), filesHash = createHash('sha256'), dateFormat = dates ? new Intl.DateTimeFormat('en-CA', { timeZone: dates.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }) : undefined;
        const direction = order === 1 ? 'DESC' : 'ASC';
        const statement = mode ? this.db!.prepare(mode === 'incremental' ? `SELECT uid,send_at,payload FROM records WHERE uid NOT IN (SELECT uid FROM staged WHERE job=?) UNION ALL SELECT uid,send_at,payload FROM staged WHERE job=? AND payload IS NOT NULL ORDER BY send_at ${direction},uid ${direction}` : `SELECT uid,send_at,payload FROM staged WHERE job=? AND payload IS NOT NULL ORDER BY send_at ${direction},uid ${direction}`) : undefined;
        const staged = statement ? (mode === 'incremental' ? statement.iterate(job, job) : statement.iterate(job)) : undefined;
        const values = staged ? (function* () {
            for (const row of staged)
                yield JSON.parse(String(row.payload));
        })() : this.records(order, from, to);
        try {
            const header = Buffer.from('# 即我备份\n\n');
            await out.writeFile(header);
            hash.update(header);
            size += header.length;
            for (const item of values) {
                signal?.throwIfAborted();
                if (dateFormat && dates) {
                    const parts = dateFormat.formatToParts(Number(item.send_at));
                    const date = ['year', 'month', 'day'].map(kind => parts.find(p => p.type === kind)?.value).join('-');
                    if (date < dates.start || date > dates.end)
                        continue;
                }
                for (const raw of item.file_refs ?? []) {
                    const f = object(raw), relative = String(f.backup_path);
                    if (!seenFiles.has(relative)) {
                        await this.reuseFile(relative, Number(f.size), signal);
                        const saved = this.file(relative)!;
                        attachmentBytes += saved.size;
                        filesHash.update(JSON.stringify(saved));
                        files.push(saved);
                        seenFiles.add(relative);
                    }
                }
                let text = `## ${new Date(Number(item.send_at)).toLocaleString()}\n\n` + [item.title, item.text].filter(Boolean).join('\n\n') + '\n\n';
                for (const raw of item.file_refs ?? []) {
                    const f = object(raw);
                    text += Number(f.file_kind) === 2 ? `[语音](./${String(f.backup_path)})\n` : `![图片](./${String(f.backup_path)})\n`;
                }
                ;
                text += '\n';
                const chunk = Buffer.from(text);
                await out.writeFile(chunk);
                hash.update(chunk);
                signal?.throwIfAborted();
                size += chunk.length;
                count++;
            }
            await out.sync();
        }
        finally {
            await out.close();
        }
        await rename(temp, path);
        return { path, size, sha256: hash.digest('hex'), count, attachmentBytes, filesDigest: filesHash.digest('hex'), files };
    }
}
