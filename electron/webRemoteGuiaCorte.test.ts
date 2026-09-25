// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { renderRemotePage } from './webRemotePage'
import { STRINGS } from './webRemoteStrings'
import { sanitizeGuide, buildGuideMessage, GUIDE_MAX_CHANNELS } from './webRemoteGuide'

/**
 * D105 — a guia do celular corta em 600 canais e não dizia. A LiveTV manda a
 * lista filtrada inteira; o sanitizador do main guardava só os 600 primeiros.
 * Com "Todos" de um provedor grande, o canal 901 não aparecia na aba Guia e a
 * caixa "Buscar canal…" (que filtra só o que já chegou) também não o achava —
 * sem nenhum aviso de que havia mais. A busca 🔍 do topo acha (vai ao renderer
 * com a lista toda), mas ninguém dizia isso.
 *
 * Agora o main manda o total junto, e a página, quando houve corte, fecha a
 * lista com "mostrando N de M — use a busca do topo", no idioma do controle.
 * A parte da página RODA o <script> servido no jsdom, com um WebSocket falso,
 * e recebe exatamente a mensagem que o servidor monta (`buildGuideMessage`).
 */

type Canal = { id: string; name: string; logo: string; num?: number }

function canais(n: number, de = 1): Canal[] {
    return Array.from({ length: n }, (_, i) => ({ id: String(de + i), name: `Canal ${de + i}`, logo: '', num: de + i }))
}

/** O que o servidor faz no `ipcMain.on('web-remote:guide')`: sanitiza e monta a mensagem. */
const doServidor = (raw: unknown): unknown => JSON.parse(buildGuideMessage(sanitizeGuide(raw)))

describe('sanitizeGuide: o total viaja junto com a lista cortada (D105)', () => {
    it('900 canais: guarda os 600 primeiros e informa total 900', () => {
        const g = sanitizeGuide({ channels: canais(900), playingId: '5', epg: null })
        expect(GUIDE_MAX_CHANNELS).toBe(600)
        expect(g.channels.length).toBe(600)
        expect(g.channels[599].name).toBe('Canal 600')
        expect(g.total).toBe(900)
        expect(g.playingId).toBe('5')
    })

    it('sem corte, total é o próprio tamanho da lista', () => {
        const g = sanitizeGuide({ channels: canais(42) })
        expect(g.channels.length).toBe(42)
        expect(g.total).toBe(42)
    })

    it('entradas inválidas não contam no total (não inventa um "de 600" sem corte)', () => {
        const brutos: unknown[] = canais(598)
        brutos.splice(10, 0, { id: '', name: 'sem id' }, { id: 'x', name: '' })
        expect(brutos.length).toBe(600)
        const g = sanitizeGuide({ channels: brutos })
        expect(g.channels.length).toBe(598)
        expect(g.total).toBe(598)
    })

    it('inválidos no começo não roubam vaga: os 600 guardados são 600 válidos', () => {
        const brutos: unknown[] = [null, 7, { id: 'a' }, ...canais(700)]
        const g = sanitizeGuide({ channels: brutos })
        expect(g.channels.length).toBe(600)
        expect(g.channels[0].name).toBe('Canal 1')
        expect(g.total).toBe(700)
    })

    it('payload lixo vira guia vazia com total 0', () => {
        expect(sanitizeGuide(null)).toEqual({ channels: [], playingId: '', epg: null, total: 0 })
        expect(sanitizeGuide({ channels: 'x' }).total).toBe(0)
    })

    it('a mensagem do servidor leva o total — inclusive a guia vazia (antes da LiveTV abrir)', () => {
        expect(doServidor({ channels: canais(900) })).toMatchObject({ type: 'guide', total: 900 })
        expect(JSON.parse(buildGuideMessage(null))).toEqual({ type: 'guide', channels: [], playingId: '', epg: null, total: 0 })
    })
})

