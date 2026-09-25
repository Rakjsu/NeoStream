import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PlaybackSection } from './PlaybackSection'
import { playbackService } from '../../services/playbackService'
import { mpvService } from '../../services/mpvService'

/**
 * D014 — "Baixar MPV" acusava "verifique sua conexao" com o download indo bem.
 *
 * O estado do download vivia so no componente da secao. Quem saia de
 * Configuracoes no meio dos ~31 MB e voltava achava o botao "Baixar MPV
 * automaticamente" de novo — sem barra e sem Cancelar, embora o main seguisse
 * baixando. Clicar ali mandava um segundo `mpv:download-start`, o main
 * respondia `{ success:false, reason:'in-progress' }` e a tela caia no ramo de
 * erro: "Falha ao baixar o MPV. Verifique sua conexao."
 *
 * O teste monta a secao DE VERDADE (react-dom/client + act) sobre um IPC falso
 * que se comporta como o main ANTIGO: um download so por vez e `in-progress`
 * para o segundo pedido (se a tela mandar um segundo, o erro aparece), progresso
 * pelo canal `mpv:download-progress`, resultado quando o download termina.
 */

type Ouvinte = (evento: unknown, ...args: unknown[]) => void

interface Adiado<T> { promessa: Promise<T>; resolver: (v: T) => void }
const adiado = <T,>(): Adiado<T> => {
    let resolver!: (v: T) => void
    const promessa = new Promise<T>((r) => { resolver = r })
    return { promessa, resolver }
}

const MPV_INSTALADO = 'C:/Users/ana/AppData/Roaming/NeoStream/mpv/mpv.exe'

/** Um main de mentira com a regra ANTIGA do mpvPlayer.ts: um download por vez, o 2o pedido leva in-progress. */
function criarMainFalso() {
    const ouvintes = new Map<string, Set<Ouvinte>>()
    let downloadAtual: Adiado<unknown> | null = null
    const chamadas: string[] = []
    let caminhoResolvido: string | null = null

    const ipc = {
        invoke: async (canal: string) => {
            chamadas.push(canal)
            if (canal === 'mpv:available') {
                return { path: caminhoResolvido, configuredPath: caminhoResolvido, downloadSupported: true }
            }
            if (canal === 'mpv:download-start') {
                if (downloadAtual) return { success: false, reason: 'in-progress' }
                downloadAtual = adiado<unknown>()
                return downloadAtual.promessa
            }
            if (canal === 'mpv:download-cancel') {
                if (!downloadAtual) return { success: false }
                const d = downloadAtual
                downloadAtual = null
                d.resolver({ success: false, reason: 'cancelled' })
                return { success: true }
            }
            return { success: true }
        },
        send: () => undefined,
        on: (canal: string, fn: Ouvinte) => {
            if (!ouvintes.has(canal)) ouvintes.set(canal, new Set())
            ouvintes.get(canal)!.add(fn)
        },
        off: (canal: string, fn: Ouvinte) => { ouvintes.get(canal)?.delete(fn) },
        removeListener: (canal: string, fn: Ouvinte) => { ouvintes.get(canal)?.delete(fn) },
        removeAllListeners: (canal: string) => { ouvintes.delete(canal) },
    }

    return {
        ipc,
        chamadas,
        emitirProgresso(percent: number, transferredMB: number, totalMB = 31) {
            for (const fn of ouvintes.get('mpv:download-progress') ?? []) {
                fn({}, { percent, transferredMB, totalMB })
            }
        },
        terminarComSucesso() {
            const d = downloadAtual
            downloadAtual = null
            caminhoResolvido = MPV_INSTALADO
            d?.resolver({ success: true, path: MPV_INSTALADO, version: '20260901' })
        },
        ouvintesDeProgresso: () => ouvintes.get('mpv:download-progress')?.size ?? 0,
    }
}

let main: ReturnType<typeof criarMainFalso>
const raizes: Root[] = []
const lixo: HTMLElement[] = []

