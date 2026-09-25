// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { renderRemotePage } from './webRemotePage'
import { STRINGS } from './webRemoteStrings'
import { parseRemoteCommand } from './webRemoteProtocol'

/**
 * D193 — o botão 🎉 (fila da festa) do controle web tinha dois defeitos:
 *   1. o `title` era "Fila da festa" cravado, enquanto todo rótulo vizinho vem
 *      do dicionário `L` — em inglês/espanhol ele era o único em português;
 *   2. só existia na aba 🎬 Filmes. Quem chegava ao filme pela busca do topo ou
 *      pelos recomendados ("Porque você assistiu") não tinha como pôr na fila —
 *      e, nos recomendados, tocar a linha TRANSMITE o filme na hora.
 *
 * O <script> servido RODA de verdade no jsdom, com um WebSocket falso: o teste
 * entrega as mensagens que o servidor mandaria e toca nos botões. O que a
 * página manda é lido pelo MESMO `parseRemoteCommand` do servidor — um comando
 * que ele recusaria não conta como "pôs na fila".
 */

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

/** Comandos de filme que a página mandou, como o SERVIDOR os entende. */
const comandosDeFilme = (ws: FakeWS) => ws.sent
    .map((s) => parseRemoteCommand(s))
    .filter((c) => c !== null && (c.action === 'partyAdd' || c.action === 'castMovie'))

function botaoFesta(listaId: string, movieId: string): HTMLButtonElement {
    const btn = document.querySelector(`#${listaId} [data-party="${movieId}"]`) as HTMLButtonElement | null
    expect(btn, `botão 🎉 do filme ${movieId} em #${listaId}`).not.toBeNull()
    return btn as HTMLButtonElement
}

describe('controle web: botão 🎉 da fila da festa (D193)', () => {
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

    it.each(['pt', 'en', 'es'] as const)('o rótulo do 🎉 sai do dicionário do idioma (%s)', (lang) => {
        expect(STRINGS[lang].partyQueue, `${lang}.partyQueue`).toBeTruthy()
        const ws = montarPagina(lang)
        ws.receber({ type: 'catalog', items: [{ id: '11', name: 'Filme', cover: '' }] })
        expect(botaoFesta('mvlist', '11').title).toBe(STRINGS[lang].partyQueue)
    })

    it('em inglês e espanhol nada da página diz "Fila da festa"', () => {
        expect(renderRemotePage('en').includes('Fila da festa')).toBe(false)
        expect(renderRemotePage('es').includes('Fila da festa')).toBe(false)
    })

    it('na aba Filmes o 🎉 continua pondo na fila, sem transmitir', () => {
        const ws = montarPagina('pt')
        ws.receber({ type: 'catalog', items: [{ id: '11', name: 'Filme', cover: '' }] })
        const btn = botaoFesta('mvlist', '11')
        btn.click()
        expect(comandosDeFilme(ws)).toEqual([{ action: 'partyAdd', movieId: '11' }])
        expect(btn.textContent).toBe('✓')
    })

    it('um filme achado pela busca do topo vai para a fila da festa', () => {
        const ws = montarPagina('en')
        const busca = document.getElementById('gsearch') as HTMLInputElement
        busca.value = 'matrix'
        busca.dispatchEvent(new Event('input'))
        ws.receber({ type: 'catalog', items: [{ id: '42', name: 'Matrix', cover: '' }] })

        const btn = botaoFesta('srlist', '42')
        expect(btn.title).toBe(STRINGS.en.partyQueue)
        btn.click()

        // Sem o ramo próprio, o toque caía no da linha e mandava `castMovie`.
        expect(comandosDeFilme(ws)).toEqual([{ action: 'partyAdd', movieId: '42' }])
        expect(btn.textContent).toBe('✓')
        // O 📡 da mesma linha segue transmitindo.
        ;(document.querySelector('#srlist [data-srcast="42"]') as HTMLButtonElement).click()
        expect(comandosDeFilme(ws)[1]).toMatchObject({ action: 'castMovie', movieId: '42' })
    })

    it('o servidor repassa o partyAdd ao app — mesmo com a TV transmitindo', () => {
        // Camada do meio: `webRemoteServer.ts` importa o `electron` e não roda
        // aqui, então a trava é estrutural. O lado do app é testado rodando em
        // src/components/filaDaFestaDoControleWeb.test.tsx.
        const fonte = fs.readFileSync(path.join(__dirname, 'webRemoteServer.ts'), 'utf-8').split('\r\n').join('\n')
        // Fora do RENDERER_ONLY, com cast ativo o comando iria para a sessão
        // de cast — justamente na festa, que é quando a TV está tocando.
        const rendererOnly = fonte.slice(fonte.indexOf('const RENDERER_ONLY'), fonte.indexOf('\n', fonte.indexOf('const RENDERER_ONLY')))
        expect(rendererOnly.includes("'partyAdd'")).toBe(true)
        const ini = fonte.indexOf('function forwardCommand(')
        const corpo = fonte.slice(ini, fonte.indexOf('\n}\n', ini))
        expect(ini).toBeGreaterThan(-1)
        expect(corpo.includes("win.webContents.send('media:control', 'partyAdd', command.movieId)")).toBe(true)
    })

    it('um filme recomendado vai para a fila da festa — e o toque NÃO transmite o filme', () => {
        const ws = montarPagina('es')
        ws.receber({
            type: 'recommended',
            groups: [{
                seed: 'Algo',
                items: [
                    { kind: 'movie', id: '7', name: 'Recomendado', cover: '' },
                    { kind: 'series', id: '9', name: 'Uma série', cover: '' },
                ],
            }],
        })

        const btn = botaoFesta('reclist', '7')
        expect(btn.title).toBe(STRINGS.es.partyQueue)
        btn.click()

        // Sem o ramo próprio, o toque caía no da linha e mandava `castMovie`.
        expect(comandosDeFilme(ws)).toEqual([{ action: 'partyAdd', movieId: '7' }])
        expect(btn.textContent).toBe('✓')
        // Série não entra na fila da festa (a fila é de filmes).
        expect(document.querySelector('#reclist [data-recse="9"] [data-party]')).toBeNull()
        // O 📡 do recomendado segue transmitindo.
        ;(document.querySelector('#reclist [data-reccast="7"]') as HTMLButtonElement).click()
        expect(comandosDeFilme(ws)[1]).toMatchObject({ action: 'castMovie', movieId: '7' })
    })
})
