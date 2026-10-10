export type MigrationPhase = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'completed' | 'failed';
export interface MigrationTarget {
    version: string;
    versionCode: number;
    downloadUrl: string;
    kind: 'pkg' | 'exe';
}
export interface MigrationSnapshot {
    phase: MigrationPhase;
    currentVersion: string;
    target?: MigrationTarget;
    jobId?: string;
    downloadedBytes: number;
    totalBytes?: number;
    prompt: boolean;
    error?: string;
    fileName?: string;
}

export function migrationDownloadProgress(status?: MigrationSnapshot): string {
    const downloaded = status?.downloadedBytes ?? 0;
    const total = status?.totalBytes;
    const amount = (downloaded / 1048576).toFixed(1);
    return total !== undefined && total > 0
        ? `${Math.min(100, Math.floor(downloaded / total * 100))}% · ${amount} / ${(total / 1048576).toFixed(1)} MB`
        : `已下载 ${amount} MB`;
}
