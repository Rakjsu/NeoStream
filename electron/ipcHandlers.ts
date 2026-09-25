import { ipcMain, BrowserWindow, dialog, screen, shell } from 'electron'
import axios from 'axios'
import { XtreamClient } from './xtreamClient'
import store from './store'
import { getCertificateSettings, resolveProviderHttpsAgent, registerApprovedProviderUrl, setAllowInvalidProviderCertificates, forgetTrustedCertificateDomains } from './certificatePolicy'
import { fetchWithRetry, requestWithRetry } from './fetchRetry'
import { readResponseTextWithLimit, M3U_MAX_BYTES, XMLTV_MAX_BYTES, JSON_MAX_BYTES } from './httpLimits'
import { ensureProviderEpgLoaded, getProviderUtcOffsetMinutes, resetProviderEpgState, setupProviderEpgHandlers } from './providerEpg'
import { formatTimeshiftStart } from './timeshiftProtocol'
import { getErrorMessage } from './errorMessage'
import { addDocumentToIndex, emptyIndex, finalizeIndex, lookupChannel, type XmltvIndex } from './epgIndexProtocol'
import { cacheKeyValido } from './epgCacheGuard'
import { resolverUrlOpenSubtitles } from './openSubtitlesEndpoint'
import {
    activatePlaylist,
    deactivatePlaylists,
    exportPlaylistsForBackup,
    findPlaylist,
    getActivePlaylist,
    getActivePlaylistIdPublic,
    refreshActiveUserInfo,
    importPlaylistsFromBackup,
    listPublicPlaylists,
    migratePlaylistsOnStartup,
    removePlaylist,
    renameStoredPlaylist,
    saveAndActivatePlaylist,
    importMobileAccounts,
    updateStoredPlaylist,
} from './playlistManager'
import type { PlaylistBackupEntry, MobileAccountEntry } from './playlistManager'
import { diffPlaylistPatch, isUserInfoFresh } from './playlistsModel'
import type { PlaylistPatch } from './playlistsModel'

import { cachedCatalogFetch, invalidatePlaylistCache, type CatalogKind } from './catalogCache'
import { contagensDoCatalogo } from './catalogCounts'
import { parseM3u, looksLikeM3u, m3uToLiveStreams, m3uToVodStreams, m3uCategories, m3uToSeries, m3uSeriesInfo, findM3uEpisodeUrl, pareceListaM3uNoDisco, EXTENSOES_DE_LISTA_M3U } from './m3uProtocol'
import { lerCanaisM3uDoDisco } from './m3uDiskSource'
import { decifrarBackupDoCelular } from './mobileBackupCrypto'
import { cachedM3uDocument, resetM3uDocumentCache } from './m3uCache'
import { normalizeMac, stalkerChannelsToLiveStreams, stalkerGenresToCategories, stalkerVodToStreams, stalkerVodCategories, stalkerSeriesToList, stalkerSeriesCategories, stalkerSeriesInfo, parseStalkerEpisodeId, STALKER_SENTINEL } from './stalkerProtocol'
import { StalkerClient, resolvePortal } from './stalkerClient'
import log from './logger'
import { EXTENSOES_DE_LEGENDA } from './mpvProtocol'
// Import ESTÁTICO de propósito — e a versão dinâmica custou caro.
//
// Um `await import('./mpvPlayer')` aqui dentro faz o bundler partir o main:
// o `electron/store.ts` sai do main.js e vira um pedaço separado
// (`store-*.js`, 284 kB). O problema não é o tamanho, é a ORDEM: main.ts
// importa './e2eUserData' primeiro de propósito, porque o store resolve
// `app.getPath('userData')` no carregamento do módulo — mas a ordem dos
// imports entre pedaços não é a ordem do código-fonte.
//
// Resultado: o store apontava para o userData errado e o app abria na tela de
// boas-vindas, como se não houvesse conta cadastrada. 78 dos 100 testes e2e
// falharam com "elemento não encontrado" e nada no log dizia o porquê.
import { esconderMpvParaDialogo } from './mpvPlayer'
// Store for window state (for custom maximize)
let savedWindowBounds: Electron.Rectangle | null = null

/**
 * Shared SWR body for the six catalog endpoints: instant repeat visits from
 * the disk cache (15 min TTL) + stale fallback when the provider errors.
 */
/**
 * A lista de disco só é lida se ela ESTIVER CADASTRADA como playlist.
 *
 * Sem esta checagem, o roteador logo abaixo vira um leitor de arquivo
 * alcançável pelo renderer: `playlists:import-mobile` aceita `url` como string
 * qualquer, e bastaria cadastrar um caminho e trocar de playlist. É a mesma
 * classe de ponte que o #405 removeu ao apagar o `fetch-url`.
 *
 * Cadastrar um caminho, por sua vez, só acontece por `playlists:add-m3u-file`,
 * onde quem escolhe o arquivo é a pessoa, no diálogo do sistema.
 */
function listaDeDiscoCadastrada(caminho: string): boolean {
    return listPublicPlaylists().some(p => p.type === 'm3u' && p.url === caminho)
}

/** Download + parse an M3U document (shared by add and the SWR fetcher). */
async function fetchM3uChannels(url: string) {
    // Arquivo do computador: mesmo parse, outro transporte.
    if (pareceListaM3uNoDisco(url)) {
        if (!listaDeDiscoCadastrada(url)) {
            throw new Error('Esta lista não está cadastrada — abra-a por Configurações → Playlists')
        }
        const fs = await import('fs/promises')
        return lerCanaisM3uDoDisco(url, {
            stat: async (caminho) => ({ size: (await fs.stat(caminho)).size }),
            readFile: (caminho) => fs.readFile(caminho),
        })
    }
    // One retry for transient failures — a momentary 502 on first boot (no
    // SWR cache yet) otherwise means an empty catalog.
    const response = await requestWithRetry(async () => axios.get(url, {
        timeout: 20000,
        responseType: 'text',
        transformResponse: [(data: unknown) => data],
        httpsAgent: await resolveProviderHttpsAgent(url, url),
        // Teto de tamanho: sem isto o provedor derruba o processo principal
        // devolvendo alguns GB — a M3U é bufferizada inteira antes de validar.
        maxContentLength: M3U_MAX_BYTES,
        maxBodyLength: M3U_MAX_BYTES
    }))
    const text = String(response.data ?? '')
    if (!looksLikeM3u(text)) {
        throw new Error('A URL não devolveu uma lista M3U válida')
    }
    const channels = parseM3u(text)
    if (channels.length === 0) {
        throw new Error('Lista M3U sem canais')
    }
    return channels
}

/**
 * 🚀 R5: leituras de catálogo M3U passam por aqui. `fetchM3uChannels` continua
 * cru só onde o download É o teste (adicionar/ativar playlist, diagnóstico).
 */
function m3uDocument(url: string, forceRefresh: boolean = false) {
    return cachedM3uDocument(url, () => fetchM3uChannels(url), { forceRefresh })
}

async function catalogListHandler(
    kind: CatalogKind,
    method: 'getLiveStreams' | 'getVODStreams' | 'getSeries' | 'getLiveCategories' | 'getVodCategories' | 'getSeriesCategories',
    payload?: { forceRefresh?: boolean }
) {
    try {
        const auth = store.get('auth')
        if (!auth.url || !auth.username || !auth.password) {
            return { success: false, error: 'Not authenticated' }
        }
        const playlistId = getActivePlaylistIdPublic() ?? 'default'

        // Listas M3U: os seis kinds saem do mesmo documento parseado, que
        // `classifyM3uChannels` (m3uProtocol.ts) divide em live / vod / series.
        const activeEntry = playlistId !== 'default' ? findPlaylist(playlistId) : undefined
        if (activeEntry?.type === 'm3u') {
            const result = await cachedCatalogFetch(
                playlistId,
                kind,
                async () => {
                    // Um download por janela de TTL para os SEIS kinds, não seis.
                    const { live, vod, series } = (await m3uDocument(activeEntry.url, payload?.forceRefresh === true)).classified
                    switch (kind) {
                        case 'live': return m3uToLiveStreams(live)
                        case 'live-categories': return m3uCategories(live)
                        case 'vod': return m3uToVodStreams(vod)
                        case 'vod-categories': return m3uCategories(vod)
                        case 'series': return m3uToSeries(series)
                        case 'series-categories': return m3uCategories(series)
                        default: return []
                    }
                },
                payload?.forceRefresh === true
            )
            return { success: true, data: result.data, fromCache: result.fromCache }
        }

        // Stalker portals: live + VOD (phase 2) + series (phase 3), all from
        // the portal API through the same SWR cache.
        if (activeEntry?.type === 'stalker') {
            const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
            const result = await cachedCatalogFetch(
                playlistId,
                kind,
                async () => {
                    switch (kind) {
                        case 'live': return stalkerChannelsToLiveStreams(await stalker.getAllChannels())
                        case 'live-categories': return stalkerGenresToCategories(await stalker.getGenres())
                        case 'vod': return stalkerVodToStreams(await stalker.getVodItems())
                        case 'vod-categories': return stalkerVodCategories(await stalker.getVodCategories())
                        case 'series': return stalkerSeriesToList(await stalker.getSeriesItems())
                        case 'series-categories': return stalkerSeriesCategories(await stalker.getSeriesCategories())
                        default: return []
                    }
                },
                payload?.forceRefresh === true
            )
            return { success: true, data: result.data, fromCache: result.fromCache }
        }

        const client = new XtreamClient(auth.url, auth.username, auth.password)
        const result = await cachedCatalogFetch(
            playlistId,
            kind,
            () => client[method](),
            payload?.forceRefresh === true
        )
        return { success: true, data: result.data, fromCache: result.fromCache }
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
    }
}

