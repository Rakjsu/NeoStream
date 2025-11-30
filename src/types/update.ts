// Auto-Update System Types

export interface UpdateInfo {
    version: string;
    releaseDate: string;
    releaseNotes: string;
    files: Array<{
        url: string;
        size: number;
        sha512: string;
    }>;
}

export interface UpdateConfig {
    checkFrequency: 'on-open' | '1-day' | '1-week' | '1-month';
    autoInstall: boolean;
    lastCheck: number;
    skippedVersion?: string;
}

export interface DownloadProgress {
    total: number;
    delta: number;
    transferred: number;
    percent: number;
    bytesPerSecond: number;
}

export interface UpdateCheckResult {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    updateInfo?: UpdateInfo;
}

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
