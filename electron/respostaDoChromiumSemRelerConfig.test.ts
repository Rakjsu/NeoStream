// @vitest-environment node
/**
 * #D139 — cada resposta do Chromium relia o config.json inteiro de 2 a 5 vezes.
 *
 * O `onHeadersReceived` que o certificatePolicy pendura na defaultSession não
 * tem filtro de URL: roda em TODA resposta do renderer (capa do catálogo,
 * segmento HLS, fetch). Para decidir se reescreve o CORS ele chamava
 * `getCertificateSettings()` e `isProviderUrl()` — e cada `store.get` do
 * electron-store (conf) é um `readFileSync` + `JSON.parse` do arquivo todo,
 * síncrono, na thread do main. Uma tela de capas = centenas de leituras.
 *
 * O teste usa o store DE VERDADE (electron/store.ts sobre o conf real, num
 * diretório temporário) e conta as leituras do config.json feitas pelo
 * handler de verdade. Também prova que o espelho em memória não fica velho:
 * qualquer escrita no store — do próprio certificatePolicy ou de fora dele,
 * como o playlistManager trocando o `auth` — é vista na resposta seguinte.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

type RespostaFalsa = { url: string; responseHeaders: Record<string, string[]> }
type Devolucao = { responseHeaders?: Record<string, string[]> }
type OuvinteDeCabecalho = (details: RespostaFalsa, callback: (r: Devolucao) => void) => void

const estado = await vi.hoisted(async () => {
    const nodeFs = await import('node:fs')
    const nodeOs = await import('node:os')
    const nodePath = await import('node:path')
    const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'd139-config-'))
    return { dir, ouvinte: null as OuvinteDeCabecalho | null }
})

vi.mock('electron', () => ({
    app: {
        on: vi.fn(),
        whenReady: () => Promise.resolve(),
        isReady: () => false,
        getPath: () => estado.dir,
        getVersion: () => '0.0.0',
    },
    session: {
        defaultSession: {
            webRequest: {
                onHeadersReceived: (fn: OuvinteDeCabecalho) => { estado.ouvinte = fn },
            },
        },
    },
    dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}))

// O electron-store só acrescenta ao conf o diretório do app (userData) e o
// nome do arquivo; aqui o conf é o real, só o diretório é temporário.
vi.mock('electron-store', async () => {
    const { default: Conf } = await import('conf')
    class StoreNoDiretorioTemporario extends Conf<Record<string, unknown>> {
        constructor(options: Record<string, unknown> = {}) {
            const { name, ...resto } = options
            super({ ...resto, configName: typeof name === 'string' ? name : 'config', cwd: estado.dir })
        }
    }
    return { default: StoreNoDiretorioTemporario }
})
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import store from './store'
import {
    setupCertificateErrorHandler,
    setAllowInvalidProviderCertificates,
    forgetTrustedCertificateDomains,
    getCertificateSettings,
    isProviderUrl,
    registerApprovedProviderUrl,
} from './certificatePolicy'

const PROVEDOR = 'https://painel.provedor-d139.com/player_api.php'

let leituras = 0
let espiao: ReturnType<typeof vi.spyOn> | null = null

function responder(url: string): Devolucao {
    const ouvinte = estado.ouvinte
    if (!ouvinte) throw new Error('onHeadersReceived não foi registrado')
    let devolvido: Devolucao | null = null
    ouvinte({ url, responseHeaders: { 'Content-Type': ['image/jpeg'] } }, r => { devolvido = r })
    if (!devolvido) throw new Error('o handler não chamou o callback de forma síncrona')
    return devolvido
}

function temCors(r: Devolucao): boolean {
    return r.responseHeaders?.['Access-Control-Allow-Origin']?.[0] === '*'
}

beforeAll(async () => {
    setupCertificateErrorHandler()
    await vi.waitFor(() => {
        if (!estado.ouvinte) throw new Error('aguardando o whenReady registrar o handler')
    })
})

afterAll(() => {
    fs.rmSync(estado.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

beforeEach(() => {
    store.set('settings', { theme: 'dark', language: 'en', allowInvalidProviderCertificates: true, approvedProviderHosts: [], trustedInvalidCertDomains: [] })
    store.set('auth', { url: PROVEDOR, username: 'u', password: 'p' })
    const configPath = path.resolve(store.path)
    const original = fs.readFileSync
    leituras = 0
    espiao = vi.spyOn(fs, 'readFileSync').mockImplementation(((alvo: fs.PathOrFileDescriptor, ...resto: unknown[]) => {
        if (typeof alvo === 'string' && path.resolve(alvo) === configPath) leituras++
        return (original as (...a: unknown[]) => unknown)(alvo, ...resto)
    }) as typeof fs.readFileSync)
})

afterEach(() => {
    espiao?.mockRestore()
    espiao = null
})

describe('#D139 — o CORS da defaultSession não relê o config.json a cada resposta', () => {
    it('uma tela de capas (provedor e terceiros misturados) não lê o config.json depois do aquecimento', () => {
        // Aquecimento: a 1ª resposta de cada host do provedor ainda grava o host
        // em approvedProviderHosts (uma escrita legítima, que relê o arquivo).
        for (let i = 0; i < 4; i++) {
            expect(temCors(responder(`https://cdn${i}.provedor-d139.com/capa/0.jpg`))).toBe(true)
        }
        expect(temCors(responder('https://image.tmdb.org/t/p/w342/0.jpg'))).toBe(false)
        const depoisDoAquecimento = leituras

        for (let i = 1; i <= 60; i++) {
            expect(temCors(responder(`https://cdn${i % 4}.provedor-d139.com/capa/${i}.jpg`))).toBe(true)
            expect(temCors(responder(`https://image.tmdb.org/t/p/w342/${i}.jpg`))).toBe(false)
        }

        // Hoje: 120 respostas × (2..5) leituras. Com o espelho: nenhuma.
        expect(leituras - depoisDoAquecimento).toBe(0)
    })

    it('trocar de playlist (auth escrito FORA do certificatePolicy) vale já na resposta seguinte', () => {
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/1.jpg'))).toBe(true)
        expect(temCors(responder('https://live.outro-d139.net/hls/1.ts'))).toBe(false)

        // O que o playlistManager faz ao ativar outra lista.
        store.set('auth', { url: 'https://live.outro-d139.net/player_api.php', username: 'x', password: 'y' })

        expect(temCors(responder('https://live.outro-d139.net/hls/2.ts'))).toBe(true)
        // Host do provedor antigo que nunca foi aprovado deixa de ganhar CORS.
        expect(temCors(responder('https://nunca-visto.provedor-d139.com/x.jpg'))).toBe(false)
    })

    it('desligar o modo compatível corta o CORS na resposta seguinte (pelo setter e por escrita direta)', () => {
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/1.jpg'))).toBe(true)
        // O retorno do setter é o que a ponte do IPC devolve à tela de Configurações.
        const desligado = setAllowInvalidProviderCertificates(false)
        expect(desligado.allowInvalidProviderCertificates).toBe(false)
        expect(desligado.approvedProviderHosts).toEqual([])
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/2.jpg'))).toBe(false)

        setAllowInvalidProviderCertificates(true)
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/3.jpg'))).toBe(true)

        // Quem grava a chave inteira (restauração, outro módulo) também é visto.
        store.set('settings', { ...store.get('settings'), allowInvalidProviderCertificates: false })
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/4.jpg'))).toBe(false)
    })

    it('"esquecer decisões" devolve e aplica a lista limpa na hora', () => {
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/1.jpg'))).toBe(true)
        expect(getCertificateSettings().approvedProviderHosts).toEqual(['cdn1.provedor-d139.com'])

        expect(forgetTrustedCertificateDomains().approvedProviderHosts).toEqual([])
        expect(getCertificateSettings().approvedProviderHosts).toEqual([])
    })

    it('o provedor CANDIDATO (lista ainda não ativa) não envenena o provedor ativo', () => {
        // O ipcHandlers testa URLs de outra playlist passando a URL dela.
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/1.jpg'))).toBe(true)
        expect(isProviderUrl('https://cdn.candidato-d139.tv/1.ts', 'https://portal.candidato-d139.tv/player_api.php')).toBe(true)

        // Sem candidato, vale de novo o `auth` gravado — não o último candidato.
        expect(isProviderUrl('https://cdn.candidato-d139.tv/2.ts')).toBe(false)
        expect(isProviderUrl('https://cdn9.provedor-d139.com/2.ts')).toBe(true)
        expect(temCors(responder('https://cdn.candidato-d139.tv/3.ts'))).toBe(false)

        // E aprovar um host do candidato passa a valer para o ativo também (multi-playlist).
        expect(registerApprovedProviderUrl('https://cdn.candidato-d139.tv/4.ts', 'https://portal.candidato-d139.tv/')).toBe(true)
        expect(temCors(responder('https://cdn.candidato-d139.tv/5.ts'))).toBe(true)
    })

    it('escritas em série não acumulam ouvintes: cada uma custa sempre o mesmo', () => {
        const custos: number[] = []
        for (let i = 0; i < 6; i++) {
            const antes = leituras
            store.set('history', [i])
            custos.push(leituras - antes)
            // Reconstrói o espelho depois da escrita, como a próxima capa faria.
            expect(temCors(responder(`https://cdn1.provedor-d139.com/capa/${i}.jpg`))).toBe(true)
        }
        expect(custos.every(c => c === custos[0])).toBe(true)
        // O `set` do conf lê o arquivo 2 vezes por conta própria (o store atual
        // e a chave interna a preservar); +1 do ouvinte único do espelho. Um
        // ouvinte a mais já passaria disso.
        expect(custos[0]).toBeLessThanOrEqual(3)
    })

    it('getCertificateSettings devolve uma cópia: mexer nela não envenena a política', () => {
        responder('https://cdn1.provedor-d139.com/capa/1.jpg')
        const copia = getCertificateSettings()
        copia.approvedProviderHosts.push('evil.attacker.example')
        copia.allowInvalidProviderCertificates = false

        expect(getCertificateSettings().approvedProviderHosts).not.toContain('evil.attacker.example')
        expect(temCors(responder('https://evil.attacker.example/x.jpg'))).toBe(false)
        expect(temCors(responder('https://cdn1.provedor-d139.com/capa/2.jpg'))).toBe(true)
    })
})
