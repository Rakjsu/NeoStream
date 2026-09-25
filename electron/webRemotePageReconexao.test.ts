// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderRemotePage } from './webRemotePage'
import { STRINGS } from './webRemoteStrings'
import { WS_CLOSE_PIN_ROTATED } from './webRemoteProtocol'

/**
 * D102 — o `regen-pin` do desktop fecha cada cliente com o código privado 4001
 * (WS_CLOSE_PIN_ROTATED) justamente pra dizer "o PIN mudou". A página do
 * celular ignorava o evento do `onclose`: como já estava conectada, caía no
 * ramo de reconexão e tentava o PIN morto a cada 1,5 s pra sempre — status
 * "Reconectando…" eterno, campo de PIN nunca aparecia, e o anti brute-force
 * do servidor (5 erros → 30 s) trancava o IP do próprio celular do dono.
 *
 * Aqui o <script> servido RODA de verdade no jsdom, com um WebSocket falso e
 * timers falsos (o relógio anda só quando o teste manda).
 */

class FakeWS {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    static all: FakeWS[] = []
    /** Rede fora / PC desligado: toda conexão nova cai logo depois de criada. */
    static recusarNovas = false
    url: string
    criadoEm = Date.now()
    caiuEm = -1
    readyState = 0
    sent: string[] = []
    onopen: ((ev?: unknown) => void) | null = null
    onclose: ((ev?: unknown) => void) | null = null
    onmessage: ((ev?: unknown) => void) | null = null
    onerror: ((ev?: unknown) => void) | null = null
    constructor(url: string) {
        this.url = url
        FakeWS.all.push(this)
        if (FakeWS.recusarNovas) setTimeout(() => this.cair(1006), 0)
    }
    send(data: string) { this.sent.push(data) }
    close() { this.readyState = 3 }
    abrir() { this.readyState = 1; this.onopen?.({}) }
    cair(code: number, reason = '') {
        if (this.readyState === 3) return   // como no navegador: um `close` por socket
        this.readyState = 3
        this.caiuEm = Date.now()
        this.onclose?.({ code, reason, wasClean: code !== 1006 })
    }
}

function scriptDa(pagina: string): string {
    const ini = pagina.indexOf('<script>')
    const fim = pagina.indexOf('</script>')
    return pagina.slice(ini + '<script>'.length, fim)
}

/**
 * Ouvintes que o script da página pendura no `document`. O `document` do jsdom
 * vive o arquivo inteiro: sem soltar, o ouvinte de um teste anterior (com o
 * closure dele) reagiria ao `visibilitychange` do seguinte.
 */
let ouvintesDoDocumento: Array<[string, EventListenerOrEventListenerObject]> = []

function montarPagina(): void {
    const pendurar = document.addEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation(((tipo: string, fn: EventListenerOrEventListenerObject) => {
        ouvintesDoDocumento.push([tipo, fn])
        pendurar(tipo, fn)
    }) as typeof document.addEventListener)
    const pagina = renderRemotePage('pt')
    const corpoIni = pagina.indexOf('<body')
    const corpo = pagina.slice(pagina.indexOf('>', corpoIni) + 1, pagina.indexOf('<script>'))
    document.body.innerHTML = corpo
    new Function(scriptDa(pagina))()
}

/** Troca de aba / tela do celular apagando e acendendo. */
function mudarVisibilidade(escondida: boolean): void {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => escondida })
    document.dispatchEvent(new Event('visibilitychange'))
}

/** Anda o relógio falso em passos de 100 ms até a condição valer (teto: 10 min). */
function avancarAte(cond: () => boolean): void {
    for (let t = 0; t <= 600_000 && !cond(); t += 100) vi.advanceTimersByTime(100)
    expect(cond()).toBe(true)
}

const pinCard = () => document.getElementById('pin-card') as HTMLElement
const connected = () => document.getElementById('connected') as HTMLElement
const pinErr = () => document.getElementById('pin-err') as HTMLElement
const ultimo = () => FakeWS.all[FakeWS.all.length - 1]
/** Espera entre a queda de cada socket e a criação do seguinte. */
const intervalos = () => FakeWS.all.slice(1).map((ws, i) => ws.criadoEm - FakeWS.all[i].caiuEm)