describe('as pontas: a LiveTV manda tudo e o servidor usa o módulo (D105)', () => {
    const semCR = (s: string) => s.split(String.fromCharCode(13)).join('')

    it('a LiveTV manda a lista filtrada INTEIRA — corte e contagem são do main', () => {
        const fonte = semCR(fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'LiveTV.tsx'), 'utf8'))
        const ini = fonte.indexOf('const channels = filteredStreams.map(')
        const fim = fonte.indexOf("window.ipcRenderer.send('web-remote:guide', { channels, playingId, epg })")
        expect(ini, 'montagem da lista da guia').toBeGreaterThan(-1)
        expect(fim, 'envio da guia ao main').toBeGreaterThan(ini)
        expect(fonte.slice(ini, fim).includes('.slice(')).toBe(false)
    })

    it('o handler do main sanitiza pelo módulo e responde com buildGuideMessage', () => {
        const fonte = semCR(fs.readFileSync(path.join(__dirname, 'webRemoteServer.ts'), 'utf8'))
        expect(fonte.includes("from './webRemoteGuide'")).toBe(true)
        expect(fonte.includes('guideState = sanitizeGuide(raw)')).toBe(true)
        expect(fonte.includes('return buildGuideMessage(guideState)')).toBe(true)
        // Sem um segundo corte escondido no servidor.
        expect(fonte.includes('slice(0, 600)')).toBe(false)
    })
})

