/**
 * Xtream provider EPG — main process side.
 *
 * Downloads {server}/xmltv.php (24h file cache, same mechanism/dir as
 * 'epg:get-cached'), parses it into an in-memory Map<epg_channel_id,
 * programs> and answers per-channel lookups instantly over IPC. O índice é
 * podado para uma janela em volta do "agora" do parse, então ele VENCE:
 * passado XMLTV_INDEX_TTL_MS a próxima consulta reindexa — do cache em disco,
 * sem download novo enquanto ele estiver dentro das 24h dele.
 * When the provider has no xmltv.php (404/HTML/empty), it is
 * marked unavailable for the session — no retry storms — and per-channel
 * get_simple_data_table is tried as the secondary provider source.
 *
 * Pure parsing helpers live in providerEpgProtocol.ts (unit-tested).
 */
import { ipcMain } from 'electron'
import store from './store'
import axios from 'axios'
import { findPlaylist, getActivePlaylistIdPublic } from './playlistManager'
import { parseM3uHeader, pareceListaM3uNoDisco, decodeM3uBytes } from './m3uProtocol'
import { fetchWithRetry } from './fetchRetry'
import log from './logger'
import { resolveProviderHttpsAgent, registerApprovedProviderUrl } from './certificatePolicy'
import { readResponseTextWithLimit, XMLTV_MAX_BYTES, JSON_MAX_BYTES } from './httpLimits'
import {
    buildSimpleDataTableUrl,
    buildXmltvUrl,
    looksLikeXmltv,
    lookupProviderEpgChannel,
    parseSimpleDataTable,
    parseXmltvIndexWithMetaAsync,
    searchEpgIndex,
} from './providerEpgProtocol'
import type { ProviderEpgProgram, XmltvChannelNames, XmltvIndexResult } from './providerEpgProtocol'
import { getErrorMessage } from './errorMessage'

const XMLTV_CACHE_KEY_PREFIX = 'provider-xmltv'
const XMLTV_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const SIMPLE_TABLE_TTL_MS = 60 * 60 * 1000
/**
 * Idade máxima do índice em memória antes de reindexar.
 *
 * O índice é PODADO no instante do parse para [agora-24h, agora+48h]
 * (PROVIDER_EPG_*_WINDOW_MS em providerEpgProtocol.ts) e o Guia oferece até
 * agora+36h (WINDOW_MAX_OFFSET_MS em src/utils/epgGuide.ts). Num PC de sala
 * que fica dias ligado, 12h depois do boot a borda futura do Guia já cai fora
 * do índice e o pulo de dia mostra tela vazia. Reindexar a cada 6h mantém
 * sempre >= 42h à frente, e dentro das 24h do cache em disco a reindexação é
 * leitura de arquivo + parse — não vira tempestade de download.
 */
const XMLTV_INDEX_TTL_MS = 6 * 60 * 60 * 1000
const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/xml, text/xml, application/json, */*'
}

type Availability = 'unknown' | 'ready' | 'unavailable'

interface Credentials {
    url: string
    username: string
    password: string
}

let xmltvAvailability: Availability = 'unknown'
let xmltvIndex: Map<string, ProviderEpgProgram[]> | null = null
// Os <channel> do MESMO XMLTV do índice acima (nome -> id, ids declarados).
// Publicados sempre junto com ele, em publishXmltvIndex (#D036).
let xmltvNames: XmltvChannelNames = { nameToId: new Map(), declaredIds: new Set() }
// Fim da rodada que produziu o `xmltvIndex` no ar (0 = nunca rodou). A janela
// podada dentro dele é relativa a ESSE instante — por isso ele tem validade.
let xmltvIndexedAt = 0
let xmltvLoading: Promise<void> | null = null
// Carimbo da rodada de indexação. O download e o parse cedem o event loop, e
// uma troca de playlist no meio deles invalida tudo: sem esta checagem, a
// rodada antiga publicava o guia do provedor ANTIGO por cima do novo.
let xmltvGeneration = 0
// Provider's local UTC offset (minutes) learned from the xmltv timestamps —
// used to format timeshift (catch-up) start strings in provider-local time.
let providerUtcOffsetMinutes: number | null = null

// get_simple_data_table fallback — disabled for the session on first hard failure.
let simpleTableAvailable = true
const simpleTableCache = new Map<number, { at: number; programs: ProviderEpgProgram[] }>()

function getCredentials(): Credentials | null {
    const auth = store.get('auth')
    if (auth.url && auth.username && auth.password) {
        return { url: auth.url, username: auth.username, password: auth.password }
    }
    return null
}

/** Reset all session state (e.g. after switching providers). Exported for tests/future use. */
export function resetProviderEpgState() {
    xmltvGeneration++
    xmltvAvailability = 'unknown'
    xmltvIndex = null
    xmltvNames = { nameToId: new Map(), declaredIds: new Set() }
    xmltvIndexedAt = 0
    xmltvLoading = null
    providerUtcOffsetMinutes = null
    simpleTableAvailable = true
    simpleTableCache.clear()
}

