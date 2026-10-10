import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, unlink, link } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify, getSystemErrorName } from 'node:util';
import semver from 'semver';
import type { MigrationSnapshot, MigrationTarget } from './app-migration-shared.js';
import { validatePluginUpdateServiceOrigin } from './plugin-update-artifact.js';
const run = promisify(execFile);
export function migrationEligible(version: string, local: boolean, platform: string, arch: string): boolean {
    return local && semver.valid(version) !== null && semver.major(version) < 3
        && ((platform === 'darwin' && ['arm64', 'x64'].includes(arch)) || (platform === 'win32' && arch === 'x64'));
}
export function migrationStateRoot(dshHome: string, environment: string): string {
    let root = dirname(dshHome);
    if (basename(dirname(root)) === 'dsh-containers')
        root = dirname(dirname(root));
    return join(root, 'app-migration', environment);
}
export async function systemDownloadsDirectory(platform = process.platform): Promise<string> {
    if (platform === 'darwin')
        return join(homedir(), 'Downloads');
    if (platform !== 'win32')
        throw new Error('当前平台不支持安装包下载');
    // Windows Known Folder registry supports redirected/localized Downloads folders.
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$p=(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}'; if (-not $p) { exit 1 }; [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write([Environment]::ExpandEnvironmentVariables($p))"], { windowsHide: true, timeout: 10000 });
    const path = stdout.trim();
    if (!isAbsolute(path))
        throw new Error('无法读取系统下载目录');
    return path;
}
export async function revealMigrationFile(path: string, platform = process.platform): Promise<void> {
    if (platform === 'darwin') {
        await run('/usr/bin/open', ['-R', path], { timeout: 10000 });
        return;
    }
    if (platform === 'win32') {
        // Explorer owns a visible, long-lived window. Do not hide it or wait for
        // process exit (nor kill it on a command timeout).
        await new Promise<void>((resolve, reject) => {
            const child = spawn('explorer.exe', [`/select,${path}`], {
                windowsHide: false, detached: true, stdio: 'ignore',
            });
            child.once('error', reject);
            child.once('spawn', () => { child.unref(); resolve(); });
        });
        return;
    }
    throw new Error('当前平台无法定位文件');
}
export async function openMigrationInstaller(path: string, platform = process.platform): Promise<void> {
    if (platform === 'darwin') {
        await run('/usr/bin/open', [path], { timeout: 10000 });
        return;
    }
    if (platform === 'win32') {
        // Use the Windows shell so elevation and the normal installer UI work.
        // The installer outlives this helper; never wait for or silently run setup.
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $env:ARKME_MIGRATION_INSTALLER_PATH
$start.WorkingDirectory = [IO.Path]::GetDirectoryName($start.FileName)
$start.UseShellExecute = $true
$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Normal
[Diagnostics.Process]::Start($start) | Out-Null
`], { windowsHide: true, timeout: 120000, env: { ...process.env, ARKME_MIGRATION_INSTALLER_PATH: path } });
        return;
    }
    throw new Error('当前平台无法打开安装包');
}
interface Options {
    enabled: boolean;
    currentVersion: string;
    platform: string;
    architecture: string;
    stateDirectory: string;
    serviceOrigin: string;
    artifactOrigin: string;
    downloadsDirectory?: () => Promise<string>;
    reveal?: (path: string) => Promise<void>;
    install?: (path: string) => Promise<void>;
    fetch?: typeof fetch;
    now?: () => number;
}
interface Stored {
    schema: 1;
    day?: string;
    dismissedDay?: string;
    lastFailure?: number;
    target?: MigrationTarget;
    completed?: {
        path: string;
        jobId: string;
        size?: number;
    };
    temporary?: string;
    prompt?: boolean;
}
function day(ms: number): string { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export class AppMigrationManager {
    private snapshot: MigrationSnapshot;
    private stored: Stored = { schema: 1 };
    private ready: Promise<void> | undefined;
    private tail: Promise<unknown> = Promise.resolve();
    private running: Promise<void> | undefined;
    private abort: AbortController | undefined;
    private installing: Promise<MigrationSnapshot> | undefined;
    private disposed = false;
    private saveTail: Promise<void> = Promise.resolve();
    private readonly enabled: boolean;
    private readonly now: () => number;
    private readonly fetcher: typeof fetch;
    private readonly origin: string;
    private readonly artifactOrigin: string;
    constructor(private readonly options: Options) {
        this.enabled = migrationEligible(options.currentVersion, options.enabled, options.platform, options.architecture);
        this.snapshot = { phase: this.enabled ? 'idle' : 'disabled', currentVersion: options.currentVersion, downloadedBytes: 0, prompt: false };
        this.now = options.now ?? Date.now;
        this.fetcher = options.fetch ?? fetch;
        this.origin = validatePluginUpdateServiceOrigin(options.serviceOrigin);
        this.artifactOrigin = validatePluginUpdateServiceOrigin(options.artifactOrigin);
    }
    private exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const p = this.tail.then(operation);
        this.tail = p.catch(() => undefined);
        return p;
    }
    private get statePath(): string { return join(this.options.stateDirectory, 'state.json'); }
    private save(): Promise<void> {
        const content = JSON.stringify(this.stored);
        const pending = this.saveTail.catch(() => undefined).then(async () => {
            await mkdir(this.options.stateDirectory, { recursive: true, mode: 0o700 });
            const temp = join(this.options.stateDirectory, `${randomUUID()}.json.tmp`);
            try {
                await writeState(temp, content);
                await rename(temp, this.statePath);
            }
            finally {
                await unlink(temp).catch(() => undefined);
            }
        });
        this.saveTail = pending;
        return pending;
    }
    private safeURL(raw: string, origin: string): URL {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.hash)
            throw new Error('安装包地址或重定向不属于可信下载源');
        return url;
    }
    private target(value: unknown): MigrationTarget | undefined {
        if (!value || typeof value !== 'object')
            return undefined;
        const r = value as Record<string, unknown>;
        if (typeof r.version !== 'string' || !semver.valid(r.version) || semver.major(r.version) < 3 || semver.prerelease(r.version) !== null
            || !Number.isSafeInteger(r.versionCode) || Number(r.versionCode) <= 0 || typeof r.downloadUrl !== 'string')
            return undefined;
        const url = this.safeURL(r.downloadUrl, this.artifactOrigin);
        const kind = this.options.platform === 'darwin' ? 'pkg' : 'exe';
        if (!decodeURIComponent(url.pathname).toLowerCase().endsWith(`.${kind}`))
            return undefined;
        return { version: r.version, versionCode: Number(r.versionCode), downloadUrl: r.downloadUrl, kind };
    }
    private async initialize(): Promise<void> {
        if (!this.enabled)
            return;
        try {
            const raw = JSON.parse(await readFile(this.statePath, 'utf8')) as Stored;
            if (raw.schema !== 1)
                throw new Error('不支持的下载状态格式');
            this.stored = raw;
            const t = raw.target;
            const validated = t && this.target(t);
            // Existing downloads recorded the size on the old target instead.
            const legacySize = (t as (MigrationTarget & { size?: number }) | undefined)?.size;
            if (raw.completed && raw.completed.size === undefined && Number.isSafeInteger(legacySize) && legacySize! > 0)
                raw.completed.size = legacySize!;
            if (validated) this.stored.target = validated;
            if (!validated) {
                delete this.stored.target;
                delete this.stored.completed;
            }
            if (raw.temporary) {
                const dir = await (this.options.downloadsDirectory ?? systemDownloadsDirectory)();
                if (dirname(raw.temporary) === dir && /^\.jiwo-migration-[a-f0-9-]+\.part$/.test(basename(raw.temporary)))
                    await unlink(raw.temporary).catch(() => undefined);
                delete this.stored.temporary;
            }
            if (validated) {
                this.snapshot = { ...this.snapshot, phase: 'available', target: validated, prompt: raw.prompt === true && raw.dismissedDay !== day(this.now()) };
                if (raw.completed && await this.validCompleted(raw.completed.path)) {
                    this.snapshot = { ...this.snapshot, phase: 'completed', jobId: raw.completed.jobId, downloadedBytes: raw.completed.size!, totalBytes: raw.completed.size!, fileName: basename(raw.completed.path), prompt: raw.prompt === true };
                }
                else
                    delete this.stored.completed;
            }
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                this.stored = { schema: 1 };
        }
    }
    private async init(): Promise<void> { await (this.ready ??= this.initialize()); }
    private async validCompleted(path: string): Promise<boolean> {
        try {
            if (dirname(path) !== await (this.options.downloadsDirectory ?? systemDownloadsDirectory)())
                return false;
            const expectedSize = this.stored.completed?.size;
            if (!Number.isSafeInteger(expectedSize) || expectedSize! <= 0) return false;
            const st = await lstat(path);
            if (!st.isFile() || st.isSymbolicLink() || st.size !== expectedSize)
                return false;
            const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const st = await file.stat();
                return st.isFile() && st.size === expectedSize;
            }
            finally {
                await file.close();
            }
        }
        catch {
            return false;
        }
    }
    async status(): Promise<MigrationSnapshot> { await this.init(); return structuredClone(this.snapshot); }
    async check(manual = false): Promise<MigrationSnapshot> {
        return this.exclusive(async () => {
            await this.init();
            if (!this.enabled || this.disposed || this.running)
                return this.status();
            // Focus/startup checks validate the cached installer before reporting it
            // as ready, even when today's network check has already completed.
            if (this.stored.completed && this.stored.target
                && !await this.validCompleted(this.stored.completed.path)) {
                delete this.stored.completed;
                this.snapshot = { phase: 'available', currentVersion: this.options.currentVersion,
                    target: this.stored.target, downloadedBytes: 0, prompt: false };
                this.stored.prompt = false;
                await this.save();
            }
            const today = day(this.now());
            if (!manual && (this.stored.day === today || (this.stored.lastFailure !== undefined && this.now() - this.stored.lastFailure < 15 * 60000)))
                return this.status();
            const before = this.snapshot;
            this.snapshot = { ...before, phase: 'checking', prompt: false };
            try {
                const architecture = this.options.platform === 'darwin' ? 'arm64' : this.options.architecture;
                const url = new URL(`/api/public/v1/arkme/app-update/${this.options.platform}/${architecture}/latest`, this.origin);
                const response = await this.request(url.toString(), this.origin, AbortSignal.timeout(20000));
                let target: MigrationTarget | undefined;
                if (response.status !== 404) {
                    if (!response.ok)
                        throw new Error(`检查更新失败（HTTP ${response.status}）`);
                    target = this.target(await response.json());
                }
                this.stored.day = today;
                delete this.stored.lastFailure;
                if (target) {
                    const same = JSON.stringify(target) === JSON.stringify(this.stored.target);
                    this.stored.target = target;
                    if (!same)
                        delete this.stored.completed;
                    this.snapshot = { phase: 'available', currentVersion: this.options.currentVersion, target, downloadedBytes: 0, prompt: manual || this.stored.dismissedDay !== today };
                    if (same && this.stored.completed && await this.validCompleted(this.stored.completed.path))
                        this.snapshot = { ...this.snapshot, phase: 'completed', jobId: this.stored.completed.jobId, downloadedBytes: this.stored.completed.size!, totalBytes: this.stored.completed.size!, fileName: basename(this.stored.completed.path) };
                }
                else {
                    this.snapshot = { phase: 'idle', currentVersion: this.options.currentVersion, downloadedBytes: 0, prompt: false };
                    delete this.stored.target;
                    delete this.stored.completed;
                }
                this.stored.prompt = this.snapshot.prompt;
                await this.save();
            }
            catch (error) {
                this.stored.lastFailure = this.now();
                this.snapshot = { ...before, error: message(error), prompt: manual, phase: manual ? 'failed' : before.phase };
                await this.save();
            }
            return this.status();
        });
    }
    private async request(raw: string, origin: string, signal: AbortSignal): Promise<Response> {
        let url = this.safeURL(raw, origin);
        for (let hop = 0; hop < 6; hop++) {
            signal.throwIfAborted();
            const r = await this.fetcher(url, { redirect: 'manual', signal });
            if (![301, 302, 303, 307, 308].includes(r.status))
                return r;
            await r.body?.cancel();
            const location = r.headers.get('location');
            if (!location)
                throw new Error('下载重定向缺少地址');
            url = this.safeURL(new URL(location, url).toString(), origin);
        }
        throw new Error('下载重定向次数过多');
    }
    async download(): Promise<MigrationSnapshot> {
        return this.exclusive(async () => {
            await this.init();
            if (!this.enabled || this.disposed)
                throw new Error('当前客户端不支持迁移下载');
            if (this.running)
                return this.status();
            const target = this.stored.target;
            if (!target)
                throw new Error('暂无可下载的安装包，请重新检查更新');
            const reusable = this.stored.completed && await this.validCompleted(this.stored.completed.path);
            // Disposal can happen during cache validation, before a transfer owns
            // an AbortController. Do not let that old instance resume download work.
            if (this.disposed)
                throw new Error('迁移下载管理器已停止');
            if (reusable) {
                this.snapshot = { ...this.snapshot, phase: 'completed', prompt: true };
                return this.status();
            }
            delete this.stored.completed;
            const id = randomUUID();
            const abort = new AbortController();
            this.abort = abort;
            this.snapshot = { phase: 'downloading', currentVersion: this.options.currentVersion, target, jobId: id, downloadedBytes: 0, prompt: true };
            this.stored.prompt = true;
            this.running = this.transfer(target, id, abort.signal).finally(() => { this.running = undefined; this.abort = undefined; });
            return this.status();
        });
    }
    private async transfer(target: MigrationTarget, id: string, signal: AbortSignal): Promise<void> {
        let temporary: string | undefined;
        try {
            const directory = await (this.options.downloadsDirectory ?? systemDownloadsDirectory)();
            await mkdir(directory, { recursive: true });
            temporary = join(directory, `.jiwo-migration-${id}.part`);
            this.stored.temporary = temporary;
            await this.save();
            const file = await open(temporary, 'wx', 0o600);
            let count = 0;
            let total: number | undefined;
            try {
                const response = await this.request(target.downloadUrl, this.artifactOrigin, AbortSignal.any([signal, AbortSignal.timeout(2 * 60 * 60 * 1000)]));
                if (response.status !== 200 || !response.body)
                    throw new Error(`下载失败（HTTP ${response.status}）`);
                const length = response.headers.get('content-length');
                const encoding = response.headers.get('content-encoding');
                if (length !== null && (!encoding || encoding === 'identity')) {
                    total = Number(length);
                    if (!/^\d+$/.test(length) || !Number.isSafeInteger(total) || total <= 0 || total > 16 * 1024 ** 3) {
                        await response.body.cancel();
                        throw new Error('安装包下载大小无效');
                    }
                }
                this.snapshot = { ...this.snapshot, ...(total === undefined ? {} : { totalBytes: total }) };
                for await (const chunk of response.body) {
                    signal.throwIfAborted();
                    count += chunk.byteLength;
                    if (count > 16 * 1024 ** 3 || (total !== undefined && count > total))
                        throw new Error('安装包下载大小超出限制');
                    await file.writeFile(chunk);
                    this.snapshot = { ...this.snapshot, downloadedBytes: count };
                }
                if (count === 0 || (total !== undefined && count !== total))
                    throw new Error('安装包下载不完整，请重试');
                await file.sync();
            }
            finally {
                await file.close();
            }
            signal.throwIfAborted();
            let destination = '';
            for (let index = 0; index < 1000; index++) {
                destination = join(directory, `即我-${target.version}-vc${target.versionCode}${index === 0 ? '' : ` (${index})`}.${target.kind}`);
                // Atomic publication without overwriting an existing name (rename would overwrite on Unix).
                try {
                    await publishMigrationFile(temporary, destination);
                    break;
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || index === 999)
                        throw error;
                }
            }
            temporary = undefined;
            delete this.stored.temporary;
            this.stored.completed = { path: destination, jobId: id, size: count };
            this.stored.prompt = true;
            await this.save();
            this.snapshot = { ...this.snapshot, phase: 'completed', fileName: basename(destination), totalBytes: count, prompt: true };
        }
        catch (error) {
            if (temporary)
                await unlink(temporary).catch(() => undefined);
            delete this.stored.temporary;
            this.snapshot = { ...this.snapshot, phase: signal.aborted ? 'available' : 'failed', prompt: !signal.aborted, ...(signal.aborted ? {} : { error: message(error) }) };
            this.stored.prompt = this.snapshot.prompt;
            await this.save().catch(() => undefined);
        }
    }
    async cancel(jobId?: string): Promise<MigrationSnapshot> {
        await this.init();
        if (jobId !== this.snapshot.jobId)
            throw new Error('下载任务已变化');
        this.abort?.abort();
        await this.running;
        return this.status();
    }
    async dismiss(): Promise<MigrationSnapshot> {
        return this.exclusive(async () => { await this.init(); this.snapshot = { ...this.snapshot, prompt: false }; this.stored.prompt = false; this.stored.dismissedDay = day(this.now()); if (this.enabled)
            await this.save(); return this.status(); });
    }
    private async completedFile(jobId?: string): Promise<string> {
        await this.init();
        if (!this.enabled || this.disposed) throw new Error('迁移下载管理器已停止');
        const completed = this.stored.completed, target = this.stored.target;
        if (!completed || !target || jobId !== completed.jobId)
            throw new Error('下载任务已变化，请刷新状态');
        if (!completed.path.toLowerCase().endsWith(`.${target.kind}`) || !await this.validCompleted(completed.path)) {
            delete this.stored.completed;
            this.snapshot = { ...this.snapshot, phase: 'failed', prompt: true, error: '安装包已丢失或被修改，请重新下载' };
            await this.save();
            throw new Error(this.snapshot.error);
        }
        return completed.path;
    }
    async reveal(jobId?: string): Promise<MigrationSnapshot> {
        const path = await this.completedFile(jobId);
        await (this.options.reveal ?? revealMigrationFile)(path);
        return this.status();
    }
    async install(jobId?: string): Promise<MigrationSnapshot> {
        await this.init();
        if (!jobId || jobId !== this.stored.completed?.jobId) throw new Error('下载任务已变化，请刷新状态');
        if (this.installing) return this.installing;
        this.installing = (async () => {
            const path = await this.completedFile(jobId);
            await (this.options.install ?? openMigrationInstaller)(path);
            return this.status();
        })().finally(() => { this.installing = undefined; });
        return this.installing;
    }
    async dispose(): Promise<void> { this.disposed = true; this.abort?.abort(); await this.running; }
}
async function writeState(path: string, content: string): Promise<void> { const file = await open(path, 'wx', 0o600); try {
    await file.writeFile(content);
    await file.sync();
}
finally {
    await file.close();
} }
// File.Move on Windows publishes atomically without replacement, including FAT/exFAT
// Downloads redirects. macOS Downloads may deny hard links even when renames are
// allowed. Use the OS exclusive rename through its built-in JXA bridge; no compiler,
// Python runtime, or shell interpolation is required on the user's machine.
export async function publishMigrationFile(source: string, destination: string): Promise<void> {
    if (process.platform === 'darwin') {
        const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
function run(argv) {
    ObjC.bindFunction('renamex_np', ['int', ['char *', 'char *', 'unsigned int']]);
    ObjC.bindFunction('__error', ['int *', []]);
    // RENAME_EXCL fails atomically if the destination already exists, including a symlink.
    return $.renamex_np(argv[0], argv[1], 0x00000004) === 0 ? 0 : $.__error()[0];
}`, source, destination], { timeout: 10000 });
        const errno = Number(stdout.trim());
        if (!Number.isInteger(errno) || errno < 0 || stdout.trim() === '')
            throw new Error('无法确认安装包保存结果');
        if (errno !== 0) {
            const code = getSystemErrorName(-errno);
            throw Object.assign(new Error(`安装包保存失败（${code}）`), { code });
        }
        return;
    }
    if (process.platform !== 'win32') {
        await link(source, destination);
        await unlink(source);
        return;
    }
    try {
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "$ErrorActionPreference='Stop'; try { [IO.File]::Move($env:JIWO_MIGRATION_TEMP,$env:JIWO_MIGRATION_FINAL) } catch [IO.IOException] { if ([IO.File]::Exists($env:JIWO_MIGRATION_FINAL)) { exit 80 }; throw }"], { windowsHide: true, timeout: 10000, env: { ...process.env, JIWO_MIGRATION_TEMP: source, JIWO_MIGRATION_FINAL: destination } });
    }
    catch (error) {
        if ((error as {
            code?: number;
        }).code === 80)
            throw Object.assign(new Error('File exists'), { code: 'EEXIST' });
        throw error;
    }
}
