import { ipcMain, app, BrowserWindow, shell, Notification } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'

interface ActiveDownload {
    id: string;
    request: http.ClientRequest | null;
    stream: fs.WriteStream | null;
    paused: boolean;
    cancelled: boolean;
}

const activeDownloads: Map<string, ActiveDownload> = new Map();

// Number of parallel connections for faster downloads
const PARALLEL_CONNECTIONS = 4;

function getDownloadsPath(): string {
    const userDataPath = app.getPath('userData');
    const downloadsPath = path.join(userDataPath, 'downloads');

    if (!fs.existsSync(downloadsPath)) {
        fs.mkdirSync(downloadsPath, { recursive: true });
    }

    return downloadsPath;
}

function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

function getFileSizeSync(filePath: string): number {
    try {
        const stats = fs.statSync(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

function getFolderSize(folderPath: string): number {
    let totalSize = 0;
    try {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
                totalSize += stats.size;
            } else if (stats.isDirectory()) {
                totalSize += getFolderSize(filePath);
            }
        }
    } catch {
        // Folder doesn't exist
    }
    return totalSize;
}

// Show native Windows notification when download completes
function showDownloadNotification(name: string, filePath: string): void {
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: 'Download Concluído! ✓',
            body: `"${name}" foi baixado com sucesso.`,
            icon: undefined,
            silent: false
        });
        notification.on('click', () => {
            shell.showItemInFolder(filePath);
        });
        notification.show();
    }
}

// Download a single chunk with Range header
function downloadChunk(url: string, start: number, end: number, tempPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = url.startsWith('https') ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            timeout: 120000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
                'Range': `bytes=${start}-${end}`
            }
        };

        const handleResponse = (response: http.IncomingMessage) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    downloadChunk(redirectUrl, start, end, tempPath).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 206 && response.statusCode !== 200) {
                reject(new Error(`HTTP Error: ${response.statusCode}`));
                return;
            }

            const writeStream = fs.createWriteStream(tempPath, { highWaterMark: 128 * 1024 });
            let downloaded = 0;

            response.on('data', (chunk) => {
                downloaded += chunk.length;
            });

            response.pipe(writeStream);

            writeStream.on('finish', () => resolve(downloaded));
            writeStream.on('error', reject);
        };

        const request = protocol.request(options, handleResponse);
        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Chunk timeout'));
        });
        request.end();
    });
}

// Get file size with HEAD request
function getFileSize(url: string): Promise<{ size: number; supportsRange: boolean }> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = url.startsWith('https') ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'HEAD',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };

        const handleResponse = (response: http.IncomingMessage) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    getFileSize(redirectUrl).then(resolve).catch(reject);
                    return;
                }
            }

            const size = parseInt(response.headers['content-length'] || '0', 10);
            const acceptRanges = response.headers['accept-ranges'];
            const supportsRange = acceptRanges === 'bytes' || size > 0;
            resolve({ size, supportsRange });
        };

        const request = protocol.request(options, handleResponse);
        request.on('error', () => resolve({ size: 0, supportsRange: false }));
        request.on('timeout', () => {
            request.destroy();
            resolve({ size: 0, supportsRange: false });
        });
        request.end();
    });
}

