/**
 * 📺 Canal sem tvg-id tambem tem guia quando o XMLTV do PROVEDOR tem o canal
 * pelo nome (#D036).
 *
 * O indice do EPG do provedor era so `Map<channel id, programas>`: o scan lia
 * apenas o atributo `channel=` dos `<programme>` e nunca os blocos
 * `<channel><display-name>`. E o handler `epg:provider-channel` pulava o
 * XMLTV inteiro quando o tvg-id vinha vazio — sobrava o
 * get_simple_data_table, que muitos provedores nem servem. Resultado: canal
 * sem tvg-id (ou com um tvg-id que o XMLTV do proprio provedor nao usa)
 * ficava sem guia mesmo com o provedor entregando a grade dele.
 *
 * O teste e comportamental: o modulo roda de verdade (handler IPC real, cache
 * em disco real num userData temporario, parse real do XMLTV). A rede e
 * mockada so para PROVAR que o guia veio do indice, sem cair no endpoint por
 * canal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const HORA = 60 * 60 * 1000
/** 2026-09-17 12:00 UTC — o "agora" do teste. */
const T0 = Date.UTC(2026, 8, 17, 12, 0, 0)

const state = vi.hoisted(() => ({
    userData: '',
    servidor: 'http://provedor.exemplo:8080',
    usuario: 'dono',
    senha: 'segredo',
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    /** Quantas vezes a rede foi tocada (get_simple_data_table incluso). */
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
        get: (key: string) => key === 'auth'
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
        throw new Error('rede indisponivel no teste')
    },
}))

import {
    buildXmltvUrl,
    parseXmltvIndexWithMeta,
    parseXmltvIndexWithMetaAsync,
    XMLTV_SCAN_CHUNK,
} from './providerEpgProtocol'
import { resetProviderEpgState, setupProviderEpgHandlers } from './providerEpg'

interface ProgramaDoProvedor {
    start: string
    end: string
    title: string
    channel_id: string
}

interface RespostaDoProvedor {
    success: boolean
    programs: ProgramaDoProvedor[]
    source: string
}

/** '20260917120000 +0000' — o formato de horario do XMLTV. */
function carimbo(ms: number): string {
    const iso = new Date(ms).toISOString()
    return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10)
        + iso.slice(11, 13) + iso.slice(14, 16) + '00 +0000'
}

function programa(canal: string, titulo: string, inicio: number): string {
    return '<programme start="' + carimbo(inicio) + '" stop="' + carimbo(inicio + HORA)
        + '" channel="' + canal + '"><title>' + titulo + '</title></programme>'
}

/**
 * XMLTV do provedor. Os ids do XMLTV nao batem com nada que a playlist
 * mande como tvg-id — e exatamente o caso do bug.
 */
function xmltvDoProvedor(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        // Dois display-names: o principal primeiro, o apelido depois.
        '<channel id="um.prov"><display-name>Canal Um HD</display-name>'
        + '<display-name>Primeiro</display-name></channel>',
        // Entidade XML no nome: tem que ser decodificada antes da chave.
        '<channel id="dois.prov"><display-name>Filmes &amp; Series</display-name></channel>',
        // Mesmo apelido de outro canal: o PRIMEIRO display-name registrado vence.
        '<channel id="tres.prov"><display-name>Primeiro</display-name></channel>',
        // Duas praças da mesma rede. A do Sul o provedor CONHECE (declara o
        // <channel>) mas nao tem programacao dela agora; a do Norte tem.
        '<channel id="rede.norte"><display-name>Rede Local</display-name></channel>',
        '<channel id="rede.sul"><display-name>Rede Local</display-name></channel>',
        programa('um.prov', 'Jornal do Um', T0 - HORA / 2),
        programa('dois.prov', 'Filme do Dois', T0 - HORA / 2),
        programa('tres.prov', 'Show do Tres', T0 - HORA / 2),
        programa('rede.norte', 'Jornal do Norte', T0 - HORA / 2),
        '</tv>',
    ].join('\n')
}

/** Deixa o cache em disco (TTL de 24h) pronto e fresco no instante T0. */
function semearCacheEmDisco() {
    const url = buildXmltvUrl(state.servidor, state.usuario, state.senha)
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
    const dir = path.join(state.userData, 'epg_cache')
    fs.mkdirSync(dir, { recursive: true })
    const xml = xmltvDoProvedor()
    fs.writeFileSync(path.join(dir, 'provider-xmltv-' + hash + '.xml'), xml, 'utf-8')
    fs.writeFileSync(path.join(dir, 'provider-xmltv-' + hash + '.meta.json'),
        JSON.stringify({ timestamp: T0, size: xml.length }), 'utf-8')
}

async function pedirGuia(args: Record<string, unknown>): Promise<RespostaDoProvedor> {
    const handler = state.handlers.get('epg:provider-channel')
    if (!handler) throw new Error('handler epg:provider-channel nao registrado')
    const resposta = await handler(null, args) as RespostaDoProvedor
    expect(resposta.success).toBe(true)
    return resposta
}

