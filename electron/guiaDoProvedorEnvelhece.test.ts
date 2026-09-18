/**
 * 📺 O guia do provedor com o app dias aberto.
 *
 * O índice XMLTV em memória é PODADO no instante do parse para
 * [agora-24h, agora+48h], e ensureXmltvIndex() só trabalhava enquanto a
 * disponibilidade fosse 'unknown' — depois do primeiro sucesso o índice
 * virava PERMANENTE para a sessão. Num PC de sala ligado dias, 12h depois do
 * boot o pulo de dia do Guia (que vai até agora+36h, src/utils/epgGuide.ts)
 * já caía em área vazia e nunca mais se reconstruía.
 *
 * O teste é comportamental: o módulo roda de verdade (handler IPC real, cache
 * em disco real num userData temporário, parse real do XMLTV). Só o relógio é
 * falso — e de propósito só o Date, porque falsear timers pararia o parse
 * fatiado, que cede o event loop com setImmediate. A rede é mockada apenas
 * para PROVAR que a reindexação não baixa nada de novo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const HORA = 60 * 60 * 1000
/** 2026-09-17 12:00 UTC — o instante do boot do app no teste. */
const T0 = Date.UTC(2026, 8, 17, 12, 0, 0)

const state = vi.hoisted(() => ({
    userData: '',
    servidor: 'http://provedor.exemplo:8080',
    usuario: 'dono',
    senha: 'segredo',
    /** false = usuário sem credencial (logout no meio da sessão). */
    temCredencial: true,
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    /** Quantas vezes o XMLTV foi realmente indexado. */
    parses: 0,
    /** Quantas vezes a rede foi tocada. */
    downloads: 0,
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
            state.handlers.set(channel, fn),
    },
    app: { getPath: () => state.userData },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./store', () => ({
    default: {
        get: (key: string) => key === 'auth' && state.temCredencial
            ? { url: state.servidor, username: state.usuario, password: state.senha }
            : {},
    },
}))
vi.mock('./playlistManager', () => ({
    getActivePlaylistIdPublic: () => null,
    findPlaylist: () => undefined,
}))
vi.mock('./certificatePolicy', () => ({
    resolveProviderHttpsAgent: async () => undefined,
    registerApprovedProviderUrl: () => undefined,
}))
vi.mock('node-fetch', () => ({
    default: async () => {
        state.downloads++
        throw new Error('rede indisponível no teste')
    },
}))
vi.mock('./providerEpgProtocol', async (importOriginal) => {
    const real = await importOriginal<typeof import('./providerEpgProtocol')>()
    return {
        ...real,
        parseXmltvIndexWithMetaAsync: (...args: Parameters<typeof real.parseXmltvIndexWithMetaAsync>) => {
            state.parses++
            return real.parseXmltvIndexWithMetaAsync(...args)
        },
    }
})

import { buildXmltvUrl } from './providerEpgProtocol'
import { resetProviderEpgState, setupProviderEpgHandlers } from './providerEpg'

interface ProgramaDoProvedor {
    start: string
    end: string
    title: string
}

/** '20260917120000 +0000' — o formato de horário do XMLTV. */
function carimbo(ms: number): string {
    const iso = new Date(ms).toISOString()
    return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10)
        + iso.slice(11, 13) + iso.slice(14, 16) + '00 +0000'
}

/**
 * XMLTV do provedor: um programa de 2 em 2 horas, de T0-30h até T0+72h. É o
 * que um provedor real entrega — bem mais fundo que a janela de +48h que o
 * índice guarda.
 */
function xmltvDoProvedor(): string {
    const blocos: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>']
    for (let offset = -30 * HORA; offset <= 72 * HORA; offset += 2 * HORA) {
        const inicio = T0 + offset
        blocos.push(
            '<programme start="' + carimbo(inicio) + '" stop="' + carimbo(inicio + 2 * HORA) + '" channel="ch1">'
            + '<title>Programa ' + offset / HORA + 'h</title></programme>'
        )
    }
    blocos.push('</tv>')
    return blocos.join('\n')
}

/** Caminho do par .xml/.meta.json que o módulo usa como cache em disco. */
function arquivosDoCache() {
    const url = buildXmltvUrl(state.servidor, state.usuario, state.senha)
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
    const dir = path.join(state.userData, 'epg_cache')
    return {
        xml: path.join(dir, 'provider-xmltv-' + hash + '.xml'),
        meta: path.join(dir, 'provider-xmltv-' + hash + '.meta.json'),
        dir,
    }
}

/** Deixa o cache em disco (TTL de 24h) pronto e fresco no instante T0. */
function semearCacheEmDisco() {
    const { dir, xml: arquivoXml, meta } = arquivosDoCache()
    fs.mkdirSync(dir, { recursive: true })
    const xml = xmltvDoProvedor()
    fs.writeFileSync(arquivoXml, xml, 'utf-8')
    fs.writeFileSync(meta, JSON.stringify({ timestamp: T0, size: xml.length }), 'utf-8')
}

async function pedirGuia(): Promise<ProgramaDoProvedor[]> {
    const handler = state.handlers.get('epg:provider-channel')
    if (!handler) throw new Error('handler epg:provider-channel não registrado')
    const resposta = await handler(null, { channelId: 'ch1' }) as
        { success: boolean; programs: ProgramaDoProvedor[] }
    expect(resposta.success).toBe(true)
    return resposta.programs
}