// Single connection download (fallback)
function singleDownload(id: string, url: string, filePath: string): Promise<{ success: boolean; filePath?: string; size?: number; error?: string }> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = url.startsWith('https') ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive'
            }
        };

        const handleResponse = (response: http.IncomingMessage) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    singleDownload(id, redirectUrl, filePath).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP Error: ${response.statusCode}`));
                return;
            }

            const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;

            const writeStream = fs.createWriteStream(filePath, { highWaterMark: 128 * 1024 });

            activeDownloads.set(id, { id, request: null, stream: writeStream, paused: false, cancelled: false });

            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
                BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('download:progress', { id, progress, downloadedBytes, totalBytes });
                });
            });

            response.pipe(writeStream);

            writeStream.on('finish', () => {
                activeDownloads.delete(id);
                resolve({ success: true, filePath, size: totalBytes });
            });

            writeStream.on('error', (err) => {
                activeDownloads.delete(id);
                reject(err);
            });
        };

        const request = protocol.request(options, handleResponse);
        request.on('error', reject);
        request.end();
    });
}

export function setupDownloadHandlers() {
    // Start download with parallel connections
    ipcMain.handle('download:start', async (event, { id, url, name, type }) => {
        console.log('[Download] Starting parallel download:', { id, name, type });
        try {
            const downloadsPath = getDownloadsPath();
            const fileName = sanitizeFilename(`${name}.mp4`);
            const filePath = path.join(downloadsPath, type, fileName);

            const typeDir = path.join(downloadsPath, type);
            if (!fs.existsSync(typeDir)) {
                fs.mkdirSync(typeDir, { recursive: true });
            }

            // Get file size first
            const fileInfo = await getFileSize(url);
            const { size: totalBytes, supportsRange } = fileInfo;
            console.log('[Download] File info:', { totalBytes, supportsRange });

            // If no range support, use single connection
            if (!supportsRange || totalBytes === 0) {
                console.log('[Download] Using single connection');
                return await singleDownload(id, url, filePath);
            }

            // Use parallel downloads
            console.log(`[Download] Using ${PARALLEL_CONNECTIONS} parallel connections`);
            const chunkSize = Math.ceil(totalBytes / PARALLEL_CONNECTIONS);
            const chunks: { start: number; end: number; index: number }[] = [];

            for (let i = 0; i < PARALLEL_CONNECTIONS; i++) {
                chunks.push({
                    start: i * chunkSize,
                    end: Math.min((i + 1) * chunkSize - 1, totalBytes - 1),
                    index: i
                });
            }

            let totalDownloaded = 0;
            const progressInterval = setInterval(() => {
                const progress = Math.round((totalDownloaded / totalBytes) * 100);
                BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('download:progress', { id, progress, downloadedBytes: totalDownloaded, totalBytes });
                });
            }, 500);

            // Download all chunks in parallel
            const downloadPromises = chunks.map(chunk =>
                downloadChunk(url, chunk.start, chunk.end, `${filePath}.part${chunk.index}`)
                    .then(bytes => { totalDownloaded += bytes; return bytes; })
            );

            await Promise.all(downloadPromises);
            clearInterval(progressInterval);

            // Merge chunks
            console.log('[Download] Merging chunks...');
            const writeStream = fs.createWriteStream(filePath);

            for (let i = 0; i < PARALLEL_CONNECTIONS; i++) {
                const partPath = `${filePath}.part${i}`;
                if (fs.existsSync(partPath)) {
                    const data = fs.readFileSync(partPath);
                    writeStream.write(data);
                    fs.unlinkSync(partPath);
                }
            }
            writeStream.end();

            // Send 100%
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('download:progress', { id, progress: 100, downloadedBytes: totalBytes, totalBytes });
            });

            console.log('[Download] Complete:', filePath);

            // Show native notification
            showDownloadNotification(name, filePath);

            return { success: true, filePath, size: totalBytes };

        } catch (error: any) {
            console.error('[Download] Error:', error);
            return { success: false, error: error.message };
        }
    });

    // Pause download
    ipcMain.handle('download:pause', async (_, { id }) => {
        const download = activeDownloads.get(id);
        if (download) {
            download.paused = true;
            if (download.request) download.request.destroy();
            return { success: true };
        }
        return { success: false, error: 'Download not found' };
    });

    // Cancel download
    ipcMain.handle('download:cancel', async (_, { id }) => {
        const download = activeDownloads.get(id);
        if (download) {
            download.cancelled = true;
            if (download.request) download.request.destroy();
            if (download.stream) download.stream.close();
            activeDownloads.delete(id);
            return { success: true };
        }
        return { success: false, error: 'Download not found' };
    });

    // Delete file
    ipcMain.handle('download:delete-file', async (_, { filePath }) => {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Get storage info - get real disk space
    ipcMain.handle('download:get-storage-info', async () => {
        try {
            const downloadsPath = getDownloadsPath();
            const used = getFolderSize(downloadsPath);

            // Get real disk space using fs.statfs (Node.js 18.15+)
            let total = 100 * 1024 * 1024 * 1024; // Default fallback
            let available = total - used;

            try {
                const stats = fs.statfsSync(downloadsPath);
                total = stats.bsize * stats.blocks;
                available = stats.bsize * stats.bavail;
            } catch (e) {
                // Fallback: try to estimate from userData path
                console.warn('[Download] statfs not available, using fallback');
            }

            return {
                success: true,
                used,
                total,
                available,
                downloadsPath
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Open folder
    ipcMain.handle('download:open-folder', async () => {
        try {
            shell.openPath(getDownloadsPath());
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Get files
    ipcMain.handle('download:get-files', async () => {
        try {
            const downloadsPath = getDownloadsPath();
            const files: { name: string; path: string; size: number; type: string }[] = [];

            for (const type of ['movie', 'series', 'episode']) {
                const typePath = path.join(downloadsPath, type);
                if (fs.existsSync(typePath)) {
                    for (const file of fs.readdirSync(typePath)) {
                        const fPath = path.join(typePath, file);
                        files.push({ name: file, path: fPath, size: getFileSizeSync(fPath), type });
                    }
                }
            }
            return { success: true, files };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Cache image locally
    ipcMain.handle('download:cache-image', async (_, { url, id }) => {
        try {
            const downloadsPath = getDownloadsPath();
            const coversPath = path.join(downloadsPath, 'covers');

            if (!fs.existsSync(coversPath)) {
                fs.mkdirSync(coversPath, { recursive: true });
            }

            const ext = url.includes('.png') ? '.png' : '.jpg';
            const fileName = `${sanitizeFilename(id)}${ext}`;
            const filePath = path.join(coversPath, fileName);

            // If already cached, return existing path
            if (fs.existsSync(filePath)) {
                return { success: true, localPath: `file:///${filePath.replace(/\\/g, '/')}` };
            }

            // Download the image
            return new Promise((resolve) => {
                const protocol = url.startsWith('https') ? https : http;

                const request = protocol.get(url, (response) => {
                    // Handle redirects
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
                            redirectProtocol.get(redirectUrl, (redirectRes) => {
                                const writeStream = fs.createWriteStream(filePath);
                                redirectRes.pipe(writeStream);
                                writeStream.on('finish', () => {
                                    resolve({ success: true, localPath: `file:///${filePath.replace(/\\/g, '/')}` });
                                });
                            }).on('error', () => {
                                resolve({ success: false, error: 'Redirect download failed' });
                            });
                            return;
                        }
                    }

                    if (response.statusCode !== 200) {
                        resolve({ success: false, error: `HTTP ${response.statusCode}` });
                        return;
                    }

                    const writeStream = fs.createWriteStream(filePath);
                    response.pipe(writeStream);
                    writeStream.on('finish', () => {
                        resolve({ success: true, localPath: `file:///${filePath.replace(/\\/g, '/')}` });
                    });
                    writeStream.on('error', (err) => {
                        resolve({ success: false, error: err.message });
                    });
                });

                request.on('error', (err) => {
                    resolve({ success: false, error: err.message });
                });

                request.setTimeout(30000, () => {
                    request.destroy();
                    resolve({ success: false, error: 'Timeout' });
                });
            });
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    console.log('Download Handlers initialized with parallel connections');
}