type OpenSubtitlesBody = Record<string, unknown> & {
    authToken?: string
}

// Which timeshift URL form the provider accepted this session ('m3u8' = path
// form, 'php' = streaming/timeshift.php). Keyed by base URL so a playlist
// switch re-probes the new provider.
let timeshiftProbeResult: { base: string; form: 'm3u8' | 'php' } | null = null

/**
 * Quick probe of the path-form timeshift URL: GET with a 2s timeout, body
 * discarded. 2xx/3xx means the provider speaks form (a); 4xx/timeout/network
 * error means the caller should use the timeshift.php form instead.
 */
async function probeTimeshiftM3u8(url: string, baseUrl: string): Promise<boolean> {
    try {
        const response = await axios.get(url, {
            timeout: 2000,
            validateStatus: () => true,
            responseType: 'stream',
            httpsAgent: await resolveProviderHttpsAgent(url, baseUrl)
        })
        const body = response.data as { destroy?: () => void } | undefined
        body?.destroy?.()
        return response.status >= 200 && response.status < 400
    } catch {
        return false
    }
}

// OpenSubtitles credentials are the USER's own (Configurações → APIs, saved in
// the store). The env vars remain as a dev-only fallback — packaged apps never
// have them, which is why the old env-only wiring was dead in production.
interface OpenSubtitlesConfig { apiKey: string; username: string; password: string }

function getOpenSubtitlesConfig(): OpenSubtitlesConfig {
    const saved = (store.get('openSubtitles') ?? {}) as Partial<OpenSubtitlesConfig>
    return {
        apiKey: (saved.apiKey || process.env.OPEN_SUBTITLES_API_KEY || '').trim(),
        username: (saved.username || process.env.OPEN_SUBTITLES_USERNAME || '').trim(),
        password: saved.password || process.env.OPEN_SUBTITLES_PASSWORD || '',
    }
}

/**
 * 📺 Índices de XMLTV vivos, por GRUPO de arquivos.
 *
 * Um país tem vários arquivos que **se sobrepõem** — ficar com o primeiro que
 * responde jogava fora até 23 h de grade em centenas de canais. Por isso o
 * índice é do grupo inteiro, com união e dedup.
 *
 * LRU de verdade (o acerto reinsere): com FIFO e o laço do renderer sempre
 * recomeçando no arquivo 1, um cache pequeno dava 100% de miss e ficava mais
 * lento que o código que este índice substitui.
 */
interface IndexEntry { chave: string; index: XmltvIndex }
const xmltvIndexes = new Map<string, IndexEntry>()
/**
 * Teto de grupos vivos = TODOS os que o renderer sabe pedir.
 *
 * O teto nasceu em 2 porque a conta era "o país corrente + o XMLTV do
 * usuário". Não existe "país corrente": o grupo é escolhido POR CANAL pelo
 * nome, e o `user-external` é consultado ANTES de todo canal quando a pessoa
 * configurou um XMLTV. Sobrava 1 slot para os quatro países, então uma grade
 * misturada despejava o grupo do vizinho a cada linha — o mesmo 100% de miss
 * que o comentário acima diz ter sido consertado, só que por falta de slot em
 * vez de por FIFO.
 *
 * Os grupos são os literais de `fetchIndexedChannel` em
 * `src/services/epgService.ts`: user-external, portugal, argentina, usa,
 * brazil. Quem acrescentar um país lá tem que subir este número —
 * `electron/tetoDoIndiceXmltv.test.ts` cobra.
 */
const XMLTV_INDEX_MAX = 5
/** Builds em voo, para 4 canais simultâneos não construírem o mesmo 4 vezes. */
const xmltvBuilding = new Map<string, Promise<XmltvIndex | null>>()

const EPG_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Resposta do `epg:get-cached` — a MESMA para todos que pegam carona. */
type EpgCacheResult =
    | { success: true; data: string; fromCache: boolean; stale?: boolean }
    | { success: false; error: string }

/**
 * Downloads de EPG em voo, por (arquivo, url, modo) — irmão do
 * `xmltvBuilding` acima e do `inFlight` de `catalogCache`/`m3uCache`.
 *
 * Sem ele, a PRIMEIRA abertura do Guia com lista americana baixava os mesmos
 * 10 XMLTV até quatro vezes cada: `fetchIndexedChannel` pede um
 * `epg:get-cached` por arquivo faltante, por canal, e o guia resolve quatro
 * canais ao mesmo tempo (`MAX_CONCURRENT_EPG`). Eram 40 downloads e 40
 * gravações no MESMO arquivo — inclusive por cima de quem estivesse lendo.
 *
 * A url entra na chave porque o cache é invalidado quando ela muda
 * (`epgFileStatus`): dois pedidos do mesmo `cacheKey` com urls diferentes são
 * downloads diferentes e não podem virar um só.
 *
 * O `forceRefresh` entra na chave, ao contrário do que `catalogCache` e
 * `m3uCache` fazem, e a diferença é de propósito: lá a promessa em voo é
 * SEMPRE uma ida ao provedor, então um pedido forçado ganha o mesmo dado
 * pegando carona; aqui ela pode terminar servindo o arquivo do disco, e um
 * refresh forçado que recebesse isso não teria forçado nada. Hoje o único
 * chamador de produção manda sempre `false`, então na prática é de graça.
 */
const epgBaixando = new Map<string, Promise<EpgCacheResult>>()

/**
 * `rename` com retentativa curta.
 *
 * No Windows, renomear POR CIMA de um destino que outro handle tem aberto
 * volta EPERM/EACCES/EBUSY — e o destino aqui é justamente o `.xml` que
 * `getGroupIndex` lê (e que o antivírus abre assim que ele aparece). Sem a
 * espera, um leitor no meio do caminho derrubaria o download inteiro.
 */
async function renomearComRetentativa(
    fsp: typeof import('fs/promises'),
    origem: string,
    destino: string,
    tentativas = 5,
): Promise<void> {
    for (let i = 1; ; i++) {
        try {
            await fsp.rename(origem, destino)
            return
        } catch (erro: unknown) {
            const codigo = (erro as NodeJS.ErrnoException)?.code
            const espera = codigo === 'EPERM' || codigo === 'EACCES' || codigo === 'EBUSY'
            if (!espera || i >= tentativas) throw erro
            await new Promise(resolve => setTimeout(resolve, 20 * i))
        }
    }
}

/** Arquivo + meta de um cacheKey. `null` quando não existe ou está vencido. */
async function epgFileStatus(cacheKey: string, url: string): Promise<{ file: string; stamp: string } | null> {
    // Chave torta não tem arquivo — e não pode virar caminho (epgCacheGuard.ts).
    if (!cacheKeyValido(cacheKey)) return null
    const fs = await import('fs/promises')
    const path = await import('path')
    const { app } = await import('electron')
    const dir = path.join(app.getPath('userData'), 'epg_cache')
    const file = path.join(dir, `${cacheKey}.xml`)
    try {
        const stat = await fs.stat(file)
        const meta = JSON.parse(await fs.readFile(path.join(dir, `${cacheKey}.meta.json`), 'utf-8'))
        // O TTL e a troca de URL continuam mandando: sem isto o índice serviria
        // um guia vencido para sempre, porque o download só acontece quando
        // alguém diz que o arquivo falta.
        if (typeof meta?.timestamp !== 'number' || Date.now() - meta.timestamp >= EPG_CACHE_TTL_MS) return null
        if (typeof meta?.url === 'string' && meta.url !== url) return null
        return { file, stamp: `${stat.mtimeMs}` }
    } catch {
        return null
    }
}

/**
 * O download de um XMLTV para `epg_cache/<cacheKey>.xml`.
 *
 * Corpo do `epg:get-cached`, extraído para o handler poder ser uma casca
 * fina sobre o mapa de downloads em voo (`epgBaixando`). A lógica — TTL,
 * fallback para cache velho, teto de bytes — é a mesma de sempre.
 */