/** Quantas horas à frente do "agora" o índice ainda tem programa. */
function alcanceFuturoEmHoras(programas: ProgramaDoProvedor[], agora: number): number {
    if (programas.length === 0) return -Infinity
    const ultimo = programas[programas.length - 1]
    return (Date.parse(ultimo.start) - agora) / HORA
}

describe('EPG do provedor com o app aberto por dias', () => {
    beforeEach(() => {
        state.handlers.clear()
        state.parses = 0
        state.downloads = 0
        state.temCredencial = true
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-provider-epg-'))
        semearCacheEmDisco()
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
        resetProviderEpgState()
        setupProviderEpgHandlers()
    })

    afterEach(() => {
        vi.useRealTimers()
        resetProviderEpgState()
        fs.rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('no boot o índice cobre a janela inteira que o Guia oferece', async () => {
        const programas = await pedirGuia()

        expect(programas.length).toBeGreaterThan(0)
        // O Guia chega a agora+36h (WINDOW_MAX_OFFSET_MS em src/utils/epgGuide.ts).
        expect(alcanceFuturoEmHoras(programas, T0)).toBeGreaterThanOrEqual(36)
        expect(state.parses).toBe(1)
    })

    it('meio dia depois o Guia continua tendo programa na borda de +36h', async () => {
        await pedirGuia()

        const agora = T0 + 13 * HORA
        vi.setSystemTime(agora)
        const programas = await pedirGuia()

        expect(alcanceFuturoEmHoras(programas, agora)).toBeGreaterThanOrEqual(36)
        // O programa que começa 37h à frente do "agora" existe no arquivo do
        // provedor; sem reindexar, ele nunca entra no índice.
        const borda = new Date(agora + 37 * HORA).toISOString()
        expect(programas.some(p => p.start === borda)).toBe(true)
    })

    it('a reindexação reusa o cache em disco — não baixa nada de novo', async () => {
        await pedirGuia()
        vi.setSystemTime(T0 + 13 * HORA)
        await pedirGuia()

        expect(state.parses).toBe(2)
        expect(state.downloads).toBe(0)
    })

    it('não reindexa a cada chamada: dentro do TTL o índice é reusado', async () => {
        await pedirGuia()

        vi.setSystemTime(T0 + 2 * HORA)
        await pedirGuia()
        vi.setSystemTime(T0 + 5 * HORA)
        await pedirGuia()

        expect(state.parses).toBe(1)
    })

    it('o passado recente (agora-12h) continua no índice depois de reindexar', async () => {
        await pedirGuia()

        const agora = T0 + 13 * HORA
        vi.setSystemTime(agora)
        const programas = await pedirGuia()

        const primeiro = Date.parse(programas[0].start)
        expect((agora - primeiro) / HORA).toBeGreaterThanOrEqual(12)
    })

    it('reindexação que falha não derruba o guia que já estava funcionando', async () => {
        await pedirGuia()

        // Provedor sai do ar: o cache em disco vence e o download falha.
        fs.rmSync(arquivosDoCache().meta, { force: true })
        fs.rmSync(arquivosDoCache().xml, { force: true })
        const agora = T0 + 7 * HORA
        vi.setSystemTime(agora)
        const programas = await pedirGuia()

        expect(state.downloads).toBeGreaterThan(0)
        // O índice velho segue no ar — melhor um guia envelhecido que nenhum.
        expect(programas.length).toBeGreaterThan(0)
        expect(alcanceFuturoEmHoras(programas, agora)).toBeGreaterThanOrEqual(36)
    })

    it('falha na reindexação não faz o app tentar de novo a cada chamada', async () => {
        await pedirGuia()

        fs.rmSync(arquivosDoCache().meta, { force: true })
        fs.rmSync(arquivosDoCache().xml, { force: true })
        vi.setSystemTime(T0 + 7 * HORA)
        await pedirGuia()
        const tentativas = state.downloads

        vi.setSystemTime(T0 + 8 * HORA)
        await pedirGuia()
        await pedirGuia()

        expect(state.downloads).toBe(tentativas)
    })

    it('provedor sem xmltv no boot continua sem virar tempestade de retry', async () => {
        // Sem cache em disco e sem rede: o provedor simplesmente não tem EPG.
        fs.rmSync(arquivosDoCache().meta, { force: true })
        fs.rmSync(arquivosDoCache().xml, { force: true })

        expect(await pedirGuia()).toEqual([])
        const tentativas = state.downloads
        expect(tentativas).toBeGreaterThan(0)

        // Horas depois, a fonte segue desligada para a sessão: o TTL do índice
        // não pode ressuscitar um probe que já se provou definitivamente morto.
        vi.setSystemTime(T0 + 7 * HORA)
        await pedirGuia()
        await pedirGuia()

        expect(state.downloads).toBe(tentativas)
    })

    it('logout no meio da sessão não apaga o guia que já estava no ar', async () => {
        await pedirGuia()

        state.temCredencial = false
        const agora = T0 + 7 * HORA
        vi.setSystemTime(agora)
        const programas = await pedirGuia()

        expect(programas.length).toBeGreaterThan(0)
        expect(state.parses).toBe(1)
    })
})