class FakeWS {
    static all: FakeWS[] = []
    readyState = 0
    sent: string[] = []
    onopen: ((ev?: unknown) => void) | null = null
    onclose: ((ev?: unknown) => void) | null = null
    onmessage: ((ev?: unknown) => void) | null = null
    onerror: ((ev?: unknown) => void) | null = null
    constructor(public url: string) { FakeWS.all.push(this) }
    send(data: string) { this.sent.push(data) }
    close() { this.readyState = 3 }
    abrir() { this.readyState = 1; this.onopen?.({}) }
    receber(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

function scriptDa(pagina: string): string {
    const ini = pagina.indexOf('<script>')
    const fim = pagina.indexOf('</script>')
    return pagina.slice(ini + '<script>'.length, fim)
}

/**
 * Ouvintes que o script da página pendura no `document`. O `document` do jsdom
 * vive o arquivo inteiro: sem soltar, o ouvinte de um teste anterior reagiria
 * no seguinte.
 */
let ouvintesDoDocumento: Array<[string, EventListenerOrEventListenerObject]> = []

function montarPagina(lang: string): FakeWS {
    const pendurar = document.addEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation(((tipo: string, fn: EventListenerOrEventListenerObject) => {
        ouvintesDoDocumento.push([tipo, fn])
        pendurar(tipo, fn)
    }) as typeof document.addEventListener)
    const pagina = renderRemotePage(lang)
    const corpoIni = pagina.indexOf('<body')
    document.body.innerHTML = pagina.slice(pagina.indexOf('>', corpoIni) + 1, pagina.indexOf('<script>'))
    new Function(scriptDa(pagina))()
    expect(FakeWS.all.length).toBe(1)
    const ws = FakeWS.all[0]
    ws.abrir()
    return ws
}

const lista = () => document.getElementById('chlist') as HTMLElement
const linhaDeCorte = () => document.getElementById('guide-trunc')
const nomesNaLista = () => Array.from(lista().querySelectorAll('.chitem .nm')).map((n) => n.textContent)

function digitarNaBuscaDaAba(texto: string): void {
    const input = document.getElementById('chsearch') as HTMLInputElement
    input.value = texto
    input.dispatchEvent(new Event('input'))
}

function textoEsperado(lang: 'pt' | 'en' | 'es', shown: number, total: number): string {
    return STRINGS[lang].guideTruncated
        .replace('{shown}', () => String(shown))
        .replace('{total}', () => String(total))
}

describe('controle web: a aba Guia avisa quando a lista foi cortada (D105)', () => {
    beforeEach(() => {
        FakeWS.all = []
        vi.useFakeTimers()
        vi.stubGlobal('WebSocket', FakeWS)
        localStorage.clear()
        localStorage.setItem('neostream_remote_pin', '1234')
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.unstubAllGlobals()
        for (const [tipo, fn] of ouvintesDoDocumento) document.removeEventListener(tipo, fn)
        ouvintesDoDocumento = []
        vi.restoreAllMocks()
        document.body.innerHTML = ''
        localStorage.clear()
    })

    it('guia cortada (600 de 900) fecha a lista com "mostrando 600 de 900" e aponta a busca do topo', () => {
        const ws = montarPagina('pt')
        ws.receber(doServidor({ channels: canais(900), playingId: '', epg: null }))

        expect(nomesNaLista().length).toBe(600)
        const linha = linhaDeCorte()
        expect(linha, 'linha de corte no fim da lista').not.toBeNull()
        expect(linha?.textContent).toBe(textoEsperado('pt', 600, 900))
        expect(linha?.textContent?.includes('600')).toBe(true)
        expect(linha?.textContent?.includes('900')).toBe(true)
        // É a ÚLTIMA coisa da lista, depois dos canais.
        expect(lista().lastElementChild).toBe(linha)
    })

    it('buscar na aba um canal que ficou de fora diz "nenhum canal" E que há mais na busca do topo', () => {
        const ws = montarPagina('pt')
        ws.receber(doServidor({ channels: canais(900), playingId: '', epg: null }))

        digitarNaBuscaDaAba('Canal 901')

        expect(nomesNaLista()).toEqual([])
        expect(lista().textContent?.includes(STRINGS.pt.noChannelFound)).toBe(true)
        expect(linhaDeCorte()?.textContent).toBe(textoEsperado('pt', 600, 900))
    })

    it.each(['en', 'es'] as const)('o aviso sai no idioma do controle (%s), não cravado em português', (lang) => {
        const ws = montarPagina(lang)
        ws.receber(doServidor({ channels: canais(750) }))
        expect(linhaDeCorte()?.textContent).toBe(textoEsperado(lang, 600, 750))
        expect(STRINGS[lang].guideTruncated).not.toBe(STRINGS.pt.guideTruncated)
    })

    it('sem corte, nenhuma linha extra — nem com exatamente 600', () => {
        const ws = montarPagina('pt')
        ws.receber(doServidor({ channels: canais(30) }))
        expect(nomesNaLista().length).toBe(30)
        expect(linhaDeCorte()).toBeNull()
        ws.receber(doServidor({ channels: canais(600) }))
        expect(nomesNaLista().length).toBe(600)
        expect(linhaDeCorte()).toBeNull()
    })

    it('servidor antigo (mensagem sem total) não ganha aviso falso', () => {
        const ws = montarPagina('pt')
        ws.receber({ type: 'guide', channels: canais(600), playingId: '', epg: null })
        expect(nomesNaLista().length).toBe(600)
        expect(linhaDeCorte()).toBeNull()
    })

    it('mensagem sem total depois de uma cortada não herda o aviso da anterior', () => {
        // A página fica aberta e reconecta sozinha: se o app do PC voltar a uma
        // versão sem `total`, o aviso velho ("600 de 900") não pode ficar.
        const ws = montarPagina('pt')
        ws.receber(doServidor({ channels: canais(900) }))
        expect(linhaDeCorte()).not.toBeNull()
        ws.receber({ type: 'guide', channels: canais(40), playingId: '', epg: null })
        expect(nomesNaLista().length).toBe(40)
        expect(linhaDeCorte()).toBeNull()
    })

    it('a lista seguinte, já sem corte, tira o aviso', () => {
        const ws = montarPagina('pt')
        ws.receber(doServidor({ channels: canais(900) }))
        expect(linhaDeCorte()).not.toBeNull()
        ws.receber(doServidor({ channels: canais(12) }))
        expect(linhaDeCorte()).toBeNull()
        expect(nomesNaLista().length).toBe(12)
    })
})