describe('EPG do provedor: canal achado pelo nome (#D036)', () => {
    beforeEach(() => {
        state.handlers.clear()
        state.downloads = 0
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-provider-epg-nome-'))
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

    it('canal SEM tvg-id recebe a grade do XMLTV do provedor pelo nome', async () => {
        // O nome da playlist vem "sujo" — [FHD] — e o display-name tem "HD" no
        // fim: a mesma nameKey do indice de XMLTV normaliza os dois lados.
        const resposta = await pedirGuia({ channelId: '', channelName: 'Canal Um [FHD]', streamId: 7 })

        expect(resposta.source).toBe('xmltv')
        expect(resposta.programs.map(p => p.title)).toEqual(['Jornal do Um'])
        // O channel_id e o id REAL do XMLTV, como no caminho por id.
        expect(resposta.programs.map(p => p.channel_id)).toEqual(['um.prov'])
        // Veio do indice: o endpoint por canal nem foi tocado.
        expect(state.downloads).toBe(0)
    })

    it('tvg-id que o XMLTV do provedor nao conhece cai no nome', async () => {
        const resposta = await pedirGuia({ channelId: 'id.que.nao.existe', channelName: 'Filmes & Series', streamId: 8 })

        expect(resposta.source).toBe('xmltv')
        expect(resposta.programs.map(p => p.title)).toEqual(['Filme do Dois'])
        expect(state.downloads).toBe(0)
    })

    it('o primeiro display-name registrado vence um apelido repetido', async () => {
        const resposta = await pedirGuia({ channelId: '', channelName: 'Primeiro' })

        expect(resposta.programs.map(p => p.channel_id)).toEqual(['um.prov'])
    })

    it('tvg-id que existe no indice continua vencendo o nome', async () => {
        const resposta = await pedirGuia({ channelId: 'tres.prov', channelName: 'Canal Um' })

        expect(resposta.programs.map(p => p.title)).toEqual(['Show do Tres'])
    })

    it('tvg-id que o XMLTV declara, mas sem programa agora, NAO herda a grade de outro canal com o mesmo nome', async () => {
        // A praca do Sul e um canal que o provedor conhece. Cair no nome aqui
        // mostraria o jornal do Norte como se fosse o do Sul — grade errada e
        // pior que grade ausente. Fica vazio, e o renderer segue a cadeia dele.
        const resposta = await pedirGuia({ channelId: 'rede.sul', channelName: 'Rede Local', streamId: 11 })

        expect(resposta.source).toBe('xmltv')
        expect(resposta.programs).toEqual([])
        expect(state.downloads).toBe(0)
    })

    it('canal que o XMLTV nao tem nem pelo id nem pelo nome devolve vazio pelo xmltv', async () => {
        const resposta = await pedirGuia({ channelId: 'id.que.nao.existe', channelName: 'Canal Inexistente' })

        expect(resposta.source).toBe('xmltv')
        expect(resposta.programs).toEqual([])
    })

    it('sem tvg-id e sem nome que case, o endpoint por canal segue sendo tentado', async () => {
        // Comportamento anterior preservado: com o XMLTV no ar mas sem o
        // canal, e sem id nenhum para afirmar "o provedor nao tem guia
        // dele", o get_simple_data_table ainda e a ultima chance.
        const resposta = await pedirGuia({ channelId: '', channelName: 'Canal Inexistente', streamId: 9 })

        expect(resposta.source).toBe('simple-data-table')
        expect(state.downloads).toBeGreaterThan(0)
    })

    it('nome que nao e string e ignorado, sem derrubar o handler', async () => {
        const resposta = await pedirGuia({ channelId: '', channelName: 42 })

        expect(resposta.programs).toEqual([])
    })
})

describe('indice do XMLTV do provedor: nome -> id', () => {
    it('o parse fatiado le <channel> declarado DEPOIS de varias fatias de <programme>', async () => {
        // Provedor que intercala canal e grade: o <channel> do fim so aparece
        // depois de mais de uma fatia do scan assincrono.
        const blocos = ['<tv>', '<channel id="a.prov"><display-name>Canal A</display-name></channel>']
        for (let i = 0; i < XMLTV_SCAN_CHUNK + 50; i++) {
            blocos.push(programa('a.prov', 'A ' + i, T0 - HORA / 2))
        }
        blocos.push('<channel id="b.prov"><display-name><![CDATA[Canal B]]></display-name></channel>')
        blocos.push(programa('b.prov', 'B', T0 - HORA / 2))
        // Declarado so no fim do documento, depois do ultimo <programme>.
        blocos.push('<channel id="c.prov"><display-name>Canal C</display-name></channel>')
        blocos.push('</tv>')
        const xml = blocos.join('\n')

        const assincrono = await parseXmltvIndexWithMetaAsync(xml, T0)
        const sincrono = parseXmltvIndexWithMeta(xml, T0)

        expect(assincrono.nameToId.get('canal a')).toBe('a.prov')
        expect(assincrono.nameToId.get('canal b')).toBe('b.prov')
        expect(assincrono.nameToId.get('canal c')).toBe('c.prov')
        expect([...assincrono.declaredIds].sort()).toEqual(['a.prov', 'b.prov', 'c.prov'])
        expect([...assincrono.nameToId]).toEqual([...sincrono.nameToId])
        expect([...assincrono.declaredIds]).toEqual([...sincrono.declaredIds])
    })

    it('<channel> sem id nao rouba o nome do canal que vem depois', () => {
        // "Primeiro nome vence" so vale entre canais que tem id: um bloco
        // quebrado nao pode prender o nome num id vazio que nada no indice usa.
        const xml = [
            '<tv>',
            '<channel id=""><display-name>Canal D</display-name></channel>',
            '<channel><display-name>Canal D</display-name></channel>',
            '<channel id="d.prov"><display-name>Canal D</display-name></channel>',
            programa('d.prov', 'D', T0 - HORA / 2),
            '</tv>',
        ].join('\n')

        const { nameToId, declaredIds } = parseXmltvIndexWithMeta(xml, T0)

        expect(nameToId.get('canal d')).toBe('d.prov')
        expect([...declaredIds]).toEqual(['d.prov'])
    })
})
