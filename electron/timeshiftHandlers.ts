/**
 * ⏪ Item 15 — timeshift da TV ao vivo (aposta grande).
 *
 * timeshift:start sobe um ffmpeg copiando o canal pra um HLS local com
 * janela deslizante (~30 min) e um servidor HTTP em 127.0.0.1 servindo a
 * pasta do buffer. O player troca a fonte pro buffer local e o pause vira
 * real (o buffer segue crescendo enquanto o usuário está pausado).
 * Sessão única — trocar de canal reinicia; timeshift:stop derruba tudo.
 */

import { ipcMain, app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import log from './logger'
import { isAppOwnOrigin } from './localServerGuard'
import {
    buildTimeshiftArgs,
    resolveTimeshiftFile,
    timeshiftContentType,
} from './timeshiftBuffer'
import { resolveFfmpegPath } from './ffmpegPath'
import { getErrorMessage } from './errorMessage'

interface TimeshiftSession {
    proc: ChildProcess
    server: http.Server
    dir: string
    port: number
    /** Segredo do caminho (`/<token>/buffer.m3u8`) — ver resolveTimeshiftFile. */
    token: string
}

let session: TimeshiftSession | null = null

/**
 * Pasta do buffer (~30 min de MPEG-TS, facilmente alguns GB).
 *
 * Exportada porque a tela de Armazenamento mede e limpa esta pasta: repetir o
 * `path.join(userData, 'timeshift')` lá seria uma segunda fonte da verdade
 * pronta pra sair do lugar.
 */
export function timeshiftDir(): string {
    return path.join(app.getPath('userData'), 'timeshift')
}

/**
 * Há sessão de timeshift viva? A tela de Armazenamento pergunta antes de
 * apagar o buffer — com o ffmpeg ainda escrevendo nele, apagar derruba a
 * reprodução (e no Windows nem apaga: EBUSY no segmento aberto).
 */
export function isTimeshiftRunning(): boolean {
    return session !== null
}

/**
 * Apaga a pasta do buffer (~30 min de MPEG-TS, até ~1 GB).
 *
 * maxRetries/retryDelay não são enfeite: no Windows o handle do segmento que
 * o ffmpeg tinha aberto só cai quando o processo morre de fato, e `kill()`
 * volta antes disso — sem as tentativas o rmSync bate em EBUSY/EPERM
 * justamente no caminho do quit, que é onde esta faxina mais importa.
 */
function apagarBuffer(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    } catch { /* fica pro próximo start (ou pro boot seguinte) */ }
}

/**
 * `agora = true` apaga o buffer sem o segundo de folga. É o caminho do quit:
 * `teardownTimeshift` roda no `before-quit` e o processo principal morre MUITO
 * antes de um segundo, levando o timer junto — a janela inteira de ~30 min de
 * MPEG-TS ficava em `userData/timeshift` até o próximo ⏪. Fora do quit a
 * espera continua valendo: o app segue vivo e o ffmpeg ainda está soltando os
 * handles dos segmentos.
 */
function stopSession(agora = false): void {
    const current = session
    session = null
    if (!current) return
    try { current.proc.kill() } catch { /* já morreu */ }
    try { current.server.close() } catch { /* já fechado */ }
    if (agora) {
        apagarBuffer(current.dir)
        return
    }
    // Limpeza atrasada: o ffmpeg solta os handles dos segmentos ao morrer.
    setTimeout(() => apagarBuffer(current.dir), 1000)
}

