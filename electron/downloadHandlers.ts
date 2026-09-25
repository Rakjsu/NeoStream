import { ipcMain, app, BrowserWindow, shell, Notification } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import log from './logger'
import { juntarPartes } from './juntarPartes'
import { setTaskbarProgress } from './winIntegration'
import {
    caminhoDoDownload,
    resolveDownloadFile,
    resolveSeriesFolder,
    sanitizeDownloadName,
    type DescritorDeDownload,
} from './downloadPaths'
import { getErrorMessage } from './errorMessage';

interface ActiveDownload {
    id: string;
    request: http.ClientRequest | null;
    stream: fs.WriteStream | null;
    paused: boolean;
    cancelled: boolean;
    /** Conexões dos chunks paralelos — sem isto, pause/cancel eram no-op nesse caminho. */
    requests?: http.ClientRequest[];
    /** Timer de progresso do caminho paralelo — pause/cancel também têm que matá-lo. */
    progressInterval?: ReturnType<typeof setInterval> | null;
    /** Destino final — as partes do caminho paralelo são `<filePath>.partN`. */
    filePath?: string;
    /** Streams de escrita dos `.partN`: o cancel fecha antes de apagar. */
    escritas?: fs.WriteStream[];
    /** Resposta da conexão única — o cancel corta o socket, não só o arquivo. */
    resposta?: http.IncomingMessage;
    /**
     * O arquivo em `filePath` é DESTE download e está incompleto (conexão
     * única escrevendo, ou merge em curso): cancelar apaga ele também.
     */
    arquivoParcial?: boolean;
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

// Regra única de saneamento (downloadPaths.ts): criar e apagar TÊM que
// concordar sobre o nome da pasta, senão excluir série vira no-op.
const sanitizeFilename = sanitizeDownloadName;

function getFileSizeSync(filePath: string): number {
    try {
        const stats = fs.statSync(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

/**
 * Uma varredura por rajada.
 *
 * `getFolderSize` é recursão SÍNCRONA no event loop do processo principal — o
 * mesmo que está lendo os sockets dos downloads. O renderer pedia isso a cada
 * evento de progresso; a tela já deixou de pedir (Downloads.tsx), e esta é a
 * rede de segurança para o próximo chamador que não souber disso.
 *
 * TTL curto de propósito: é para engolir rajada, não para servir número velho.
 */
const TTL_ESPACO_MS = 1000;
let espacoEmCache: { usado: number; ts: number } | null = null;

function usoEmDisco(folderPath: string): number {
    const agora = Date.now();
    if (espacoEmCache && agora - espacoEmCache.ts < TTL_ESPACO_MS) return espacoEmCache.usado;
    const usado = getFolderSize(folderPath);
    espacoEmCache = { usado, ts: agora };
    return usado;
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

/** Destrói o stream e espera o handle do arquivo fechar de verdade. */
function fecharEscrita(escrita: fs.WriteStream): Promise<void> {
    return new Promise(resolve => {
        if (escrita.closed) { resolve(); return; }
        escrita.once('close', () => resolve());
        escrita.destroy();
    });
}

/**
 * Apaga as sobras de um download que não terminou: os `<filePath>.partN` do
 * caminho paralelo e, com `incluirArquivo`, o próprio `filePath` (conexão
 * única escrevendo nele, ou merge interrompido).
 *
 * Tudo passa por `resolveDownloadFile`: o caminho pode ter vindo de um
 * descritor do renderer, e `type: '..'` apontaria para fora da pasta.
 */
function apagarSobras(raiz: string, filePath: string, incluirArquivo: boolean): void {
    const alvos = Array.from({ length: PARALLEL_CONNECTIONS }, (_, i) => `${filePath}.part${i}`);
    if (incluirArquivo) alvos.push(filePath);
    for (const alvo of alvos) {
        const dentro = resolveDownloadFile(raiz, alvo);
        if (!dentro) continue;
        try { fs.unlinkSync(dentro); } catch { /* não existia, ou antivírus segurando: best-effort */ }
    }
}

/** O descritor do payload do cancel, se veio inteiro (renderer antigo manda só o id). */
function descritorValido(payload: Partial<DescritorDeDownload> | undefined): DescritorDeDownload | null {
    if (!payload || typeof payload.name !== 'string' || typeof payload.type !== 'string') return null;
    return {
        name: payload.name,
        type: payload.type,
        seriesName: typeof payload.seriesName === 'string' ? payload.seriesName : undefined,
        season: typeof payload.season === 'number' ? payload.season : undefined,
        episode: typeof payload.episode === 'number' ? payload.episode : undefined,
    };
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

/**
 * Download a single chunk with Range header.
 *
 * `onBytes` recebe cada pedaço que CHEGA. Sem ele, o download paralelo só
 * somava quando um `.partN` inteiro terminava: como as quatro conexões
 * dividem a mesma banda e acabam quase juntas, a tela ficava sem barra
 * nenhuma (ela só é desenhada com `progress > 0`) e sem "MB/s" durante quase
 * todo o download, e então saltava em degraus de ~25%.
 */
function downloadChunk(
    url: string,
    start: number,
    end: number,
    tempPath: string,
    register?: (req: http.ClientRequest) => void,
    onBytes?: (bytes: number) => void,
    onStream?: (escrita: fs.WriteStream) => void
): Promise<number> {
    return new Promise((resolve, reject) => {
        // ⏯ Resume real: aproveita o que o .partN já tem — o Range recomeça
        // do offset e o stream faz append; chunk completo nem vai pra rede.
        let already = 0;
        try {
            const stat = fs.statSync(tempPath);
            if (stat.size > 0 && stat.size <= end - start + 1) already = stat.size;
        } catch { /* sem parcial anterior */ }
        if (already >= end - start + 1) { resolve(already); return; }
        const effectiveStart = start + already;
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
                'Range': `bytes=${effectiveStart}-${end}`
            }
        };

        const handleResponse = (response: http.IncomingMessage) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    downloadChunk(redirectUrl, start, end, tempPath, register, onBytes, onStream).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 206 && response.statusCode !== 200) {
                reject(new Error(`HTTP Error: ${response.statusCode}`));
                return;
            }
            // 200 no meio de um resume = servidor ignorou o Range e mandaria
            // o arquivo inteiro — append corromperia o chunk.
            if (response.statusCode === 200 && effectiveStart > start) {
                reject(new Error('servidor ignorou o Range no resume'));
                return;
            }

            const writeStream = fs.createWriteStream(tempPath, { flags: already > 0 ? 'a' : 'w', highWaterMark: 128 * 1024 });
            onStream?.(writeStream);
            let downloaded = 0;

            response.on('data', (chunk) => {
                downloaded += chunk.length;
                onBytes?.(chunk.length);
            });

            response.pipe(writeStream);

            writeStream.on('finish', () => resolve(already + downloaded));
            writeStream.on('error', reject);
            // O cancel DESTRÓI o stream (fecha o arquivo antes de apagá-lo):
            // isso não emite 'finish' nem 'error', só 'close'. Depois de um
            // 'finish' este reject é no-op.
            writeStream.on('close', () => reject(new Error('Download cancelado')));
        };

        const request = protocol.request(options, handleResponse);
        register?.(request);
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

            const entrada: ActiveDownload = {
                id, request: null, stream: writeStream, paused: false, cancelled: false,
                filePath, resposta: response, arquivoParcial: true,
            };
            activeDownloads.set(id, entrada);

            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                // If we don't know total size, show bytes downloaded and estimate based on typical file sizes
                // For video files, estimate ~500MB average, show real progress if known
                const estimatedTotal = totalBytes > 0 ? totalBytes : 500 * 1024 * 1024; // 500MB estimate
                const progress = Math.min(99, Math.round((downloadedBytes / estimatedTotal) * 100));
                BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('download:progress', { id, progress, downloadedBytes, totalBytes: totalBytes || downloadedBytes });
                });
                setTaskbarProgress(progress);
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

            // Cancelamento: o `download:cancel` destrói este stream. Antes ele
            // chamava `close()`, que no Node é `end()` — o 'finish' disparava e
            // o download cancelado voltava como SUCESSO, com o arquivo truncado.
            // Destruído, só vem 'close'; sem este reject a promessa ficava
            // pendurada e o renderer perdia a vaga da fila.
            writeStream.on('close', () => {
                if (entrada.cancelled) reject(new Error('Download cancelado'));
            });
        };

        const request = protocol.request(options, handleResponse);
        request.on('error', reject);
        request.end();
    });
}