/**
 * The provider's local UTC offset (minutes) as seen in its xmltv timestamps,
 * or null when unknown (no xmltv / no offsets). Callers should fall back to
 * the local machine offset.
 */
export function getProviderUtcOffsetMinutes(): number | null {
    return providerUtcOffsetMinutes
}

/**
 * Triggers the xmltv probe (no-op if already done) so the offset above gets
 * populated before building a timeshift start string.
 */
export function ensureProviderEpgLoaded(): Promise<void> {
    return ensureXmltvIndex()
}

/**
 * Download xmltv.php through the same 24h file cache used by 'epg:get-cached'
 * (userData/epg_cache, cacheKey 'provider-xmltv'). Returns null on failure.
 */
async function fetchXmltvWithCache(url: string): Promise<string | null> {
    const fs = await import('fs/promises')
    const path = await import('path')
    const crypto = await import('crypto')
    const { app } = await import('electron')

    // Per-provider cache key (multi-playlist): hashing the full xmltv URL
    // (host + credentials) keeps each provider's EPG file separate, so
    // switching playlists never serves another provider's cached guide.
    const urlHash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
    const cacheKey = `${XMLTV_CACHE_KEY_PREFIX}-${urlHash}`

    const cacheDir = path.join(app.getPath('userData'), 'epg_cache')
    const cacheFile = path.join(cacheDir, `${cacheKey}.xml`)
    const metaFile = path.join(cacheDir, `${cacheKey}.meta.json`)
    await fs.mkdir(cacheDir, { recursive: true })

    // Within TTL → reuse the cached file, never re-download.
    try {
        const meta = JSON.parse(await fs.readFile(metaFile, 'utf-8'))
        if (Date.now() - meta.timestamp < XMLTV_CACHE_TTL_MS) {
            const cached = await fs.readFile(cacheFile, 'utf-8')
            log.info('[Provider EPG] Using cached xmltv, age:',
                Math.round((Date.now() - meta.timestamp) / 3600000), 'h, length:', cached.length)
            return cached
        }
        log.info('[Provider EPG] Cache expired, downloading fresh xmltv')
    } catch {
        log.info('[Provider EPG] No xmltv cache, downloading fresh')
    }

    try {
        const fetch = (await import('node-fetch')).default
        const response = await fetchWithRetry(async () => fetch(url, {
            agent: await resolveProviderHttpsAgent(url),
            // Generous: provider xmltv files are big; failure falls back to stale cache.
            signal: AbortSignal.timeout(60000),
            headers: FETCH_HEADERS
        }))

        if (!response.ok) {
            log.warn('[Provider EPG] xmltv download failed: HTTP', response.status)
            return await readStaleCache(fs, cacheFile)
        }

        // Teto de tamanho: o XMLTV é materializado inteiro no processo
        // principal ANTES de `looksLikeXmltv`, então um corpo gigante do
        // provedor estouraria a heap — e o probe roda no boot.
        const data = await readResponseTextWithLimit(response, XMLTV_MAX_BYTES)
        registerApprovedProviderUrl(response.url || url)
        log.info('[Provider EPG] Downloaded xmltv, length:', data.length)

        // Only cache plausible XMLTV — caching an HTML error page for 24h
        // would mask the provider coming back.
        if (looksLikeXmltv(data)) {
            await fs.writeFile(cacheFile, data, 'utf-8')
            await fs.writeFile(metaFile, JSON.stringify({ timestamp: Date.now(), size: data.length }), 'utf-8')
        }
        return data
    } catch (error) {
        log.warn('[Provider EPG] xmltv download error:', getErrorMessage(error))
        return await readStaleCache(fs, cacheFile)
    }
}