async function baixarEpgParaCache(url: string, cacheKey: string, forceRefresh: boolean): Promise<EpgCacheResult> {
    try {
        const fs = await import('fs/promises')
        const path = await import('path')
        const { app } = await import('electron')

        // Get app data directory for cache storage
        const cacheDir = path.join(app.getPath('userData'), 'epg_cache')
        const cacheFile = path.join(cacheDir, `${cacheKey}.xml`)
        const metaFile = path.join(cacheDir, `${cacheKey}.meta.json`)

        // Ensure cache directory exists
        await fs.mkdir(cacheDir, { recursive: true })

        // Check if we have valid cache (downloaded within last 24 hours)
        // Files are cached for 24 hours to avoid unnecessary re-downloads
        const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

        let cacheValid = false
        if (!forceRefresh) {
            try {
                const metaContent = await fs.readFile(metaFile, 'utf-8')
                const meta = JSON.parse(metaContent)
                const cacheAge = Date.now() - meta.timestamp

                if (cacheAge < CACHE_TTL_MS) {
                    // Cache is still valid (within 24 hours)
                    log.info('[EPG Cache] Cache valid, age:', Math.round(cacheAge / 3600000), 'hours')
                    cacheValid = true
                } else {
                    log.info('[EPG Cache] Cache old, downloading fresh (age:', Math.round(cacheAge / 60000), 'min)')
                }
            } catch {
                log.info('[EPG Cache] No cache found, will download fresh')
            }
        } else {
            log.info('[EPG Cache] Force refresh requested')
        }

        // If cache is valid (within 24 hours), return cached data
        if (cacheValid) {
            try {
                const data = await fs.readFile(cacheFile, 'utf-8')
                log.info('[EPG Cache] Returning cached data, length:', data.length)
                return { success: true, data, fromCache: true }
            } catch {
                log.info('[EPG Cache] Cache file read failed, will download fresh')
            }
        }

        // Download fresh data
        log.info('[EPG Cache] Downloading from:', url)
        const fetch = (await import('node-fetch')).default
        const response = await fetchWithRetry(async () => fetch(url, {
            agent: await resolveProviderHttpsAgent(url),
            // Generous: EPG XML files are big; a failure falls back to stale cache.
            signal: AbortSignal.timeout(60000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/xml, text/xml, */*'
            }
        }))

        if (!response.ok) {
            log.error('[EPG Cache] Download failed:', response.status)

            // Try to return stale cache if download fails
            try {
                const data = await fs.readFile(cacheFile, 'utf-8')
                log.info('[EPG Cache] Returning stale cache due to download failure')
                return { success: true, data, fromCache: true, stale: true }
            } catch {
                return { success: false, error: `Download failed: HTTP ${response.status}` }
            }
        }

        const data = await readResponseTextWithLimit(response, XMLTV_MAX_BYTES)
        registerApprovedProviderUrl(response.url || url)
        log.info('[EPG Cache] Downloaded data, length:', data.length)

        // 💾 Grava em temporário e RENOMEIA — os dois arquivos.
        //
        // Escrever direto no destino deixa o `.xml` pela metade quando a
        // gravação morre no meio (disco cheio, app fechado) e por cima de
        // quem estiver lendo. O sufixo aleatório é para dois pedidos do mesmo
        // cacheKey com urls diferentes não disputarem o mesmo temporário.
        const sufixoTmp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`
        const tmpFile = `${cacheFile}.${sufixoTmp}`
        const tmpMeta = `${metaFile}.${sufixoTmp}`
        try {
            await fs.writeFile(tmpFile, data, 'utf-8')
            await fs.writeFile(tmpMeta, JSON.stringify({
                timestamp: Date.now(),
                url: url,
                size: data.length
            }), 'utf-8')
            // O `.xml` primeiro DE PROPÓSITO: uma queda entre os dois renames
            // deixa guia novo com meta velho, e aí `epgFileStatus` devolve
            // null e o arquivo é rebaixado (lado seguro). Na ordem inversa o
            // meta novo apontaria para o XML velho e o app serviria grade
            // vencida como fresca.
            await renomearComRetentativa(fs, tmpFile, cacheFile)
            await renomearComRetentativa(fs, tmpMeta, metaFile)
        } catch (erroDaGravacao: unknown) {
            await fs.rm(tmpFile, { force: true }).catch(() => undefined)
            await fs.rm(tmpMeta, { force: true }).catch(() => undefined)
            throw erroDaGravacao
        }

        log.info('[EPG Cache] Saved to cache:', cacheFile)
        return { success: true, data, fromCache: false }

    } catch (error: unknown) {
        log.error('[EPG Cache] Error:', getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
    }
}

async function getGroupIndex(
    grupo: string,
    arquivos: { file: string; stamp: string }[],
): Promise<XmltvIndex | null> {
    const chave = arquivos.map(a => a.stamp).join('|')
    const vivo = xmltvIndexes.get(grupo)
    if (vivo && vivo.chave === chave) {
        // Reinsere: `Map` mantém ordem de inserção, então isto é o "usado agora".
        xmltvIndexes.delete(grupo)
        xmltvIndexes.set(grupo, vivo)
        return vivo.index
    }
    const emVoo = xmltvBuilding.get(grupo + chave)
    if (emVoo) return emVoo

    const build = (async () => {
        try {
            const fs = await import('fs/promises')
            const t0 = Date.now()
            const index = emptyIndex()
            for (const a of arquivos) {
                addDocumentToIndex(index, await fs.readFile(a.file, 'utf-8'))
            }
            finalizeIndex(index)
            log.info(`[EPG Index] ${grupo}: ${index.total} programas -> ${index.byChannel.size} canais (${Date.now() - t0} ms)`)
            if (xmltvIndexes.size >= XMLTV_INDEX_MAX && !xmltvIndexes.has(grupo)) {
                const lru = xmltvIndexes.keys().next().value
                if (lru !== undefined) xmltvIndexes.delete(lru)
            }
            xmltvIndexes.set(grupo, { chave, index })
            return index
        } catch (error: unknown) {
            log.error('[EPG Index] Falha ao indexar:', getErrorMessage(error))
            return null
        } finally {
            xmltvBuilding.delete(grupo + chave)
        }
    })()
    xmltvBuilding.set(grupo + chave, build)
    return build
}

export function setupIpcHandlers() {
    // Legacy single `auth` entry → multi-playlist model (one-time, idempotent).
    migratePlaylistsOnStartup()

    // Open a URL in the OS browser (never inside the app). Restricted to
    // https so renderer bugs can't shell out to arbitrary protocols.
    ipcMain.handle('shell:open-external', (_e, { url }: { url?: string }) => {
        const target = String(url ?? '')
        if (!/^https:\/\//.test(target)) return { success: false, error: 'URL inválida' }
        void shell.openExternal(target)
        return { success: true }
    })

    // Renderer errors land in main.log so packaged-app bug reports include
    // the UI side, not just the main process.
    ipcMain.on('log:renderer', (_event, payload: { level?: string; message?: string; stack?: string }) => {
        const message = `[Renderer] ${String(payload?.message ?? 'unknown error').slice(0, 2000)}`
        const stack = payload?.stack ? `\n${String(payload.stack).slice(0, 4000)}` : ''
        if (payload?.level === 'warn') log.warn(message + stack)
        else log.error(message + stack)
    })

    // Window controls for custom title bar.
    // A janela é a que PEDIU (fromWebContents), não a focada: PiP e multi-view
    // carregam o mesmo bundle e o mesmo title bar; com uma delas em foco, o X
    // da principal fechava a outra — e elas não passam pela proteção da
    // bandeja, então eram destruídas de verdade.
    ipcMain.handle('window:minimize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (win) win.minimize()
    })

    // Custom maximize that respects taskbar (doesn't use native maximize)
    ipcMain.handle('window:maximize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return

        // If we have saved bounds, we're maximized - restore
        if (savedWindowBounds) {
            win.setBounds(savedWindowBounds)
            savedWindowBounds = null
        } else {
            // Save current bounds and maximize to workArea
            const currentBounds = win.getBounds()
            savedWindowBounds = currentBounds

            const display = screen.getDisplayMatching(currentBounds)
            const workArea = display.workArea

            win.setBounds({
                x: workArea.x,
                y: workArea.y,
                width: workArea.width,
                height: workArea.height
            })
        }
    })

    ipcMain.handle('window:close', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (win) win.close()
    })

    ipcMain.handle('window:is-maximized', () => {
        // Simply check if we have saved bounds (meaning we're in custom maximized state)
        return savedWindowBounds !== null
    })

    ipcMain.handle('auth:login', async (_, { url, username, password, name }) => {
        try {
            const client = new XtreamClient(url, username, password)
            const data = await client.authenticate()

            // Single write path: saves into the playlists model and mirrors
            // the active playlist into the legacy `auth` entry.
            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' ? name : undefined,
                url,
                username,
                password,
                userInfo: data.user_info
            })

            // New provider may have a different (or no) EPG — re-probe lazily.
            resetProviderEpgState()

            return { success: true, data, playlistId: entry.id }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // ---- Multi-playlist management -------------------------------------

    ipcMain.handle('playlists:list', () => {
        return { success: true, playlists: listPublicPlaylists() }
    })

    // Synchronous-ish read of the active playlist id. The renderer namespaces
    // per-profile user-state (favorites / watch progress) by it so stream ids
    // from different providers don't bleed across playlists.
    ipcMain.handle('playlists:get-active-id', () => {
        return { id: getActivePlaylistIdPublic() }
    })

    // 🔗 Ecosystem: accounts from a NeoStream Mobile backup → saved playlists.
    ipcMain.handle('playlists:import-mobile', (_, { accounts }: { accounts: MobileAccountEntry[] }) => {
        try {
            const imported = importMobileAccounts(Array.isArray(accounts) ? accounts : [])
            return { success: true, imported }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:add', async (_, { name, url, username, password }) => {
        try {
            // Same validation as auth:login (player_api authenticate).
            const client = new XtreamClient(url, username, password)
            const data = await client.authenticate()

            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' ? name : undefined,
                url,
                username,
                password,
                userInfo: data.user_info
            })
            resetProviderEpgState()

            return { success: true, playlistId: entry.id, userInfo: data.user_info }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Lista M3U por URL. O catálogo inteiro (canais, filmes e séries) sai
    // dela — ver o desvio M3U do `catalogListHandler`.
    ipcMain.handle('playlists:add-m3u', async (_, { name, url }) => {
        try {
            // O regex fica, mesmo com o app sabendo ler lista de arquivo: este
            // handler recebe string do RENDERER, e aceitar caminho de disco aqui
            // daria a um renderer comprometido um leitor de arquivo no processo
            // principal. Arquivo entra só pelo `playlists:add-m3u-file`, onde
            // quem escolhe é a pessoa, no diálogo do sistema.
            const m3uUrl = String(url ?? '').trim()
            if (!/^https?:\/\//.test(m3uUrl)) {
                return { success: false, error: 'URL inválida' }
            }
            // forceRefresh: adicionar TEM que ir na rede (é a validação da URL),
            // mas o download já fica residente pro catálogo que carrega em seguida.
            const { channels } = await m3uDocument(m3uUrl, true)

            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' && name.trim() ? name.trim() : `M3U (${channels.length} canais)`,
                url: m3uUrl,
                username: 'm3u',
                password: 'm3u',
                type: 'm3u'
            })
            resetProviderEpgState()

            return { success: true, playlistId: entry.id, channelCount: channels.length }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    /**
     * Lista M3U de um arquivo do computador.
     *
     * O renderer NUNCA manda caminho: ele pede, o diálogo do sistema abre com o
     * filtro de extensão que o próprio main define, e o caminho escolhido pela
     * pessoa nasce aqui. Mesmo desenho do `subtitle:open-file`.
     */
    ipcMain.handle('playlists:add-m3u-file', async (_e, payload: { name?: string }) => {
        try {
            // O mpv roda com --ontop e engoliria o diálogo.
            const devolverMpv = esconderMpvParaDialogo()
            let result: Electron.OpenDialogReturnValue
            try {
                result = await dialog.showOpenDialog({
                    title: 'Lista M3U',
                    filters: [{ name: 'Listas M3U', extensions: [...EXTENSOES_DE_LISTA_M3U] }],
                    properties: ['openFile'],
                })
            } finally {
                devolverMpv()
            }
            if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }

            const escolhido = result.filePaths[0]
            // Cinto e suspensório: dá pra digitar caminho à mão no diálogo.
            if (!pareceListaM3uNoDisco(escolhido)) {
                return { success: false, error: 'Escolha um arquivo .m3u ou .m3u8' }
            }

            const path = await import('path')
            const nomeDoArquivo = path.basename(escolhido)
            // Cadastra ANTES de ler: o leitor de disco só aceita caminho que já
            // esteja na lista de playlists (ver listaDeDiscoCadastrada).
            const entry = saveAndActivatePlaylist({
                name: typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : nomeDoArquivo,
                url: escolhido,
                username: 'm3u',
                password: 'm3u',
                type: 'm3u'
            })
            let channelCount = 0
            try {
                channelCount = (await m3uDocument(escolhido, true)).channels.length
            } catch (error) {
                // Arquivo ilegível: desfaz o cadastro pra não deixar uma
                // playlist ativa que nunca vai abrir.
                removePlaylist(entry.id)
                return { success: false, error: getErrorMessage(error) }
            }
            resetProviderEpgState()

            return { success: true, playlistId: entry.id, channelCount, fileName: nomeDoArquivo }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:add-stalker', async (_, { name, url, mac }) => {
        try {
            const normalizedMac = normalizeMac(String(mac ?? ''))
            if (!normalizedMac) {
                return { success: false, error: 'MAC inválido (esperado AA:BB:CC:DD:EE:FF)' }
            }
            const rawUrl = String(url ?? '').trim()
            if (!rawUrl) {
                return { success: false, error: 'URL do portal inválida' }
            }

            const { loadUrl, client } = await resolvePortal(rawUrl, normalizedMac)
            const channels = await client.getAllChannels()

            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' && name.trim() ? name.trim() : `Stalker (${channels.length} canais)`,
                url: loadUrl,
                username: normalizedMac,
                password: STALKER_SENTINEL,
                type: 'stalker'
            })
            resetProviderEpgState()

            return { success: true, playlistId: entry.id, channelCount: channels.length }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Resolve a stalker channel cmd into a playable URL at play time (some
    // portals mint per-play tokenized links via create_link).
    ipcMain.handle('stalker:create-link', async (_, { cmd }: { cmd?: string }) => {
        try {
            const playlistId = getActivePlaylistIdPublic()
            const activeEntry = playlistId ? findPlaylist(playlistId) : undefined
            if (activeEntry?.type !== 'stalker') {
                return { success: false, error: 'Playlist ativa não é Stalker' }
            }
            const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
            const playUrl = await stalker.createLink(String(cmd ?? ''))
            return { success: true, url: playUrl }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:switch', async (_, { id }) => {
        try {
            const target = findPlaylist(String(id))
            if (!target) {
                return { success: false, error: 'Playlist not found' }
            }

            if (target.type === 'm3u') {
                // M3U has no auth endpoint — validate by refetching the list.
                await m3uDocument(target.url, true)
                activatePlaylist(target.id)
                resetProviderEpgState()
                return { success: true }
            }

            if (target.type === 'stalker') {
                // Validate by re-doing the handshake with the stored MAC.
                const stalker = new StalkerClient(target.url, target.username)
                await stalker.handshake()
                activatePlaylist(target.id)
                resetProviderEpgState()
                return { success: true }
            }

            // Revalidate before switching — a dead provider should not take
            // down the current session.
            const client = new XtreamClient(target.url, target.username, target.password)
            const data = await client.authenticate()

            activatePlaylist(target.id, data.user_info)
            // Per-provider main-process state: EPG indexes/caches.
            resetProviderEpgState()

            return { success: true, userInfo: data.user_info }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:remove', (_, { id }) => {
        try {
            invalidatePlaylistCache(String(id))
            // A playlist removida não pode continuar residente no cache do documento.
            resetM3uDocumentCache()
            const outcome = removePlaylist(String(id))
            if (!outcome.removed) {
                return { success: false, error: 'Playlist not found' }
            }
            if (outcome.activeChanged) {
                resetProviderEpgState()
            }
            return {
                success: true,
                loggedOut: outcome.loggedOut,
                newActiveId: outcome.newActive?.id ?? null
            }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:rename', (_, { id, name }) => {
        const renamed = renameStoredPlaylist(String(id), String(name ?? ''))
        return renamed
            ? { success: true }
            : { success: false, error: 'Playlist not found or invalid name' }
    })

    /**
     * ✏️ Editar URL / usuário / senha / MAC de uma playlist salva — POR ID.
     *
     * Não passa pelo `playlists:add`: o upsert casa por (url, username) e
     * criaria outra entrada com id novo, deixando favoritos e progresso (que
     * o renderer guarda por id de playlist) órfãos atrás da entrada velha.
     *
     * Valida com as credenciais NOVAS antes de gravar, do mesmo jeito que o
     * add de cada tipo. Só o nome mudou → não vai à rede. Senha vazia = manter.
     *
     * Quem decide se o renderer recarrega é este handler (`reloadRequired`):
     * o renderer não enxerga a senha, então não sabe se ela mudou.
     */
    ipcMain.handle('playlists:update', async (_, { id, name, url, username, password, mac }) => {
        try {
            const target = findPlaylist(String(id))
            if (!target) {
                return { success: false, error: 'Playlist não encontrada' }
            }
            const type = target.type ?? 'xtream'

            const patch: PlaylistPatch = { name: typeof name === 'string' ? name : undefined }
            const novaUrl = String(url ?? '').trim()
            if (type === 'm3u') {
                // Mesmo portão do add-m3u: string vinda do renderer nunca vira
                // caminho de disco (seria um leitor de arquivo no main). Uma
                // lista de arquivo pode virar lista por URL; nunca outro caminho.
                if (novaUrl && !/^https?:\/\//.test(novaUrl)) {
                    return { success: false, error: 'URL inválida' }
                }
                patch.url = novaUrl || undefined
            } else if (type === 'stalker') {
                const macBruto = String(mac ?? '').trim()
                const normalizedMac = macBruto ? normalizeMac(macBruto) : target.username
                if (!normalizedMac) {
                    return { success: false, error: 'MAC inválido (esperado AA:BB:CC:DD:EE:FF)' }
                }
                patch.url = novaUrl || undefined
                patch.username = normalizedMac
            } else {
                patch.url = novaUrl || undefined
                patch.username = String(username ?? '').trim() || undefined
                patch.password = typeof password === 'string' && password ? password : undefined
            }

            const diff = diffPlaylistPatch(target, patch)
            const credencialMudou = diff.urlChanged || diff.usernameChanged || diff.passwordChanged
            if (!diff.nameChanged && !credencialMudou) {
                return { success: true, changed: false }
            }

            if (credencialMudou) {
                const urlAlvo = patch.url ?? target.url
                if (type === 'm3u') {
                    // O documento residente é da URL antiga: solta antes de
                    // baixar, pra que o download da validação já fique
                    // residente pro catálogo que carrega em seguida.
                    resetM3uDocumentCache()
                    await m3uDocument(urlAlvo, true)
                } else if (type === 'stalker') {
                    // Como no add: o usuário cola o host pelado e o portal
                    // resolvido é o que fica gravado. Re-resolver a URL atual
                    // é idempotente (o load.php gravado é o primeiro candidato).
                    const { loadUrl } = await resolvePortal(urlAlvo, patch.username ?? target.username)
                    patch.url = loadUrl
                } else {
                    const client = new XtreamClient(urlAlvo, patch.username ?? target.username, patch.password ?? target.password)
                    const data = await client.authenticate()
                    patch.userInfo = data.user_info
                }
            }

            const outcome = updateStoredPlaylist(target.id, patch)
            if (!outcome.updated) {
                if (outcome.reason === 'duplicate') {
                    return { success: false, error: 'Já existe uma playlist com esta URL e usuário' }
                }
                if (outcome.reason === 'unchanged') {
                    return { success: true, changed: false }
                }
                return { success: false, error: 'Playlist não encontrada' }
            }

            // O cache de catálogo é por ID e serve do disco por 15 min sem ir à
            // rede — com o id preservado, o renderer receberia o catálogo do
            // provedor VELHO depois do reload. Mesmos três resets do remove/switch.
            if (outcome.credentialsChanged) {
                invalidatePlaylistCache(target.id)
                if (outcome.isActive) resetProviderEpgState()
            }

            return {
                success: true,
                changed: true,
                reloadRequired: outcome.isActive && outcome.credentialsChanged
            }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('auth:check', () => {
        const auth = store.get('auth')
        if (auth.url && auth.username && auth.password) {
            return { authenticated: true, user: auth.userInfo }
        }
        return { authenticated: false }
    })

    // A verdade sobre a expiração mora no PROVEDOR, não no retrato tirado no
    // cadastro: o banner "sua lista expirou" disparava com lista renovada
    // porque o exp_date guardado nunca era reconferido. Este handler devolve
    // userInfo confirmado há menos de 6h — reconferindo na rede se preciso —
    // e, sem rede, devolve falha: melhor banner nenhum do que banner mentiroso.
    ipcMain.handle('auth:refresh-user-info', async () => {
        const active = getActivePlaylist()
        if (!active || (active.type ?? 'xtream') !== 'xtream') {
            return { success: false, reason: 'no-xtream-account' }
        }
        if (isUserInfoFresh(active.userInfoAt, Date.now())) {
            return { success: true, user: active.userInfo }
        }
        try {
            const client = new XtreamClient(active.url, active.username, active.password)
            const data = await client.authenticate()
            refreshActiveUserInfo(data.user_info)
            return { success: true, user: data.user_info }
        } catch (error: unknown) {
            return { success: false, reason: 'network', error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('auth:get-credentials', () => {
        const auth = store.get('auth')
        if (auth.url && auth.username && auth.password) {
            return { success: true, credentials: { url: auth.url, username: auth.username, password: auth.password } }
        }
        return { success: false, error: 'Not authenticated' }
    })

    ipcMain.handle('auth:logout', () => {
        // Clears the active playlist + auth mirror; saved playlists are kept.
        deactivatePlaylists()
        resetProviderEpgState()
        resetM3uDocumentCache()
        return { success: true }
    })

    ipcMain.handle('security:get-certificate-settings', () => {
        return { success: true, settings: getCertificateSettings() }
    })

    ipcMain.handle('security:set-allow-invalid-provider-certificates', (_, value: boolean) => {
        return { success: true, settings: setAllowInvalidProviderCertificates(Boolean(value)) }
    })

    ipcMain.handle('security:forget-trusted-certificate-domains', () => {
        return { success: true, settings: forgetTrustedCertificateDomains() }
    })

    // Get content counts
    /**
     * Quantos canais/filmes/séries a lista tem (cartões da Home e resumo do
     * cadastro).
     *
     * Passa pelos MESMOS três `catalogListHandler` dos `streams:get-*`, em vez
     * de falar direto com o XtreamClient: é o que dá a contagem certa em M3U e
     * Stalker (o espelho `auth` dessas listas não é credencial Xtream) e o que
     * faz a contagem aquecer o cache que o dashboard vai ler em seguida, em vez
     * de baixar o catálogo inteiro uma segunda vez. Ver catalogCounts.ts.
     */
    ipcMain.handle('content:get-counts', async () => {
        try {
            const [live, vod, series] = await Promise.all([
                catalogListHandler('live', 'getLiveStreams'),
                catalogListHandler('vod', 'getVODStreams'),
                catalogListHandler('series', 'getSeries')
            ])
            return contagensDoCatalogo(live, vod, series)
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get live streams
    ipcMain.handle('streams:get-live', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('live', 'getLiveStreams', payload))

    // Get VOD streams
    ipcMain.handle('streams:get-vod', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('vod', 'getVODStreams', payload))

    // Get series
    ipcMain.handle('streams:get-series', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('series', 'getSeries', payload))

    // Get live TV categories
    ipcMain.handle('categories:get-live', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('live-categories', 'getLiveCategories', payload))

    // Get VOD categories
    ipcMain.handle('categories:get-vod', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('vod-categories', 'getVodCategories', payload))

    // Get series categories  
    ipcMain.handle('categories:get-series', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('series-categories', 'getSeriesCategories', payload))

    // Fetch EPG from meuguia.tv (bypasses CORS)
    ipcMain.handle('epg:fetch-meuguia', async (_, channelSlug: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            // URL encode the channel slug to handle spaces
            const encodedSlug = encodeURIComponent(channelSlug)
            const url = `https://meuguia.tv/programacao/canal/${encodedSlug}`
            log.info('[EPG IPC] Fetching:', url)
            // Timeout per try + one retry for transient failures (DNS blip, 502).
            const response = await fetchWithRetry(() => fetch(url, { signal: AbortSignal.timeout(15000) }))
            // Com teto: `.text()` materializava o corpo inteiro no main (ver httpLimits.ts).
            const html = await readResponseTextWithLimit(response, JSON_MAX_BYTES)
            log.info('[EPG IPC] Response length:', html.length)
            return { success: true, html }
        } catch (error: unknown) {
            log.error('[EPG IPC] Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Fetch EPG from mi.tv async API (returns pre-rendered content)
    ipcMain.handle('epg:fetch-mitv', async (_, channelSlug: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            // Use the async API endpoint that returns rendered HTML content
            const url = `https://mi.tv/br/async/channel/${channelSlug}/-300`
            log.info('[EPG IPC] Fetching mi.tv async API:', url)
            const response = await fetchWithRetry(() => fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            }))

            if (!response.ok) {
                log.info('[EPG IPC] mi.tv returned:', response.status)
                return { success: false, error: `HTTP ${response.status}` }
            }

            // Com teto: `.text()` materializava o corpo inteiro no main (ver httpLimits.ts).
            const html = await readResponseTextWithLimit(response, JSON_MAX_BYTES)
            log.info('[EPG IPC] mi.tv Response length:', html.length)
            return { success: true, html }
        } catch (error: unknown) {
            log.error('[EPG IPC] mi.tv Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // EPG Cache System - Downloads EPG XML files on app start
    // Downloads fresh on every app restart, caches during session only
    ipcMain.handle('epg:get-cached', async (_, { url, cacheKey, forceRefresh = false }): Promise<EpgCacheResult> => {
        // 🧱 Antes de tudo: o cacheKey vira NOME DE ARQUIVO lá dentro, e
        // `path.join` normaliza sem confinar — ver epgCacheGuard.ts.
        if (!cacheKeyValido(cacheKey)) return { success: false, error: 'cacheKey inválido' }

        // 🔁 Um download por (arquivo, url, modo): quem chega no meio pega
        // carona na MESMA promessa em vez de abrir outra conexão e gravar por
        // cima. Ver `epgBaixando`.
        const emVooChave = `${cacheKey}\n${String(url)}\n${forceRefresh ? 1 : 0}`
        const emVoo = epgBaixando.get(emVooChave)
        if (emVoo) return emVoo

        const trabalho = baixarEpgParaCache(String(url), cacheKey, Boolean(forceRefresh))
            .finally(() => {
                if (epgBaixando.get(emVooChave) === trabalho) epgBaixando.delete(emVooChave)
            })
        epgBaixando.set(emVooChave, trabalho)
        return trabalho
    })

    /**
     * 📺 Programas de UM canal, a partir do índice do XMLTV.
     *
     * O `epg:get-cached` acima devolve o documento INTEIRO — e o renderer
     * rodava um regex global nele só pra achar um canal, a cada zap e a cada
     * 60 s. Com o guia dos EUA (297 mil blocos de programa em 10 arquivos)
     * isso custava centenas de MB e até 2 s de thread travada por troca de
     * canal. Aqui o documento é indexado UMA vez por arquivo e só os programas
     * pedidos atravessam o IPC.
     *
     * O índice é invalidado pelo mtime do arquivo, então o refresh de 24 h do
     * `epg:get-cached` continua mandando — sem segunda política de validade.
     */
    /**
     * 📺 Programas de UM canal, a partir do índice do grupo de arquivos.
     *
     * O `epg:get-cached` devolve o documento INTEIRO — e o renderer rodava um
     * regex global nele só pra achar um canal, a cada zap e a cada 60 s. Com o
     * guia dos EUA (297 mil blocos de programa em 10 arquivos) isso custava
     * centenas de MB e até 2 s de thread travada por troca de canal.
     *
     * `arquivos` é o GRUPO inteiro do país: eles se sobrepõem, então parar no
     * primeiro que responde perderia grade. `indexed:false` significa "algum
     * arquivo falta ou venceu" — aí o renderer manda baixar e pergunta de novo.
     */
    ipcMain.handle('epg:channel-programs', async (_, args: {
        grupo: string
        arquivos: { url: string; cacheKey: string }[]
        epgChannelId?: string
        channelName?: string
    }) => {
        try {
            const status = await Promise.all(args.arquivos.map(a => epgFileStatus(a.cacheKey, a.url)))
            const faltando = args.arquivos.filter((_a, i) => !status[i]).map(a => a.cacheKey)
            const prontos = status.filter((x): x is { file: string; stamp: string } => !!x)
            // Sem NENHUM arquivo válido não há o que indexar. Com alguns, serve
            // o que tem e avisa quais faltam — a grade parcial é melhor que nada
            // enquanto o download acontece.
            if (!prontos.length) return { success: true, programs: [], indexed: false, faltando }

            const index = await getGroupIndex(args.grupo, prontos)
            if (!index) return { success: true, programs: [], indexed: false, faltando }
            return {
                success: true,
                programs: lookupChannel(index, { epgChannelId: args.epgChannelId, channelName: args.channelName }),
                indexed: true,
                faltando,
            }
        } catch (error: unknown) {
            log.error('[EPG Index] Falhou:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('streams:get-vod-url', async (_, { streamId, container }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            // M3U playlists: the movie's own URL is the stream URL.
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u') {
                const vod = m3uToVodStreams((await m3uDocument(activeEntry.url)).classified.vod)
                const movie = vod.find(v => v.stream_id === Number(streamId))
                if (!movie) return { success: false, error: 'Filme não encontrado na lista M3U' }
                registerApprovedProviderUrl(movie.direct_source, activeEntry.url)
                return { success: true, url: movie.direct_source }
            }

            // Stalker: find the movie in the (cached) VOD list, then mint the
            // playable URL via create_link (type=vod).
            if (activeEntry?.type === 'stalker') {
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                const cached = await cachedCatalogFetch(
                    activeId ?? 'default',
                    'vod',
                    async () => stalkerVodToStreams(await stalker.getVodItems()),
                    false
                )
                const vod = cached.data as ReturnType<typeof stalkerVodToStreams>
                const movie = vod.find(v => v.stream_id === Number(streamId))
                if (!movie) return { success: false, error: 'Filme não encontrado no portal' }
                const url = await stalker.createLink(movie.direct_source, 'vod')
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const containerExt = container || 'mp4'
            const url = client.getVodStreamUrl(Number(streamId), containerExt)
            registerApprovedProviderUrl(url, auth.url)

            return { success: true, url }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get series episode stream URL
    ipcMain.handle('streams:get-series-url', async (_, { streamId, container }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            // M3U: the episode id maps back to an item in the parsed list.
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u') {
                const { series } = (await m3uDocument(activeEntry.url)).classified
                const url = findM3uEpisodeUrl(series, Number(streamId))
                if (!url) return { success: false, error: 'Episódio não encontrado na lista M3U' }
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            // Stalker: composite episode id -> season cmd + create_link(series=N).
            const stalkerEpisode = parseStalkerEpisodeId(String(streamId))
            if (stalkerEpisode && activeEntry?.type === 'stalker') {
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                const seasons = await stalker.getSeasons(stalkerEpisode.portalSeriesId)
                const season = seasons.find(item => item.id === stalkerEpisode.seasonId)
                if (!season) return { success: false, error: 'Temporada não encontrada no portal' }
                const url = await stalker.createLink(season.cmd, 'vod', stalkerEpisode.episode)
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const url = client.getSeriesStreamUrl(streamId, container || 'mp4')
            registerApprovedProviderUrl(url, auth.url)

            return { success: true, url }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Series info (seasons/episodes). Xtream: proxied get_series_info (uses
    // the provider HTTPS agent, unlike the old renderer-side fetch); M3U:
    // built from the parsed list (SxxEyy grouping).
    ipcMain.handle('series:get-info', async (_, { seriesId }: { seriesId?: number | string }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u') {
                // 🚀 R5: era `fetchM3uChannels` direto — abrir CADA ficha de série
                // baixava a M3U inteira (teto de 50 MB) e reparseava tudo.
                const { series } = (await m3uDocument(activeEntry.url)).classified
                return { success: true, info: m3uSeriesInfo(series, Number(seriesId)) }
            }
            if (activeEntry?.type === 'stalker') {
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                const cached = await cachedCatalogFetch(
                    activeId ?? 'default',
                    'series',
                    async () => stalkerSeriesToList(await stalker.getSeriesItems()),
                    false
                )
                const list = cached.data as ReturnType<typeof stalkerSeriesToList>
                const target = list.find(item => item.series_id === Number(seriesId))
                if (!target) return { success: false, error: 'Série não encontrada no portal' }
                const seasons = await stalker.getSeasons(target.portal_id)
                return { success: true, info: stalkerSeriesInfo(target.portal_id, seasons) }
            }

            const base = String(auth.url).replace(/\/$/, '')
            const infoUrl = `${base}/player_api.php?username=${encodeURIComponent(auth.username)}&password=${encodeURIComponent(auth.password)}&action=get_series_info&series_id=${encodeURIComponent(String(seriesId ?? ''))}`
            const response = await axios.get(infoUrl, {
                timeout: 15000,
                httpsAgent: await resolveProviderHttpsAgent(infoUrl, base)
            })
            return { success: true, info: response.data }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get live stream URL
    ipcMain.handle('streams:get-live-url', async (_, { streamId }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            // M3U/Stalker: the channel entry carries what playback needs
            // (direct URL / portal cmd) — resolve from the cached live list so
            // multi-view and PiP zap work on every playlist type.
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u' || activeEntry?.type === 'stalker') {
                const cached = await cachedCatalogFetch(
                    activeId ?? 'default',
                    'live',
                    async () => activeEntry.type === 'm3u'
                        ? m3uToLiveStreams((await m3uDocument(activeEntry.url)).classified.live)
                        : stalkerChannelsToLiveStreams(await new StalkerClient(activeEntry.url, activeEntry.username).getAllChannels()),
                    false
                )
                const streams = cached.data as { stream_id: number; direct_source: string }[]
                const channel = streams.find(s => s.stream_id === Number(streamId))
                if (!channel?.direct_source) {
                    return { success: false, error: 'Canal não encontrado na playlist ativa' }
                }
                const url = activeEntry.type === 'stalker'
                    ? await new StalkerClient(activeEntry.url, activeEntry.username).createLink(channel.direct_source)
                    : channel.direct_source
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const url = client.getLiveStreamUrl(streamId)
            registerApprovedProviderUrl(url, auth.url)

            return { success: true, url }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get catch-up/timeshift (replay) stream URL for an archived program.
    // startIso is the program start in ISO-8601 (UTC); the provider expects
    // its OWN local time, so the start is converted using the UTC offset
    // learned from the provider xmltv (fallback: this machine's offset).
    ipcMain.handle('streams:get-timeshift-url', async (_, { streamId, startIso, durationMin }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const startMs = Date.parse(String(startIso))
            if (Number.isNaN(startMs)) {
                return { success: false, error: 'Invalid start time' }
            }
            const duration = Math.max(1, Math.round(Number(durationMin) || 0))

            // Make sure the xmltv probe ran so the provider offset is known.
            await ensureProviderEpgLoaded()
            const offsetMinutes = getProviderUtcOffsetMinutes() ?? -new Date().getTimezoneOffset()
            const start = formatTimeshiftStart(startMs, offsetMinutes)

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const m3u8Url = client.getTimeshiftM3u8Url(Number(streamId), start, duration)
            const phpUrl = client.getTimeshiftPhpUrl(Number(streamId), start, duration)

            // Session-cached probe: try the path form once; on 4xx/timeout
            // fall back to streaming/timeshift.php for the rest of the session.
            let form = timeshiftProbeResult?.base === auth.url ? timeshiftProbeResult.form : null
            if (!form) {
                form = (await probeTimeshiftM3u8(m3u8Url, auth.url)) ? 'm3u8' : 'php'
                timeshiftProbeResult = { base: auth.url, form }
                log.info('[Timeshift] Probe selected form:', form)
            }

            const url = form === 'm3u8' ? m3u8Url : phpUrl
            const fallbackUrl = form === 'm3u8' ? phpUrl : m3u8Url
            registerApprovedProviderUrl(url, auth.url)
            registerApprovedProviderUrl(fallbackUrl, auth.url)

            return { success: true, url, fallbackUrl, form, offsetMinutes }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // The user's OpenSubtitles credentials (Configurações → APIs). Values come
    // back as saved so the form can prefill — this is the user's own machine
    // and their own account.
    ipcMain.handle('opensubtitles:get-config', () => {
        const saved = (store.get('openSubtitles') ?? {}) as Partial<OpenSubtitlesConfig>
        return {
            success: true,
            apiKey: saved.apiKey || '',
            username: saved.username || '',
            password: saved.password || '',
        }
    })

    ipcMain.handle('opensubtitles:set-config', (_e, raw: Partial<OpenSubtitlesConfig> | undefined) => {
        store.set('openSubtitles', {
            apiKey: String(raw?.apiKey ?? '').trim().slice(0, 200),
            username: String(raw?.username ?? '').trim().slice(0, 200),
            password: String(raw?.password ?? '').slice(0, 200),
        })
        return { success: true }
    })

    // OpenSubtitles API proxy (bypass CORS)
    ipcMain.handle('opensubtitles:request', async (_, { endpoint, method, body }: { endpoint: string; method?: string; body?: OpenSubtitlesBody }) => {
        // Destino primeiro, credencial depois: o host é fixo e o caminho vem
        // de uma lista fechada. Antes havia um ramo de URL absoluta — sem um
        // chamador sequer — que mandava o `Api-Key`/`Bearer` do usuário para
        // onde o renderer quisesse (ver openSubtitlesEndpoint.ts).
        const url = resolverUrlOpenSubtitles(endpoint)
        if (!url) {
            return { success: false, error: 'OpenSubtitles endpoint is not allowed' }
        }
        try {
            const creds = getOpenSubtitlesConfig()
            if (!creds.apiKey) {
                return { success: false, error: 'OpenSubtitles API key is not configured' }
            }
            if (endpoint === '/login' && (!creds.username || !creds.password)) {
                return { success: false, error: 'OpenSubtitles credentials are not configured' }
            }

            const fetch = (await import('node-fetch')).default
            const requestBody = endpoint === '/login'
                ? {
                    ...body,
                    username: creds.username,
                    password: creds.password
                }
                : { ...body }

            const headers: Record<string, string> = {
                'Api-Key': creds.apiKey,
                'Content-Type': 'application/json',
                'User-Agent': 'NeoStream IPTV v2.9.0'
            }

            // Add Authorization header if provided in body
            if (requestBody?.authToken) {
                headers['Authorization'] = `Bearer ${requestBody.authToken}`
                delete requestBody.authToken
            }

            const options: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } = {
                method: method || 'GET',
                headers,
                signal: AbortSignal.timeout(15000)
            }

            if (requestBody && method === 'POST') {
                options.body = JSON.stringify(requestBody)
            }

            log.info(`[OpenSubtitles] ${method} ${endpoint}`)

            const response = await fetch(url, options)
            const data = await response.json()

            return {
                success: response.ok,
                status: response.status,
                data
            }
        } catch (error: unknown) {
            log.error('[OpenSubtitles] Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Save a user-data backup JSON to a file chosen by the user
    ipcMain.handle('backup:save-file', async (_, { json }: { json: string }) => {
        try {
            const date = new Date().toISOString().slice(0, 10)
            const result = await dialog.showSaveDialog({
                title: 'Save backup',
                defaultPath: `neostream-backup-${date}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            })

            if (result.canceled || !result.filePath) {
                return { success: false, canceled: true }
            }

            const fs = await import('fs/promises')
            await fs.writeFile(result.filePath, json, 'utf-8')
            log.info('[Backup] Saved to', result.filePath)
            return { success: true, path: result.filePath }
        } catch (error: unknown) {
            log.error('[Backup] Save error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })


    // 📸 Player frame capture: the renderer draws the current <video> frame
    // on a canvas; main shows the save dialog and writes the PNG bytes.
    ipcMain.handle('player:save-frame', async (_, { dataUrl, name }: { dataUrl?: string; name?: string }) => {
        try {
            const base64 = String(dataUrl ?? '').replace(/^data:image\/png;base64,/, '')
            if (!base64 || /[^A-Za-z0-9+/=]/.test(base64)) {
                return { success: false, error: 'PNG inválido' }
            }
            const safe = String(name ?? 'frame').replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 60) || 'frame'
            const result = await dialog.showSaveDialog({
                title: 'Salvar quadro',
                defaultPath: `${safe}.png`,
                filters: [{ name: 'PNG', extensions: ['png'] }]
            })
            if (result.canceled || !result.filePath) {
                return { success: false, canceled: true }
            }
            const fs = await import('fs/promises')
            await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'))
            return { success: true, path: result.filePath }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    /**
     * Legenda escolhida pelo usuário no disco.
     *
     * `withContent` só é lido quando quem pede precisa do TEXTO (player
     * interno, que desenha a legenda ele mesmo). O caminho do mpv não pede
     * conteúdo nenhum: mandar o arquivo direto pro mpv evita ler e decodificar
     * megabytes à toa — e é o que faz o .ass sair estilizado.
     */
    ipcMain.handle('subtitle:open-file', async (_event, payload: { extensions?: string[]; withContent?: boolean }) => {
        try {
            const pedidas = Array.isArray(payload?.extensions)
                ? payload.extensions.filter(ext => (EXTENSOES_DE_LEGENDA as readonly string[]).includes(ext))
                : []
            // Nunca montar o filtro do diálogo com string crua do renderer.
            const extensions = pedidas.length > 0 ? pedidas : [...EXTENSOES_DE_LEGENDA]

            // O mpv roda com --ontop: sem tirar o vídeo da frente, o diálogo
            // nasce atrás dele e o usuário fica com um botão travado.
            const devolverMpv = esconderMpvParaDialogo()
            let result: Electron.OpenDialogReturnValue
            try {
                result = await dialog.showOpenDialog({
                    title: 'Legenda',
                    filters: [{ name: 'Legendas', extensions }],
                    properties: ['openFile'],
                })
            } finally {
                devolverMpv()
            }
            if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }

            const escolhido = result.filePaths[0]
            const path = await import('path')
            const name = path.basename(escolhido)
            if (!payload?.withContent) return { success: true, name, path: escolhido }

            const fs = await import('fs/promises')
            const info = await fs.stat(escolhido)
            // Legenda de verdade não passa disso; um .txt de 500 MB renomeado,
            // sim — e entraria inteiro na memória e no estado do React.
            if (info.size > 5 * 1024 * 1024) return { success: false, error: 'subtitle file too large' }
            const bytes = await fs.readFile(escolhido)
            // .srt brasileiro antigo costuma vir em windows-1252. Ler tudo como
            // utf-8 viraria lixo nos acentos, e o defeito só apareceria em
            // arquivo velho — passando batido em qualquer teste com UTF-8.
            let content: string
            try {
                content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            } catch {
                content = new TextDecoder('windows-1252').decode(bytes)
            }
            return { success: true, name, path: escolhido, content }
        } catch (error) {
            log.error('[Subtitle] open-file failed:', error)
            return { success: false, error: String(error) }
        }
    })

    // Load a user-data backup JSON from a file chosen by the user
    ipcMain.handle('backup:load-file', async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: 'Open backup',
                filters: [{ name: 'JSON', extensions: ['json'] }],
                properties: ['openFile']
            })

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true }
            }

            const fs = await import('fs/promises')
            const json = await fs.readFile(result.filePaths[0], 'utf-8')
            log.info('[Backup] Loaded from', result.filePaths[0])
            return { success: true, json }
        } catch (error: unknown) {
            log.error('[Backup] Load error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    /**
     * 🔗 Abrir o backup CIFRADO do celular (`NEOENC1:`) com a senha do usuário.
     *
     * Mora no main porque a cifra do celular deriva a chave com MD5, e a Web
     * Crypto do renderer não faz MD5 — ver `mobileBackupCrypto.ts`. O renderer
     * manda o texto que ele já tem em mãos (veio do `backup:load-file`) e a
     * senha; volta o JSON claro, que o parser puro do `crossBackup.ts` lê como
     * se o arquivo nunca tivesse sido cifrado.
     *
     * `ok: false` cobre senha errada e arquivo corrompido sem distinguir os
     * dois — o CBC não autentica nada, então o main não TEM como saber a
     * diferença, e fingir que sabe seria pior que a mensagem genérica.
     */
    ipcMain.handle('backup:decrypt-mobile', (_e, data: { text?: unknown; password?: unknown }) => {
        const texto = typeof data?.text === 'string' ? data.text : ''
        const senha = typeof data?.password === 'string' ? data.password : ''
        // O texto vem de um arquivo que o próprio main leu, mas o canal é
        // alcançável pelo renderer: um teto evita alimentar o base64 com algo
        // absurdo. 8 MB é ordens de grandeza acima de qualquer backup real.
        if (!texto || texto.length > 8 * 1024 * 1024) return { ok: false }
        const json = decifrarBackupDoCelular(texto, senha)
        return json ? { ok: true, json } : { ok: false }
    })

    // 🩺 Verificador de favoritos: sonda uma lista de URLs de stream (GET com
    // o corpo destruído na hora — o 1º byte basta) e devolve vivo/morto por
    // id. Roda aqui no main pra não esbarrar em CORS no renderer.
    ipcMain.handle('diagnostics:probe-urls', async (_e, data: { targets?: { id: string; url: string }[] }) => {
        const targets = (data?.targets ?? []).filter(t => t?.id && t?.url).slice(0, 40)
        const probeOne = async (target: { id: string; url: string }) => {
            try {
                const response = await axios.get(target.url, {
                    timeout: 8000,
                    validateStatus: () => true,
                    responseType: 'stream',
                    // Sem 2º argumento de propósito: o provedor de referência
                    // é o da playlist ATIVA (`auth.url`), o mesmo escopo do
                    // player. Passar a própria `target.url` fazia qualquer host
                    // de uma lista M3U virar "o provedor" — e um "Confiar" no
                    // diálogo desligava o TLS de um domínio alheio pra sempre
                    // (D132). Fora do provedor a sonda valida o TLS normalmente.
                    httpsAgent: await resolveProviderHttpsAgent(target.url)
                })
                const body = response.data as { destroy?: () => void } | undefined
                body?.destroy?.()
                return { id: target.id, alive: response.status >= 200 && response.status < 400 }
            } catch {
                return { id: target.id, alive: false }
            }
        }
        // 4 por vez pra não afogar o provedor.
        const results: { id: string; alive: boolean }[] = []
        for (let i = 0; i < targets.length; i += 4) {
            results.push(...await Promise.all(targets.slice(i, i + 4).map(probeOne)))
        }
        return { success: true, results }
    })

    // Provider health: probe the active provider's endpoints with timings.
    // Com { speedTest: true } também baixa até 8 MB (ou 5 s) de um endpoint
    // grande do provedor e devolve o throughput real em `speed`.
    //
    // Portal Stalker não expõe endpoint de volume e lista M3U de arquivo não
    // passa pela rede: nos dois o velocímetro não tem o que medir. Antes a
    // tela só recebia `speed: null` — a mesma resposta de "o provedor não
    // mandou dados" — e pintava um erro vermelho garantido (D204). Agora
    // { speedSupportOnly: true } responde só se há o que medir, sem tocar a
    // rede (a aba pergunta ao abrir), e { speedTest: true } nessas playlists
    // volta aqui mesmo com `speedSupported: false` + o motivo, em vez de
    // fazer handshake + lista de canais do portal pra devolver null.
    ipcMain.handle('diagnostics:provider-health', async (_evt, opts?: { speedTest?: boolean; speedSupportOnly?: boolean }) => {
        // Non-Xtream playlists get type-appropriate checks: the M3U document
        // itself, or the portal handshake + channel list.
        const activeId = getActivePlaylistIdPublic()
        const activeEntry = activeId ? findPlaylist(activeId) : undefined
        const semVelocimetro: 'stalker' | 'm3u_file' | null = activeEntry?.type === 'stalker'
            ? 'stalker'
            : activeEntry?.type === 'm3u' && pareceListaM3uNoDisco(activeEntry.url) ? 'm3u_file' : null
        if (opts?.speedSupportOnly || (opts?.speedTest && semVelocimetro)) {
            return semVelocimetro
                ? { success: true, speed: null, speedSupported: false, speedUnsupportedReason: semVelocimetro }
                : { success: true, speed: null, speedSupported: true }
        }

        const auth = store.get('auth')
        if (!auth.url || !auth.username || !auth.password) {
            return { success: false, error: 'Not authenticated' }
        }
        const base = String(auth.url).replace(/\/$/, '')
        const creds = `username=${encodeURIComponent(auth.username)}&password=${encodeURIComponent(auth.password)}`

        const probe = async (name: string, url: string) => {
            const startedAt = Date.now()
            try {
                const response = await axios.get(url, {
                    timeout: 8000,
                    validateStatus: () => true,
                    responseType: 'stream',
                    httpsAgent: await resolveProviderHttpsAgent(url, base)
                })
                const body = response.data as { destroy?: () => void } | undefined
                body?.destroy?.()
                return { name, ok: response.status >= 200 && response.status < 400, status: response.status, ms: Date.now() - startedAt }
            } catch (error: unknown) {
                return { name, ok: false, status: null, ms: Date.now() - startedAt, error: getErrorMessage(error) }
            }
        }

        // 🚀 Velocímetro: consome o body (em vez de destruí-lo como o probe)
        // por até 8 MB ou 5 s e mede o throughput. Amostra < 64 KB → null.
        const measureSpeed = async (url: string) => {
            const startedAt = Date.now()
            try {
                const response = await axios.get(url, {
                    timeout: 15000,
                    validateStatus: () => true,
                    responseType: 'stream',
                    httpsAgent: await resolveProviderHttpsAgent(url, base)
                })
                const stream = response.data as NodeJS.ReadableStream & { destroy?: () => void }
                let bytes = 0
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(() => { stream.destroy?.(); resolve() }, 5000)
                    stream.on('data', (chunk: Buffer) => {
                        bytes += chunk.length
                        if (bytes >= 8 * 1024 * 1024) { clearTimeout(timer); stream.destroy?.(); resolve() }
                    })
                    stream.on('end', () => { clearTimeout(timer); resolve() })
                    stream.on('error', () => { clearTimeout(timer); resolve() })
                })
                const seconds = Math.max(0.2, (Date.now() - startedAt) / 1000)
                if (bytes < 64 * 1024) return null
                return { bytes, seconds, mbps: (bytes * 8) / seconds / 1_000_000 }
            } catch {
                return null
            }
        }

        if (activeEntry?.type === 'm3u') {
            const startedAt = Date.now()
            // Lista de arquivo nao tem download: o `probe` e um GET, e reportaria
            // um erro de rede sem sentido pra um caminho de disco. No lugar dele,
            // o que de fato pode dar errado — o arquivo ainda estar la.
            const doDisco = pareceListaM3uNoDisco(activeEntry.url)
            const download = doDisco
                ? await (async () => {
                    try {
                        const fs = await import('fs/promises')
                        const info = await fs.stat(activeEntry.url)
                        return { name: 'm3u_arquivo', ok: true, status: null, ms: Date.now() - startedAt, error: `${Math.round(info.size / 1024)} KB` }
                    } catch {
                        return { name: 'm3u_arquivo', ok: false, status: null, ms: Date.now() - startedAt, error: 'arquivo nao encontrado' }
                    }
                })()
                : await probe('m3u_download', activeEntry.url)
            const parseResult = await fetchM3uChannels(activeEntry.url)
                .then(channels => ({ name: 'm3u_parse', ok: channels.length > 0, status: null, ms: Date.now() - startedAt, error: undefined as string | undefined }))
                .catch((error: unknown) => ({ name: 'm3u_parse', ok: false, status: null, ms: Date.now() - startedAt, error: getErrorMessage(error) as string | undefined }))
            // Medir Mbps de um arquivo local nao quer dizer nada.
            const speed = opts?.speedTest && !doDisco ? await measureSpeed(activeEntry.url) : null
            return { success: true, results: [download, parseResult], speed }
        }

        if (activeEntry?.type === 'stalker') {
            const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
            const timed = async (name: string, run: () => Promise<unknown>) => {
                const startedAt = Date.now()
                try {
                    await run()
                    return { name, ok: true, status: null, ms: Date.now() - startedAt }
                } catch (error: unknown) {
                    return { name, ok: false, status: null, ms: Date.now() - startedAt, error: getErrorMessage(error) }
                }
            }
            const handshake = await timed('stalker_handshake', () => stalker.handshake())
            const channels = handshake.ok
                ? await timed('stalker_channels', () => stalker.getAllChannels())
                : { name: 'stalker_channels', ok: false, status: null, ms: 0, error: 'handshake falhou' }
            return { success: true, results: [handshake, channels], speed: null }
        }

        const results = await Promise.all([
            probe('player_api', `${base}/player_api.php?${creds}`),
            probe('live_streams', `${base}/player_api.php?${creds}&action=get_live_streams`),
            probe('xmltv', `${base}/xmltv.php?${creds}`)
        ])
        const speed = opts?.speedTest
            ? await measureSpeed(`${base}/get.php?${creds}&type=m3u_plus&output=ts`)
            : null
        return { success: true, results, speed }
    })

    // Full playlist entries for the backup file (passwords included — the
    // renderer immediately encodes them into the payload it writes to disk).
    ipcMain.handle('backup:export-playlists', () => {
        try {
            return { success: true, playlists: exportPlaylistsForBackup() }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Restore playlists from a backup (no provider validation — may be offline).
    // `activateIfNone` só vem do primeiro acesso (Welcome): sem playlist ativa,
    // a primeira do arquivo vira a ativa — senão o boot cai no /login (D079).
    ipcMain.handle('backup:import-playlists', (_, { playlists, activateIfNone }: { playlists: PlaylistBackupEntry[]; activateIfNone?: boolean }) => {
        try {
            const { imported, idMap } = importPlaylistsFromBackup(
                Array.isArray(playlists) ? playlists : [],
                { activateIfNone: activateIfNone === true }
            )
            return { success: true, imported, idMap }
        } catch (error: unknown) {
            log.error('[Backup] Playlist import error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Provider EPG (xmltv.php / get_simple_data_table) handlers
    setupProviderEpgHandlers()

    log.info('IPC Handlers initialized')
}