describe('página do celular: queda do WebSocket (D102)', () => {
    beforeEach(() => {
        FakeWS.all = []
        FakeWS.recusarNovas = false
        vi.useFakeTimers()
        vi.stubGlobal('WebSocket', FakeWS)
        localStorage.clear()
        localStorage.setItem('neostream_remote_pin', '1234')
        montarPagina()
        // Entrou com o PIN salvo e o servidor aceitou.
        expect(FakeWS.all.length).toBe(1)
        expect(FakeWS.all[0].url).toContain('pin=1234')
        FakeWS.all[0].abrir()
        expect(connected().style.display).toBe('flex')
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.unstubAllGlobals()
        for (const [tipo, fn] of ouvintesDoDocumento) document.removeEventListener(tipo, fn)
        ouvintesDoDocumento = []
        vi.restoreAllMocks()
        // Tira o `hidden` próprio e volta ao getter do jsdom.
        delete (document as unknown as { hidden?: boolean }).hidden
        document.body.innerHTML = ''
        localStorage.clear()
    })

    it('fechado com 4001 (PIN regenerado) pede o código novo em vez de reconectar com o morto', () => {
        FakeWS.all[0].cair(WS_CLOSE_PIN_ROTATED, 'pin-rotated')

        expect(pinCard().style.display).toBe('block')
        expect(connected().style.display).toBe('none')
        expect(STRINGS.pt.pinRotated).toBeTruthy()
        expect(pinErr().textContent).toBe(STRINGS.pt.pinRotated)
        // O PIN salvo morreu: recarregar a página não pode gastar tentativa com ele.
        expect(localStorage.getItem('neostream_remote_pin')).toBeNull()

        // Nenhuma reconexão com o PIN velho, nem depois de um minuto, nem ao
        // voltar pra tela.
        vi.advanceTimersByTime(60_000)
        mudarVisibilidade(false)
        expect(FakeWS.all.length).toBe(1)
    })

    it('depois do 4001, digitar o PIN novo conecta com ele', () => {
        FakeWS.all[0].cair(WS_CLOSE_PIN_ROTATED, 'pin-rotated')
        const input = document.getElementById('pin-input') as HTMLInputElement
        input.value = '9876'
        ;(document.getElementById('pin-ok') as HTMLButtonElement).click()

        expect(FakeWS.all.length).toBe(2)
        expect(ultimo().url).toContain('pin=9876')
        ultimo().abrir()
        expect(connected().style.display).toBe('flex')
        expect(localStorage.getItem('neostream_remote_pin')).toBe('9876')
    })

    it('queda comum reconecta em 1,5 s e depois dobra a espera até o teto de 30 s', () => {
        FakeWS.recusarNovas = true
        FakeWS.all[0].cair(1006)
        expect(document.getElementById('status')?.textContent).toBe(STRINGS.pt.reconnecting)

        vi.advanceTimersByTime(5 * 60_000)

        // A 1,5 s fixo seriam ~200 tentativas em 5 min; aqui, 13.
        const gaps = intervalos()
        expect(gaps.slice(0, 7)).toEqual([1500, 3000, 6000, 12000, 24000, 30000, 30000])
        expect(gaps.slice(7).every((g) => g === 30_000)).toBe(true)
        // Nunca desiste: continua tentando com o mesmo PIN.
        expect(gaps.length).toBeGreaterThan(10)
        expect(ultimo().url).toContain('pin=1234')
    })

    it('voltar a conectar zera o espaçamento: a próxima queda reconecta em 1,5 s de novo', () => {
        FakeWS.recusarNovas = true
        FakeWS.all[0].cair(1006)
        avancarAte(() => FakeWS.all.length === 4 && ultimo().readyState === 3)   // 3 retentativas falharam
        expect(intervalos()).toEqual([1500, 3000, 6000])

        FakeWS.recusarNovas = false
        avancarAte(() => FakeWS.all.length === 5)
        expect(intervalos()[3]).toBe(12_000)
        ultimo().abrir()                              // voltou

        ultimo().cair(1006)
        vi.advanceTimersByTime(1499)
        expect(FakeWS.all.length).toBe(5)
        vi.advanceTimersByTime(1)
        expect(FakeWS.all.length).toBe(6)
    })

    it('voltar pra tela com retentativa pendente tenta na hora, uma vez, e recomeça do 1,5 s', () => {
        // Celular bloqueado e sem rede: a espera cresceu até o teto.
        mudarVisibilidade(true)
        FakeWS.recusarNovas = true
        FakeWS.all[0].cair(1006)
        vi.advanceTimersByTime(60_000)
        const antes = FakeWS.all.length
        // Ficar escondida não antecipa nada.
        mudarVisibilidade(true)
        expect(FakeWS.all.length).toBe(antes)

        // Desbloqueou: a tentativa sai já, sem esperar os até 30 s pendentes.
        mudarVisibilidade(false)
        expect(FakeWS.all.length).toBe(antes + 1)
        expect(ultimo().url).toContain('pin=1234')

        // A rede ainda está voltando: a próxima espera é a curta, não a de 30 s.
        FakeWS.recusarNovas = false
        ultimo().cair(1006)
        vi.advanceTimersByTime(1499)
        expect(FakeWS.all.length).toBe(antes + 1)
        vi.advanceTimersByTime(1)
        expect(FakeWS.all.length).toBe(antes + 2)
        ultimo().abrir()

        // O timer antigo (de antes de voltar pra tela) foi cancelado: nada de
        // um segundo socket aparecendo do nada.
        vi.advanceTimersByTime(60_000)
        expect(FakeWS.all.length).toBe(antes + 2)
    })

    it('conectado, trocar de aba e voltar não abre outro socket', () => {
        // Passa por uma reconexão que deu certo: o timer dela já disparou.
        FakeWS.all[0].cair(1006)
        vi.advanceTimersByTime(1500)
        expect(FakeWS.all.length).toBe(2)
        ultimo().abrir()

        mudarVisibilidade(true)
        mudarVisibilidade(false)
        vi.advanceTimersByTime(60_000)
        expect(FakeWS.all.length).toBe(2)
    })
})
