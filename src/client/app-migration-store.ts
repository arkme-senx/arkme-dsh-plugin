import type { MigrationSnapshot } from '../app-migration-shared.js';
import { callArkme } from './api.js';
import semverValid from 'semver/functions/valid.js';
import semverMajor from 'semver/functions/major.js';
export type MigrationOperation = 'app.migration.status' | 'app.migration.check' | 'app.migration.download' | 'app.migration.cancel' | 'app.migration.install' | 'app.migration.reveal' | 'app.migration.dismiss';
type Call = (operation: MigrationOperation, params?: Record<string, unknown>) => Promise<MigrationSnapshot>;
interface View {
    status?: MigrationSnapshot;
    visible: boolean;
    busy: boolean;
    error: string;
}
export function localMigrationDesktop(): boolean {
    const scope = globalThis as unknown as {
        arkmeDesktop?: {
            appVersion?: string;
        };
        location?: Location;
    };
    const version = scope.arkmeDesktop?.appVersion;
    return typeof version === 'string' && semverValid(version) !== null && semverMajor(version) < 3
        && ['localhost', '127.0.0.1', '[::1]'].includes(scope.location?.hostname ?? '');
}
export class AppMigrationStore {
    private value: View = { visible: false, busy: false, error: '' };
    private listeners = new Set<() => void>();
    private pending: Promise<void> | undefined;
    private timer: ReturnType<typeof setInterval> | undefined;
    private suppressed = false;
    private dismissalRevision = 0;
    private stopped = false;
    private wasForeground = false;
    constructor(private readonly call: Call = callArkme, private readonly eligible = localMigrationDesktop, private readonly foreground = () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()) { }
    getSnapshot = (): View => this.value;
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    private set(value: View): void { this.value = value; for (const listener of this.listeners)
        listener(); }
    private accept(status: MigrationSnapshot, force = false): void {
        const completion = status.phase === 'completed' && this.value.status?.phase !== 'completed';
        if (completion)
            this.suppressed = false;
        const mayOpen = status.prompt && !this.suppressed && ['available', 'completed', 'failed'].includes(status.phase);
        const visible = this.foreground() && (force || this.value.visible || mayOpen) && status.phase !== 'disabled' && status.phase !== 'idle';
        const newlyShown = visible && (!this.value.visible || completion);
        this.set({ ...this.value, status, error: '', visible });
        if (newlyShown && status.prompt && ['available', 'completed', 'failed'].includes(status.phase)) {
            void this.call('app.migration.dismiss').catch(() => undefined);
        }
    }
    async refresh(check = false, manual = false): Promise<void> {
        if (!this.eligible() || this.stopped)
            return;
        if (this.pending) {
            const revision = this.dismissalRevision;
            await this.pending;
            if (manual || (check && revision === this.dismissalRevision && this.foreground()))
                return this.refresh(check, manual);
            return;
        }
        const dismissalRevision = this.dismissalRevision;
        this.pending = (async () => {
            try {
                const status = await this.call(check ? 'app.migration.check' : 'app.migration.status', check ? { manual } : undefined);
                if (!this.stopped) {
                    // The Host owns the persisted daily reminder policy. Only a fresh
                    // check may lift suppression, never one overtaken by a dismissal.
                    if (check && status.prompt && dismissalRevision === this.dismissalRevision)
                        this.suppressed = false;
                    // A locally saved installer should be offered again on startup/focus,
                    // but ordinary progress polls must respect the user's close action.
                    const readyReminder = check && status.phase === 'completed'
                        && dismissalRevision === this.dismissalRevision;
                    this.accept(status, manual || readyReminder);
                }
            }
            catch (error) {
                if (manual)
                    this.set({ ...this.value, error: error instanceof Error ? error.message : String(error), visible: true });
            }
        })().finally(() => { this.pending = undefined; });
        await this.pending;
    }
    private focus = (): void => {
        this.wasForeground = this.foreground();
        if (this.wasForeground) void this.refresh(true);
    };
    start(): () => void {
        if (this.timer || !this.eligible())
            return () => undefined;
        this.stopped = false;
        this.wasForeground = this.foreground();
        void this.refresh(true);
        window.addEventListener('focus', this.focus);
        document.addEventListener('visibilitychange', this.focus);
        this.timer = setInterval(() => {
            const foreground = this.foreground();
            if (foreground && !this.value.busy) {
                // Embedded frames can own focus without a focus event on the outer window.
                const activated = !this.wasForeground;
                this.wasForeground = true;
                void this.refresh(activated);
            } else if (!foreground) this.wasForeground = false;
        }, 1000);
        return () => { this.stopped = true; clearInterval(this.timer); this.timer = undefined; window.removeEventListener('focus', this.focus); document.removeEventListener('visibilitychange', this.focus); };
    }
    async open(): Promise<void> {
        this.suppressed = false;
        if (this.value.status && this.value.status.phase === 'downloading') {
            this.set({ ...this.value, visible: true });
            return;
        }
        await this.refresh(true, true);
    }
    async action(operation: 'download' | 'cancel' | 'reveal' | 'install'): Promise<void> {
        if (this.value.busy)
            return;
        if (this.pending)
            await this.pending;
        this.set({ ...this.value, busy: true, error: '' });
        try {
            this.accept(await this.call(`app.migration.${operation}`, { jobId: this.value.status?.jobId }), true);
        }
        catch (error) {
            try {
                this.accept(await this.call('app.migration.status'));
            }
            catch { /* Preserve the last known state when the Host is unavailable. */ }
            this.set({ ...this.value, error: operation === 'install' ? '未能打开安装向导，或系统授权已取消。你可以重试，或打开安装包所在目录手动安装。' : error instanceof Error ? error.message : String(error), visible: true });
        }
        finally {
            this.set({ ...this.value, busy: false });
        }
    }
    async dismiss(): Promise<void> {
        this.dismissalRevision++;
        this.suppressed = true;
        this.set({ ...this.value, visible: false });
        try {
            await this.call('app.migration.dismiss');
        }
        catch (error) {
            this.set({ ...this.value, error: error instanceof Error ? error.message : String(error) });
        }
    }
}
export const appMigrationStore = new AppMigrationStore();