async function readStaleCache(fs: typeof import('fs/promises'), cacheFile: string): Promise<string | null> {
    try {
        const data = await fs.readFile(cacheFile, 'utf-8')
        log.info('[Provider EPG] Using stale xmltv cache after download failure')
        return data
    } catch {
        return null
    }
}

/** O índice publicado já passou da validade da janela que ele cobre? */
function xmltvIndexIsStale(): boolean {
    // Só um índice PUBLICADO envelhece — em 'unavailable'/'unknown' não há
    // janela podada para vencer, e reabrir o probe ali seria a tempestade de
    // retry que o módulo evita de propósito.
    return xmltvAvailability === 'ready' && Date.now() - xmltvIndexedAt >= XMLTV_INDEX_TTL_MS
}

/**
 * Rodada que terminou sem publicar índice novo. Quando já existe um índice no
 * ar (isto é uma REINDEXAÇÃO, não o probe do boot), mantê-lo é melhor que
 * ficar sem guia nenhum: a próxima tentativa fica para o próximo TTL.
 */
function markXmltvUnavailable() {
    if (xmltvIndex) return
    xmltvAvailability = 'unavailable'
}

/**
 * Põe no ar o resultado de uma rodada. Grade e nomes vêm do MESMO documento e
 * só mudam juntos — o portal Stalker e o XMLTV normal passam os dois por aqui.
 */
function publishXmltvIndex(parsed: XmltvIndexResult): void {
    xmltvIndex = parsed.index
    xmltvNames = { nameToId: parsed.nameToId, declaredIds: parsed.declaredIds }
    providerUtcOffsetMinutes = parsed.utcOffsetMinutes
    xmltvAvailability = 'ready'
}

/**
 * Availability probe + index build. Uma rodada por vez (promessa única em
 * voo); uma falha definitiva sem índice anterior marca a fonte indisponível
 * para a sessão. O índice publicado vale XMLTV_INDEX_TTL_MS: passado isso a
 * próxima chamada reindexa, porque a janela podada dentro dele envelhece
 * junto. Durante a reindexação a disponibilidade CONTINUA 'ready' — nada de
 * voltar para 'unknown', que deixaria o índice vivo porém invisível para os
 * handlers se a rodada nova não chegasse a publicar.
 */