beforeEach(() => {
    ; (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    main = criarMainFalso()
        ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = main.ipc
    playbackService.setConfig({ mpvEnabled: true })
})

afterEach(async () => {
    // Nada de download pendurado de um teste para o outro (o servico e singleton).
    await act(async () => { main.terminarComSucesso() })
    await esperar(() => mpvService.getDownloadEmCurso() === null, 'servico sem download')
    for (const r of raizes) { try { r.unmount() } catch { /* ja foi */ } }
    raizes.length = 0
    for (const el of lixo) el.remove()
    lixo.length = 0
    playbackService.setConfig({ mpvEnabled: false })
    try { localStorage.clear() } catch { /* jsdom sem storage */ }
})

function montar() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    lixo.push(container)
    const root = createRoot(container)
    raizes.push(root)
    act(() => { root.render(<PlaybackSection />) })
    return { container, root }
}

/** Espera a CONDICAO (nunca um numero fixo de voltas). */
async function esperar(condicao: () => boolean, oQue: string) {
    const limite = Date.now() + 3000
    while (!condicao()) {
        if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${oQue}`)
        await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    }
}

const texto = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ')
const botaoBaixar = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).find((b) => /Baixar MPV automaticamente/.test(b.textContent ?? ''))
const botaoCancelar = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Cancelar')

describe('D014 — download do MPV sobrevive a sair e voltar das Configuracoes', () => {
    it('ao voltar no meio do download, a barra e o Cancelar reaparecem sozinhos (e nao o botao Baixar)', async () => {
        const primeira = montar()
        await esperar(() => !!botaoBaixar(primeira.container), 'botao Baixar na primeira visita')

        await act(async () => { botaoBaixar(primeira.container)!.click() })
        await esperar(() => !!botaoCancelar(primeira.container), 'barra de download')
        await act(async () => { main.emitirProgresso(40, 12.4) })
        await esperar(() => texto(primeira.container).includes('40% — 12.4 / 31 MB'), 'progresso de 40%')

        // Sai das Configuracoes no meio dos 31 MB...
        act(() => { primeira.root.unmount() })

        // ...o main segue baixando enquanto a tela esta fechada...
        main.emitirProgresso(55, 17.1)

        // ...e a pessoa volta.
        const segunda = montar()
        await esperar(() => texto(segunda.container).includes('mpv não encontrado'), 'secao remontada')

        expect(botaoBaixar(segunda.container)).toBeUndefined()
        expect(botaoCancelar(segunda.container)).toBeDefined()
        // O ultimo progresso conhecido aparece na hora, sem esperar o proximo evento.
        expect(texto(segunda.container).includes('55% — 17.1 / 31 MB')).toBe(true)

        await act(async () => { main.emitirProgresso(80, 24.8) })
        await esperar(() => texto(segunda.container).includes('80% — 24.8 / 31 MB'), 'progresso seguindo na tela nova')

        await act(async () => { main.terminarComSucesso() })
        await esperar(() => texto(segunda.container).includes('MPV instalado'), 'sucesso na tela nova')
        expect(texto(segunda.container).includes('Verifique sua conexão')).toBe(false)
        expect(texto(segunda.container).includes(`MPV encontrado em: ${MPV_INSTALADO}`)).toBe(true)
        // Um download so: a volta nao disparou um segundo mpv:download-start.
        expect(main.chamadas.filter((c) => c === 'mpv:download-start')).toHaveLength(1)
    })

    it('o Cancelar da tela remontada cancela o download de verdade e volta ao botao', async () => {
        const primeira = montar()
        await esperar(() => !!botaoBaixar(primeira.container), 'botao Baixar')
        await act(async () => { botaoBaixar(primeira.container)!.click() })
        await esperar(() => !!botaoCancelar(primeira.container), 'barra de download')
        act(() => { primeira.root.unmount() })

        const segunda = montar()
        await esperar(() => !!botaoCancelar(segunda.container), 'Cancelar na tela remontada')
        await act(async () => { botaoCancelar(segunda.container)!.click() })

        await esperar(() => !!botaoBaixar(segunda.container), 'botao Baixar depois do cancelamento')
        expect(texto(segunda.container).includes('Verifique sua conexão')).toBe(false)
        expect(main.chamadas).toContain('mpv:download-cancel')

        // Cancelado, o botao abre um download NOVO (o servico nao ficou preso no antigo).
        await act(async () => { botaoBaixar(segunda.container)!.click() })
        await esperar(() => !!botaoCancelar(segunda.container), 'barra do download novo')
        expect(main.chamadas.filter((c) => c === 'mpv:download-start')).toHaveLength(2)
    })

    it('terminado o download, nenhum ouvinte de progresso fica pendurado no IPC', async () => {
        const tela = montar()
        await esperar(() => !!botaoBaixar(tela.container), 'botao Baixar')
        await act(async () => { botaoBaixar(tela.container)!.click() })
        await esperar(() => main.ouvintesDeProgresso() > 0, 'ouvinte de progresso assinado')

        await act(async () => { main.terminarComSucesso() })
        await esperar(() => texto(tela.container).includes('MPV instalado'), 'sucesso')
        await esperar(() => main.ouvintesDeProgresso() === 0, 'ouvintes soltos')
    })

    it('dois pedidos seguidos no servico viram UM download so, com o mesmo resultado', async () => {
        const a = mpvService.startDownload()
        const b = mpvService.startDownload()
        await esperar(() => main.chamadas.includes('mpv:download-start'), 'pedido chegar ao main')
        main.terminarComSucesso()
        const [ra, rb] = await Promise.all([a, b])
        expect(ra).toEqual({ success: true, path: MPV_INSTALADO, version: '20260901' })
        expect(rb).toEqual(ra)
        expect(main.chamadas.filter((c) => c === 'mpv:download-start')).toHaveLength(1)
    })

    it('um download novo nao herda o progresso do anterior (cancelado a 55%)', async () => {
        const primeiro = mpvService.startDownload()
        await esperar(() => main.ouvintesDeProgresso() > 0, 'ouvinte de progresso do servico')
        main.emitirProgresso(55, 17.1)
        expect(mpvService.getDownloadEmCurso()?.progresso?.percent).toBe(55)
        await main.ipc.invoke('mpv:download-cancel')
        expect(await primeiro).toEqual({ success: false, reason: 'cancelled' })
        await esperar(() => mpvService.getDownloadEmCurso() === null, 'vaga do primeiro liberada')

        // Quem voltar a tela antes do 1o evento do download novo ve a barra
        // sem numero, nao os 55% do cancelado.
        const segundo = mpvService.startDownload()
        expect(mpvService.getDownloadEmCurso()?.progresso).toBeNull()
        await esperar(() => main.chamadas.filter((c) => c === 'mpv:download-start').length === 2, 'pedido novo chegar ao main')
        main.terminarComSucesso()
        expect(await segundo).toEqual({ success: true, path: MPV_INSTALADO, version: '20260901' })
    })

    it('sem o canal de eventos, o pedido continua sem lancar e nao prende a vaga', async () => {
        // "Never throws": a assinatura do progresso mora dentro do try do pedido.
        ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke: main.ipc.invoke }
        const falho = mpvService.startDownload()
        await expect(falho).resolves.toEqual({ success: false, reason: 'ipc-error' })
        expect(mpvService.getDownloadEmCurso()).toBeNull()

        ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = main.ipc
        const novo = mpvService.startDownload()
        await esperar(() => main.chamadas.includes('mpv:download-start'), 'pedido novo chegar ao main')
        main.terminarComSucesso()
        expect(await novo).toEqual({ success: true, path: MPV_INSTALADO, version: '20260901' })
    })
})