/** Espera a playlist ganhar >= 2 segmentos (buffer tocável), com teto. */
async function waitForBuffer(playlistPath: string, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const text = fs.readFileSync(playlistPath, 'utf-8')
            if ((text.match(/#EXTINF/g) ?? []).length >= 2) return true
        } catch { /* ffmpeg ainda não criou */ }
        if (!session) return false // stop/erro no meio da espera
        await new Promise(resolve => setTimeout(resolve, 500))
    }
    return false
}

export function setupTimeshiftHandlers(): void {
    // Rede de segurança do boot: aqui não existe sessão viva, então o que
    // estiver na pasta é resíduo de um fechamento que não deu tempo de limpar
    // (queda, kill pela bandeja/instalador, rmSync barrado pelo antivírus).
    // Sem isto o disco só voltaria na próxima vez que o usuário ligasse o ⏪.
    // O try é do `timeshiftDir()`: isto roda no corpo do main, antes do
    // whenReady, e uma exceção aqui abortaria a inicialização inteira.
    try { apagarBuffer(timeshiftDir()) } catch { /* sem userData: nada a apagar */ }

    ipcMain.handle('timeshift:start', async (_, { url }: { url: string }) => {
        try {
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
                return { success: false, error: 'URL inválida' }
            }
            const ffmpeg = resolveFfmpegPath()
            if (!ffmpeg) return { success: false, error: 'ffmpeg indisponível' }

            stopSession()
            const dir = timeshiftDir()
            try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* primeira vez */ }
            fs.mkdirSync(dir, { recursive: true })

            const proc = spawn(ffmpeg, buildTimeshiftArgs(url, dir), {
                windowsHide: true,
                stdio: ['ignore', 'ignore', 'pipe'],
            })
            let stderrTail = ''
            proc.stderr?.on('data', (chunk: Buffer) => {
                stderrTail = (stderrTail + chunk.toString()).slice(-500)
            })
            // 🧯 'error' do ChildProcess é ASSÍNCRONO: ele não passa pelo
            // try/catch daqui e avisa que o spawn em si falhou (binário sumido
            // ou movido pelo antivírus, EACCES, instalação pela metade).
            // EventEmitter que emite 'error' sem ouvinte LANÇA — ligar o
            // timeshift nessa máquina derrubava o processo principal inteiro,
            // levando junto reprodução, DVR e downloads.
            const falhaDoSpawn: { erro: Error | null } = { erro: null }
            proc.on('error', (err) => {
                falhaDoSpawn.erro = err instanceof Error ? err : new Error(String(err))
                log.error('[Timeshift] ffmpeg não iniciou:', falhaDoSpawn.erro.message)
                if (session?.proc === proc) stopSession()
            })
            proc.on('exit', (code) => {
                if (session?.proc === proc) {
                    log.warn(`[Timeshift] ffmpeg saiu (code ${code}): ${stderrTail}`)
                    stopSession()
                }
            })

            // Servidor do buffer: só loopback, só nomes simples .m3u8/.ts,
            // e só sob o token da sessão.
            const token = randomUUID()
            const server = http.createServer((request, response) => {
                // 🛡️ O bind em 127.0.0.1 não exclui o navegador do dono, que
                // alcança o loopback: era o `Access-Control-Allow-Origin: *`
                // abaixo que deixava uma aba em evil.com LER o que ele está
                // assistindo. Só a origem do próprio app passa daqui.
                if (!isAppOwnOrigin(request.headers.origin, process.env['VITE_DEV_SERVER_URL'])) {
                    log.warn(`[Timeshift] origem recusada: ${request.headers.origin}`)
                    response.writeHead(403)
                    response.end()
                    return
                }
                const file = resolveTimeshiftFile(dir, request.url ?? '', token)
                if (!file || !fs.existsSync(file)) {
                    response.writeHead(404)
                    response.end()
                    return
                }
                response.writeHead(200, {
                    'Content-Type': timeshiftContentType(file),
                    'Cache-Control': 'no-store',
                    // Mantido porque o renderer empacotado carrega de file://
                    // (origem opaca) e o hls.js precisa de CORS pra ler; quem
                    // não é o app já foi recusado acima. Vary pra nenhum cache
                    // intermediário reaproveitar a resposta entre origens.
                    'Access-Control-Allow-Origin': '*',
                    'Vary': 'Origin',
                })
                fs.createReadStream(file).pipe(response)
            })
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject)
                server.listen(0, '127.0.0.1', () => resolve())
            })
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 0

            if (falhaDoSpawn.erro) {
                // O spawn morreu enquanto o servidor subia: publicar a sessão
                // com o ffmpeg morto só adiaria o mesmo erro por 15 s, com uma
                // mensagem pior ("buffer não encheu a tempo").
                try { server.close() } catch { /* nem chegou a subir */ }
                return { success: false, error: getErrorMessage(falhaDoSpawn.erro) }
            }

            session = { proc, server, dir, port, token }

            const ready = await waitForBuffer(path.join(dir, 'buffer.m3u8'), 15_000)
            if (!ready || session?.proc !== proc) {
                log.warn(`[Timeshift] buffer não encheu a tempo: ${stderrTail}`)
                stopSession()
                return { success: false, error: stderrTail || 'buffer não encheu a tempo' }
            }

            log.info(`[Timeshift] ativo na porta ${port} (janela ~30 min)`)
            return { success: true, url: `http://127.0.0.1:${port}/${token}/buffer.m3u8` }
        } catch (error: unknown) {
            stopSession()
            const message = getErrorMessage(error)
            log.error('[Timeshift] start falhou:', message)
            return { success: false, error: message }
        }
    })

    ipcMain.handle('timeshift:stop', async () => {
        stopSession()
        return { success: true }
    })

    log.info('[Timeshift] IPC handlers initialized')
}

/** Derruba a sessão no quit (ffmpeg não pode sobreviver ao app). */
export function teardownTimeshift(): void {
    stopSession(true)
}