function ensureXmltvIndex(): Promise<void> {
    if (xmltvAvailability !== 'unknown' && !xmltvIndexIsStale()) return Promise.resolve()
    if (xmltvLoading) return xmltvLoading

    // Carimbo desta rodada: se resetProviderEpgState() rodar enquanto ela
    // baixa/parseia, o resultado é descartado em vez de sobrescrever o estado
    // já reconstruído para a playlist nova.
    const generation = xmltvGeneration
    const stillCurrent = () => generation === xmltvGeneration

    const loading = (async () => {
        const credentials = getCredentials()
        if (!credentials) {
            // Not logged in yet — stay 'unknown' so the next call (post-login) retries.
            log.info('[Provider EPG] No credentials, skipping xmltv probe')
            return
        }

        try {
            // M3U playlists point at their own XMLTV via the #EXTM3U url-tvg
            // header; Xtream keeps the classic {server}/xmltv.php.
            let url = buildXmltvUrl(credentials.url, credentials.username, credentials.password)
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined

            // Stalker portals: no XMLTV endpoint — pull the portal EPG
            // (get_epg_info) and synthesize an XMLTV document so the rest of
            // the pipeline (index, mini-EPG, guide, search) works unchanged.
            if (activeEntry?.type === 'stalker') {
                const { StalkerClient } = await import('./stalkerClient')
                const { buildXmltvFromStalkerEpg } = await import('./stalkerProtocol')
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                let syntheticXml = ''
                try {
                    const [channels, epg] = await Promise.all([stalker.getAllChannels(), stalker.getEpgInfo(24)])
                    syntheticXml = buildXmltvFromStalkerEpg(channels, epg)
                } catch (error) {
                    log.info('[Provider EPG] Stalker portal EPG unavailable:', getErrorMessage(error))
                }
                if (!syntheticXml || !looksLikeXmltv(syntheticXml)) {
                    if (stillCurrent()) markXmltvUnavailable()
                    return
                }
                const parseStart = Date.now()
                const parsed = await parseXmltvIndexWithMetaAsync(syntheticXml)
                if (!stillCurrent()) return
                publishXmltvIndex(parsed)
                let programCount = 0
                for (const programs of parsed.index.values()) programCount += programs.length
                log.info('[Provider EPG] Stalker EPG indexed', parsed.index.size, 'channels /', programCount,
                    'programs in', Date.now() - parseStart, 'ms')
                return
            }

            if (activeEntry?.type === 'm3u') {
                // Lista de arquivo: o `Range` do axios nao vale pra caminho de
                // disco, e o `.catch(() => '')` fazia o EPG do provedor sumir
                // sem explicacao. O `url-tvg` de dentro dela continua sendo uma
                // URL http — o que e local e o ARQUIVO, nao o EPG.
                const head = pareceListaM3uNoDisco(activeEntry.url)
                    ? await (async () => {
                        try {
                            const fs = await import('fs/promises')
                            const bytes = await fs.readFile(activeEntry.url)
                            return decodeM3uBytes(bytes.subarray(0, 65536))
                        } catch {
                            return ''
                        }
                    })()
                    : await axios.get(activeEntry.url, {
                        timeout: 15000,
                        responseType: 'text',
                        transformResponse: [(d: unknown) => d],
                        // first ~64KB is plenty for the header line
                        headers: { Range: 'bytes=0-65535' },
                        validateStatus: (code) => code === 200 || code === 206
                    }).then(r => String(r.data ?? '')).catch(() => '')
                const { urlTvg } = parseM3uHeader(head)
                if (!urlTvg) {
                    if (stillCurrent()) markXmltvUnavailable()
                    log.info('[Provider EPG] M3U playlist has no url-tvg — provider EPG disabled')
                    return
                }
                url = urlTvg
            }
            const xml = await fetchXmltvWithCache(url)

            if (!xml || !looksLikeXmltv(xml)) {
                if (stillCurrent()) markXmltvUnavailable()
                log.info('[Provider EPG] Provider xmltv unavailable (empty/404/HTML), disabled for this session')
                return
            }

            const parseStart = Date.now()
            const parsed = await parseXmltvIndexWithMetaAsync(xml)
            if (!stillCurrent()) {
                log.info('[Provider EPG] Índice descartado: a playlist mudou durante a indexação')
                return
            }
            publishXmltvIndex(parsed)
            if (parsed.utcOffsetMinutes !== null) {
                log.info('[Provider EPG] Provider UTC offset (min):', parsed.utcOffsetMinutes)
            }

            let programCount = 0
            for (const programs of parsed.index.values()) programCount += programs.length
            log.info('[Provider EPG] Indexed', parsed.index.size, 'channels /', programCount,
                'programs in', Date.now() - parseStart, 'ms')
        } catch (error) {
            if (stillCurrent()) markXmltvUnavailable()
            log.error('[Provider EPG] xmltv probe error:', getErrorMessage(error))
        }
    })().finally(() => {
        // Só solta a própria promessa: um reset no meio já zerou xmltvLoading e
        // pode ter uma rodada NOVA em voo — nulificá-la aqui faria a próxima
        // chamada disparar um terceiro download/parse em paralelo.
        if (!stillCurrent()) return
        xmltvLoading = null
        // Único lugar que carimba a idade do índice: o FIM da rodada. Tanto
        // faz ela ter publicado índice novo ou não — quando não publicou (sem
        // credencial, download falhou, provedor sem xmltv), o índice velho
        // segue no ar e vale até o próximo TTL. Sem este carimbo, a próxima
        // chamada de EPG dispararia outra rodada, e a seguinte também.
        xmltvIndexedAt = Date.now()
    })

    xmltvLoading = loading
    return loading
}

