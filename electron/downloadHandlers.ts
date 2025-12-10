import { ipcMain, app, BrowserWindow, shell } from 'electron'
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

function getDownloadsPath(): string {
    const userDataPath = app.getPath('userData');
    const downloadsPath = path.join(userDataPath, 'downloads');

    // Create directory if it doesn't exist
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
        // Folder doesn't exist or can't be read
    }

    return totalSize;
}

export function setupDownloadHandlers() {
    // Start download
    ipcMain.handle('download:start', async (event, { id, url, name, type }) => {
        console.log('[Download] Starting download:', { id, name, type, url: url?.substring(0, 100) + '...' });
        try {
            const downloadsPath = getDownloadsPath();
            const fileName = sanitizeFilename(`${name}.mp4`);
            const filePath = path.join(downloadsPath, type, fileName);

            // Create type subdirectory
            const typeDir = path.join(downloadsPath, type);
            if (!fs.existsSync(typeDir)) {
                fs.mkdirSync(typeDir, { recursive: true });
            }

            return new Promise((resolve, reject) => {
                const parsedUrl = new URL(url);
                const protocol = url.startsWith('https') ? https : http;

                const options = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    timeout: 60000, // 60s timeout - prevents hanging
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Encoding': 'identity', // No compression for max speed
                        'Connection': 'keep-alive',
                        'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`
                    }
                };

                // Define handleResponse before using it
                const handleResponse = (response: http.IncomingMessage) => {
                    console.log('[Download] Response received:', {
                        statusCode: response.statusCode,
                        contentLength: response.headers['content-length'],
                        contentType: response.headers['content-type']
                    });

                    // Handle redirects - make new request to redirect URL
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        console.log('[Download] Redirecting to:', redirectUrl?.substring(0, 100) + '...');
                        if (redirectUrl) {
                            // Parse redirect URL and make new request
                            const redirectParsed = new URL(redirectUrl);
                            const redirectProtocol = redirectUrl.startsWith('https') ? https : http;

                            const redirectOptions = {
                                hostname: redirectParsed.hostname,
                                port: redirectParsed.port || (redirectUrl.startsWith('https') ? 443 : 80),
                                path: redirectParsed.pathname + redirectParsed.search,
                                method: 'GET',
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Accept': '*/*',
                                    'Accept-Encoding': 'identity',
                                    'Connection': 'keep-alive'
                                }
                            };

                            const redirectRequest = redirectProtocol.request(redirectOptions, handleResponse);
                            redirectRequest.on('error', (err) => {
                                activeDownloads.delete(id);
                                reject(err);
                            });
                            redirectRequest.end();
                            return;
                        }
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP Error: ${response.statusCode}`));
                        return;
                    }

                    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
                    console.log('[Download] Starting file write, totalBytes:', totalBytes);
                    let downloadedBytes = 0;

                    const writeStream = fs.createWriteStream(filePath, {
                        highWaterMark: 64 * 1024 // 64KB buffer for faster writes
                    });

                    const download: ActiveDownload = {
                        id,
                        request,
                        stream: writeStream,
                        paused: false,
                        cancelled: false
                    };

                    activeDownloads.set(id, download);

                    response.on('data', (chunk) => {
                        if (download.cancelled) {
                            response.destroy();
                            writeStream.close();
                            return;
                        }

                        if (download.paused) {
                            request.destroy();
                            return;
                        }

                        downloadedBytes += chunk.length;
                        const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

                        // Send progress to renderer
                        const windows = BrowserWindow.getAllWindows();
                        windows.forEach(win => {
                            win.webContents.send('download:progress', {
                                id,
                                progress,
                                downloadedBytes,
                                totalBytes
                            });
                        });
                    });

                    response.pipe(writeStream);

                    writeStream.on('finish', () => {
                        console.log('[Download] File write finished:', filePath);
                        activeDownloads.delete(id);

                        if (!download.cancelled) {
                            resolve({
                                success: true,
                                filePath,
                                size: totalBytes
                            });
                        }
                    });

                    writeStream.on('error', (err) => {
                        activeDownloads.delete(id);
                        reject(err);
                    });
                };

                const request = protocol.request(options, handleResponse);

                request.on('error', (err) => {
                    activeDownloads.delete(id);
                    reject(err);
                });

                // Start the request
                request.end();
            });
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Pause download
    ipcMain.handle('download:pause', async (_, { id }) => {
        const download = activeDownloads.get(id);
        if (download) {
            download.paused = true;
            if (download.request) {
                download.request.destroy();
            }
            return { success: true };
        }
        return { success: false, error: 'Download not found' };
    });

    // Cancel download
    ipcMain.handle('download:cancel', async (_, { id }) => {
        const download = activeDownloads.get(id);
        if (download) {
            download.cancelled = true;
            if (download.request) {
                download.request.destroy();
            }
            if (download.stream) {
                download.stream.close();
            }
            activeDownloads.delete(id);
            return { success: true };
        }
        return { success: false, error: 'Download not found' };
    });

    // Delete downloaded file
    ipcMain.handle('download:delete-file', async (_, { filePath }) => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Get storage info
    ipcMain.handle('download:get-storage-info', async () => {
        try {
            const downloadsPath = getDownloadsPath();
            const used = getFolderSize(downloadsPath);

            // Get disk space info (simplified - uses userData path)
            const diskPath = app.getPath('userData');
            let total = 100 * 1024 * 1024 * 1024; // Default 100GB
            let available = 50 * 1024 * 1024 * 1024; // Default 50GB

            // Try to get actual disk space (requires additional module or OS-specific code)
            // For now, use estimated values

            return {
                success: true,
                used,
                total,
                available: total - used,
                downloadsPath
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Open downloads folder
    ipcMain.handle('download:open-folder', async () => {
        try {
            const downloadsPath = getDownloadsPath();
            shell.openPath(downloadsPath);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Get downloaded files
    ipcMain.handle('download:get-files', async () => {
        try {
            const downloadsPath = getDownloadsPath();
            const files: { name: string; path: string; size: number; type: string }[] = [];

            const types = ['movie', 'series', 'episode'];
            for (const type of types) {
                const typePath = path.join(downloadsPath, type);
                if (fs.existsSync(typePath)) {
                    const typeFiles = fs.readdirSync(typePath);
                    for (const file of typeFiles) {
                        const filePath = path.join(typePath, file);
                        const size = getFileSizeSync(filePath);
                        files.push({
                            name: file,
                            path: filePath,
                            size,
                            type
                        });
                    }
                }
            }

            return { success: true, files };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    console.log('Download Handlers initialized');
}