export function setupDownloadHandlers() {
    // Start download with parallel connections
    ipcMain.handle('download:start', async (event, { id, url, name, type, seriesName, season, episode }) => {
        log.info('[Download] Starting parallel download:', { id, name, type, seriesName, season, episode });
        // Declarados FORA do try: o `finally` precisa alcançá-los em todo
        // caminho de saída (erro do provedor, pause, cancelamento).
        let progressInterval: ReturnType<typeof setInterval> | null = null;
        let entry: ActiveDownload | null = null;
        try {
            const downloadsPath = getDownloadsPath();
            // A mesma regra que o `download:cancel` usa para achar as sobras
            // de um download que o main já esqueceu (downloadPaths.ts).
            const filePath = caminhoDoDownload(downloadsPath, { name, type, seriesName, season, episode });
            const pastaDoArquivo = path.dirname(filePath);
            if (!fs.existsSync(pastaDoArquivo)) {
                fs.mkdirSync(pastaDoArquivo, { recursive: true });
            }

            // Get file size first
            const fileInfo = await getFileSize(url);
            const { size: totalBytes, supportsRange } = fileInfo;
            log.info('[Download] File info:', { totalBytes, supportsRange });

            // If no range support, use single connection
            if (!supportsRange || totalBytes === 0) {
                log.info('[Download] Using single connection');
                return await singleDownload(id, url, filePath);
            }

            // Use parallel downloads
            log.info(`[Download] Using ${PARALLEL_CONNECTIONS} parallel connections`);
            const chunkSize = Math.ceil(totalBytes / PARALLEL_CONNECTIONS);
            const chunks: { start: number; end: number; index: number }[] = [];

            for (let i = 0; i < PARALLEL_CONNECTIONS; i++) {
                chunks.push({
                    start: i * chunkSize,
                    end: Math.min((i + 1) * chunkSize - 1, totalBytes - 1),
                    index: i
                });
            }

            // Bytes que já estavam no disco de uma tentativa anterior: sem
            // isto, retomar um download de 80% mostraria a barra voltando a 0.
            let totalDownloaded = chunks.reduce((soma, chunk) => {
                try {
                    const parcial = fs.statSync(`${filePath}.part${chunk.index}`).size;
                    return soma + Math.min(parcial, chunk.end - chunk.start + 1);
                } catch {
                    return soma;
                }
            }, 0);
            progressInterval = setInterval(() => {
                const progress = Math.round((totalDownloaded / totalBytes) * 100);
                BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('download:progress', { id, progress, downloadedBytes: totalDownloaded, totalBytes });
                });
                setTaskbarProgress(progress);
            }, 500);

            // Download all chunks in parallel (registrados pra pause/cancel).
            const parallelEntry: ActiveDownload = {
                id, request: null, stream: null, paused: false, cancelled: false, requests: [], progressInterval,
                filePath, escritas: [],
            };
            entry = parallelEntry;
            activeDownloads.set(id, parallelEntry);
            const downloadPromises = chunks.map(chunk =>
                downloadChunk(
                    url,
                    chunk.start,
                    chunk.end,
                    `${filePath}.part${chunk.index}`,
                    req => parallelEntry.requests?.push(req),
                    // Cada pedaço que chega conta na hora — é isto que faz a
                    // barra andar e o "MB/s" (delta de downloadedBytes no
                    // renderer) existir.
                    bytes => { totalDownloaded += bytes; },
                    escrita => parallelEntry.escritas?.push(escrita)
                )
            );

            await Promise.all(downloadPromises);
            clearInterval(progressInterval);
            progressInterval = null;
            parallelEntry.progressInterval = null;

            // Merge chunks (streamed to avoid loading whole parts into memory).
            // O erro de I/O daqui — disco cheio é o caso comum, porque a junção
            // precisa de ~1,25x o tamanho do filme livre — vira REJEIÇÃO e cai
            // no catch abaixo, em vez de subir como exceção assíncrona e abrir
            // o diálogo de crash do Electron. Ver juntarPartes.ts.
            log.info('[Download] Merging chunks...');
            // Daqui até o fim da junção o arquivo final existe pela metade:
            // um cancel no meio do merge também tem que levá-lo.
            parallelEntry.arquivoParcial = true;
            await juntarPartes(
                filePath,
                Array.from({ length: PARALLEL_CONNECTIONS }, (_, i) => `${filePath}.part${i}`)
            );
            activeDownloads.delete(id);

            // 🔎 Integridade: o arquivo final precisa bater com o content-length.
            const finalSize = fs.statSync(filePath).size;
            if (totalBytes > 0 && finalSize !== totalBytes) {
                try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
                setTaskbarProgress(null);
                log.warn(`[Download] Integridade falhou: esperado ${totalBytes}, veio ${finalSize}`);
                return { success: false, error: `Arquivo incompleto (${finalSize}/${totalBytes} bytes) — tente de novo` };
            }

            // Send 100%
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('download:progress', { id, progress: 100, downloadedBytes: totalBytes, totalBytes });
            });
            setTaskbarProgress(null);

            log.info('[Download] Complete:', filePath);

            // Show native notification
            showDownloadNotification(name, filePath);

            return { success: true, filePath, size: totalBytes };

        } catch (error: unknown) {
            log.error('[Download] Error:', error);
            return { success: false, error: getErrorMessage(error) };
        } finally {
            // 🧹 O `clearInterval` ficava DEPOIS do `await Promise.all`: qualquer
            // caminho que não fosse o feliz (provedor cortando a conexão, pause,
            // cancelamento) deixava o timer de 500 ms batendo IPC e taskbar até
            // o app fechar, e a entrada de activeDownloads segurava os
            // ClientRequest. Aqui vale para TODA saída do handler.
            if (progressInterval) clearInterval(progressInterval);
            // Só remove a PRÓPRIA entrada: um retry (resume) reusa o mesmo id e
            // já registrou a dele antes deste `finally` de um handler antigo.
            if (entry && activeDownloads.get(id) === entry) activeDownloads.delete(id);
            setTaskbarProgress(null);
        }
    });

    // Pause download
    ipcMain.handle('download:pause', async (_, { id }) => {
        const download = activeDownloads.get(id);
        if (download) {
            download.paused = true;
            if (download.request) download.request.destroy();
            for (const req of download.requests ?? []) {
                try { req.destroy(); } catch { /* já caiu */ }
            }
            // Redundante com o `finally` do download:start, mas cobre o caso de
            // um chunk que nunca chegou a registrar sua request e só cai no
            // timeout de 120 s — até lá o timer não deve mais bater na taskbar.
            if (download.progressInterval) {
                clearInterval(download.progressInterval);
                download.progressInterval = null;
            }
            return { success: true };
        }
        return { success: false, error: 'Download not found' };
    });

    // Cancel download — e apaga o que ele deixou no disco (D066).
    //
    // O renderer manda, além do id, o descritor do item (nome, tipo, série,
    // temporada, episódio): um download pausado ou que falhou já saiu de
    // `activeDownloads` (o `finally` do start limpa a entrada), e só o
    // descritor diz onde as partes dele estão. A PAUSA continua sem apagar
    // nada — é dela que o resume do `downloadChunk` depende.
    ipcMain.handle('download:cancel', async (_, payload: { id: string } & Partial<DescritorDeDownload>) => {
        const id = payload?.id;
        const raiz = getDownloadsPath();
        const download = activeDownloads.get(id);
        if (download) {
            download.cancelled = true;
            if (download.request) download.request.destroy();
            for (const req of download.requests ?? []) {
                try { req.destroy(); } catch { /* já caiu */ }
            }
            try { download.resposta?.destroy(); } catch { /* já caiu */ }
            if (download.progressInterval) {
                clearInterval(download.progressInterval);
                download.progressInterval = null;
            }
            activeDownloads.delete(id);
            setTaskbarProgress(null);
            // Fecha ANTES de apagar: no Windows um arquivo com handle aberto
            // não sai (ou fica "delete pending" e bloqueia o nome).
            const escritas = [download.stream, ...(download.escritas ?? [])]
                .filter((escrita): escrita is fs.WriteStream => escrita !== null);
            await Promise.all(escritas.map(fecharEscrita));
            if (download.filePath) apagarSobras(raiz, download.filePath, download.arquivoParcial === true);
            return { success: true };
        }

        const descritor = descritorValido(payload);
        if (descritor) {
            const filePath = caminhoDoDownload(raiz, descritor);
            // Mesmo destino de um download VIVO (outro id, mesmo nome e tipo):
            // as partes são dele, não do item que está sendo excluído.
            const emUso = Array.from(activeDownloads.values()).some(ativo => ativo.filePath === filePath);
            // Só as partes: o arquivo final, se existir, é de um download
            // concluído com o mesmo nome — nunca sobra deste.
            if (!emUso) apagarSobras(raiz, filePath, false);
        }
        return { success: false, error: 'Download not found' };
    });

    // Delete file
    ipcMain.handle('download:delete-file', async (_, { filePath }) => {
        try {
            // Mesma disciplina do dvr:delete-file: só apaga dentro da pasta
            // de downloads do app.
            const target = resolveDownloadFile(getDownloadsPath(), filePath);
            if (!target) {
                log.warn('[Download] delete-file recusado, fora da pasta de downloads');
                return { success: false, error: 'Caminho fora da pasta de downloads' };
            }
            if (fs.existsSync(target)) fs.unlinkSync(target);
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    // Get storage info - get real disk space
    ipcMain.handle('download:get-storage-info', async () => {
        try {
            const downloadsPath = getDownloadsPath();
            const used = usoEmDisco(downloadsPath);

            // Get real disk space using fs.statfs (Node.js 18.15+)
            let total = 100 * 1024 * 1024 * 1024; // Default fallback
            let available = total - used;

            try {
                const stats = fs.statfsSync(downloadsPath);
                total = stats.bsize * stats.blocks;
                available = stats.bsize * stats.bavail;
            } catch {
                // Fallback: try to estimate from userData path
                log.warn('[Download] statfs not available, using fallback');
            }

            return {
                success: true,
                used,
                total,
                available,
                downloadsPath
            };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    // Open folder
    ipcMain.handle('download:open-folder', async () => {
        try {
            shell.openPath(getDownloadsPath());
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    // Open file in default player (VLC, Windows Media Player, etc.)
    ipcMain.handle('download:open-file', async (_, filePath: string) => {
        try {
            if (!filePath || !fs.existsSync(filePath)) {
                return { success: false, error: 'File not found' };
            }
            shell.openPath(filePath);
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    // Delete series folder
    ipcMain.handle('download:delete-folder', async (_, { folderName }: { folderName: string }) => {
        try {
            // O nome da série vem do CATÁLOGO DO PROVEDOR: sem reancorar em
            // <downloads>/series/<nome saneado>, um provedor hostil publica uma
            // série chamada `..\..\Documents` e um clique em "excluir série"
            // apagava recursivamente a pasta escolhida por ele.
            const folderPath = resolveSeriesFolder(getDownloadsPath(), folderName);
            if (!folderPath) {
                log.warn('[Download] delete-folder recusado, nome inválido:', String(folderName).slice(0, 120));
                return { success: false, error: 'Nome de pasta inválido' };
            }
            if (fs.existsSync(folderPath)) {
                fs.rmSync(folderPath, { recursive: true, force: true });
            }
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
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
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
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

            // Atalho de cache. Tamanho 0 é SOBRA de uma queda de rede (o
            // arquivo nascia junto com os cabeçalhos), não capa: sem esta
            // conta o lixo era servido como capa boa para sempre — não há TTL,
            // revalidação nem botão na interface para limpar a pasta.
            if (getFileSizeSync(filePath) > 0) {
                return { success: true, localPath: `file:///${filePath.replace(/\\/g, '/')}` };
            }

            // Download the image
            return new Promise((resolve) => {
                const protocol = url.startsWith('https') ? https : http;

                // O corpo vai para um .tmp e só vira capa no 'finish', com
                // rename (atômico no mesmo volume). Escrevendo direto no
                // destino, uma conexão que caía no meio deixava lá um .jpg
                // pela metade que o atalho acima passava a servir para sempre.
                // Sufixo ÚNICO por tentativa. Com `${filePath}.tmp` fixo, duas
                // tentativas da MESMA capa disputam o mesmo arquivo: a grade
                // pede a capa de novo assim que a primeira falha, e a limpeza
                // da primeira ainda está pendurada no 'close' do stream dela
                // — ela apaga o temporário da SEGUNDA, que então morre no
                // rename com ENOENT. Dois pedidos simultâneos é pior: os dois
                // escrevem no mesmo arquivo e o rename publica a mistura.
                const tempPath = `${filePath}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
                let escrita: fs.WriteStream | null = null;
                let encerrado = false;

                const limparTmp = () => {
                    try { fs.unlinkSync(tempPath); } catch { /* nem chegou a existir */ }
                };

                const falhar = (error: string) => {
                    if (encerrado) return;
                    encerrado = true;
                    // No Windows não se apaga arquivo com handle aberto: a
                    // sobra só sai depois do 'close' do stream.
                    if (escrita && !escrita.closed) {
                        escrita.once('close', limparTmp);
                        escrita.destroy();
                    } else {
                        limparTmp();
                    }
                    resolve({ success: false, error });
                };

                const gravar = (response: http.IncomingMessage) => {
                    const writeStream = fs.createWriteStream(tempPath);
                    escrita = writeStream;
                    // Sem listener de 'error' no writeStream, um erro de disco
                    // (ENOSPC/EACCES) vira 'error' NÃO tratado de stream e
                    // derruba o main com o diálogo de crash — o ramo do
                    // redirect abaixo não tinha nenhum.
                    writeStream.on('error', (err) => { response.destroy(); falhar(err.message); });
                    response.on('error', (err) => falhar(err.message));
                    writeStream.on('finish', () => {
                        if (encerrado) return;
                        encerrado = true;
                        try {
                            fs.renameSync(tempPath, filePath);
                        } catch (err: unknown) {
                            limparTmp();
                            // Outro pedido da MESMA capa (dois cards do mesmo
                            // item, um re-render) publicou primeiro. No Windows
                            // o rename por cima de um arquivo recem-criado pode
                            // voltar EPERM/EACCES/EBUSY: o antivirus e o
                            // indexador abrem arquivo novo. Se o destino ja tem
                            // uma capa inteira -- e so chega capa inteira ali,
                            // porque ela so entra por este rename --, o pedido
                            // esta atendido.
                            if (getFileSizeSync(filePath) > 0) {
                                resolve({ success: true, localPath: `file:///${filePath.replace(/\\/g, '/')}` });
                                return;
                            }
                            resolve({ success: false, error: getErrorMessage(err) });
                            return;
                        }
                        resolve({ success: true, localPath: `file:///${filePath.replace(/\\/g, '/')}` });
                    });
                    response.pipe(writeStream);
                };

                const request = protocol.get(url, (response) => {
                    // Handle redirects
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
                            redirectProtocol.get(redirectUrl, (redirectRes) => gravar(redirectRes))
                                .on('error', () => falhar('Redirect download failed'));
                            return;
                        }
                    }

                    if (response.statusCode !== 200) {
                        falhar(`HTTP ${response.statusCode}`);
                        return;
                    }

                    gravar(response);
                });

                request.on('error', (err) => falhar(err.message));

                request.setTimeout(30000, () => {
                    request.destroy();
                    falhar('Timeout');
                });
            });
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    log.info('Download Handlers initialized with parallel connections');
}