/** Per-channel JSON EPG (secondary source when xmltv.php is unavailable). */
async function fetchSimpleDataTable(streamId: number, channelId: string): Promise<ProviderEpgProgram[]> {
    const cached = simpleTableCache.get(streamId)
    if (cached && Date.now() - cached.at < SIMPLE_TABLE_TTL_MS) {
        return cached.programs
    }

    const credentials = getCredentials()
    if (!credentials) return []

    try {
        const url = buildSimpleDataTableUrl(credentials.url, credentials.username, credentials.password, streamId)
        const fetch = (await import('node-fetch')).default
        const response = await fetchWithRetry(async () => fetch(url, {
            agent: await resolveProviderHttpsAgent(url),
            signal: AbortSignal.timeout(20000),
            headers: FETCH_HEADERS
        }))

        if (!response.ok) {
            log.warn('[Provider EPG] get_simple_data_table failed: HTTP', response.status, '— disabled for this session')
            simpleTableAvailable = false
            return []
        }

        const text = await readResponseTextWithLimit(response, JSON_MAX_BYTES)
        let payload: unknown
        try {
            payload = JSON.parse(text)
        } catch {
            log.warn('[Provider EPG] get_simple_data_table returned non-JSON — disabled for this session')
            simpleTableAvailable = false
            return []
        }

        registerApprovedProviderUrl(response.url || url)
        const programs = parseSimpleDataTable(payload, channelId || String(streamId))
        simpleTableCache.set(streamId, { at: Date.now(), programs })
        return programs
    } catch (error) {
        log.warn('[Provider EPG] get_simple_data_table error:', getErrorMessage(error))
        simpleTableAvailable = false
        return []
    }
}

export function setupProviderEpgHandlers() {
    // Program search for the global search overlay (title, airing/upcoming).
    ipcMain.handle('epg:provider-search', async (_, args: { query?: string }) => {
        try {
            const query = typeof args?.query === 'string' ? args.query : ''
            if (query.trim().length < 2) return { success: true, programs: [] }
            await ensureXmltvIndex()
            if (xmltvAvailability !== 'ready' || !xmltvIndex) {
                return { success: true, programs: [] }
            }
            return { success: true, programs: searchEpgIndex(xmltvIndex, query, Date.now()) }
        } catch (error) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Programs for one channel, straight from the in-memory index.
    ipcMain.handle('epg:provider-channel', async (_, args: { channelId?: string; channelName?: string; streamId?: number }) => {
        try {
            const channelId = typeof args?.channelId === 'string' ? args.channelId : ''
            // #D036: o nome do canal deixa achar a grade pelo <display-name>
            // quando o tvg-id vem vazio ou o XMLTV do provedor não o usa.
            const channelName = typeof args?.channelName === 'string' ? args.channelName : ''
            const streamId = typeof args?.streamId === 'number' && Number.isFinite(args.streamId)
                ? args.streamId
                : null

            if (channelId || channelName) {
                await ensureXmltvIndex()
                if (xmltvAvailability === 'ready' && xmltvIndex) {
                    const programs = lookupProviderEpgChannel(xmltvIndex, xmltvNames, { channelId, channelName })
                    if (programs) return { success: true, programs, source: 'xmltv' }
                    // xmltv is THE provider EPG when present: a channel whose
                    // tvg-id has nothing in it means the provider has no EPG
                    // for it — let the renderer fall back to its existing
                    // chain. Sem tvg-id nenhum (só um nome que não casou), o
                    // endpoint por canal abaixo continua sendo a última chance,
                    // como era antes.
                    if (channelId) return { success: true, programs: [], source: 'xmltv' }
                }
            }

            // xmltv unavailable (or channel has no epg id): try the per-channel endpoint.
            if (streamId !== null && simpleTableAvailable) {
                const programs = await fetchSimpleDataTable(streamId, channelId)
                return { success: true, programs, source: 'simple-data-table' }
            }

            return { success: true, programs: [], source: 'none' }
        } catch (error) {
            return { success: false, error: getErrorMessage(error) }
        }
    })
}
