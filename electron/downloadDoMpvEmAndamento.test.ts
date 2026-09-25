/**
 * D014 — o segundo `mpv:download-start` virava "verifique sua conexao".
 *
 * Com um download do mpv ja em curso, o main respondia a um novo pedido com
 * `{ success:false, reason:'in-progress' }`. A tela so conhece `cancelled` e
 * `unsupported-platform`; todo o resto cai no ramo de erro — entao quem
 * recarregava a janela (ou voltava as Configuracoes com a tela zerada) e
 * clicava "Baixar MPV" de novo lia "Falha ao baixar o MPV. Verifique sua
 * conexao." com o download indo bem no main.
 *
 * O conserto no main: o segundo pedido recebe o MESMO resultado do download em
 * curso. So a janela principal pede o download e recarregar mantem o mesmo
 * WebContents, entao o "segundo pedido" aqui vem do mesmo remetente.
 * Aqui roda o handler de verdade (`setupMpvHandlers`) com o Electron falso e o
 * `installMpv` controlado pelo teste.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Progresso = { percent: number; transferredMB: number; totalMB: number }
type OpcoesInstalacao = { signal?: AbortSignal; onProgress?: (p: Progresso) => void }
type Resultado = { success: boolean; path?: string; reason?: string; version?: string }

const estado = vi.hoisted(() => ({
    temp: '',
    handlers: new Map<string, IpcHandler>(),
    instalacoes: [] as { opcoes: OpcoesInstalacao; resolver: (r: Resultado) => void }[],
    gravado: {} as Record<string, unknown>,
    /** Faz o proximo installMpv lancar ANTES do primeiro await. */
    lancarNaHora: false,
}))

vi.mock('electron', () => ({
    app: {
        getPath: (nome: string) => (nome === 'temp' ? estado.temp : `${estado.temp}/${nome}`),
        on: () => undefined,
        isReady: () => true,
        whenReady: () => Promise.resolve(),
    },
    ipcMain: { handle: (canal: string, fn: IpcHandler) => estado.handlers.set(canal, fn) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    net: { request: () => undefined, fetch: () => Promise.reject(new Error('sem rede no teste')) },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    shell: { openPath: async () => '', showItemInFolder: () => undefined },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
}))

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./store', () => ({
    default: {
        get: (chave: string) => (chave === 'settings' ? { ...estado.gravado } : undefined),
        set: (chave: string, valor: Record<string, unknown>) => {
            if (chave === 'settings') estado.gravado = { ...valor }
        },
    },
}))

vi.mock('./mpvDownloader', () => ({
    installMpv: (opcoes: OpcoesInstalacao) => {
        if (estado.lancarNaHora) {
            estado.lancarNaHora = false
            throw new Error('falhou antes do primeiro await')
        }
        return new Promise<Resultado>((resolver) => {
            estado.instalacoes.push({ opcoes, resolver })
        })
    },
}))

function remetente() {
    const recebidos: Progresso[] = []
    return {
        recebidos,
        sender: {
            isDestroyed: () => false,
            send: (canal: string, dado: Progresso) => {
                if (canal === 'mpv:download-progress') recebidos.push(dado)
            },
        },
    }
}

/** Espera a CONDICAO, nunca um numero fixo de voltas. */
async function esperar(condicao: () => boolean, oQue: string) {
    const limite = Date.now() + 3000
    while (!condicao()) {
        if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${oQue}`)
        await new Promise((r) => setTimeout(r, 5))
    }
}

describe('D014 — mpv:download-start com um download ja em curso', () => {
    let mpvPlayer: typeof import('./mpvPlayer') | null = null

    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.instalacoes.length = 0
        estado.gravado = {}
        estado.lancarNaHora = false
        estado.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-d014-'))
        mpvPlayer = await import('./mpvPlayer')
        mpvPlayer.setupMpvHandlers()
    })

    afterEach(() => {
        for (const i of estado.instalacoes) i.resolver({ success: false, reason: 'cancelled' })
        mpvPlayer?.stopMpv()
        mpvPlayer = null
        fs.rmSync(estado.temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    const chamar = (canal: string, evento: unknown) => {
        const handler = estado.handlers.get(canal)
        expect(handler, `o canal ${canal} sumiu`).toBeDefined()
        return handler!(evento) as Promise<Resultado>
    }

    it('a tela recarregada pede de novo: mesmo resultado, uma instalacao so, o progresso segue chegando', async () => {
        const janela = remetente()

        const pedido1 = chamar('mpv:download-start', { sender: janela.sender })
        await esperar(() => estado.instalacoes.length === 1, 'primeira instalacao comecar')

        // O segundo pedido NAO responde com uma falha: ele espera o download
        // que ja esta rodando (a prova e o resultado, conferido no fim).
        const pedido2 = chamar('mpv:download-start', { sender: janela.sender })
        estado.instalacoes[0].opcoes.onProgress?.({ percent: 60, transferredMB: 18.6, totalMB: 31 })

        // E nao abre um segundo download em paralelo.
        expect(estado.instalacoes).toHaveLength(1)
        expect(janela.recebidos).toEqual([{ percent: 60, transferredMB: 18.6, totalMB: 31 }])

        // O executavel existe no disco: assim o resolveMpvPath(true) do fim do
        // download acha o caminho gravado sem sondar o PATH da maquina.
        const instalado = path.join(estado.temp, 'userData', 'mpv', 'mpv.exe')
        fs.mkdirSync(path.dirname(instalado), { recursive: true })
        fs.writeFileSync(instalado, '')
        estado.instalacoes[0].resolver({ success: true, path: instalado, version: '20260901' })

        const [r1, r2] = await Promise.all([pedido1, pedido2])
        expect(r1).toEqual({ success: true, path: instalado, version: '20260901' })
        expect(r2).toEqual(r1)
        expect(estado.gravado.mpvPath).toBe(instalado)
    })

    it('terminado o download, um pedido novo abre OUTRO download (a vaga nao fica presa)', async () => {
        const janela = remetente()
        const pedido1 = chamar('mpv:download-start', { sender: janela.sender })
        await esperar(() => estado.instalacoes.length === 1, 'primeira instalacao')
        estado.instalacoes[0].resolver({ success: false, reason: 'cancelled' })
        expect(await pedido1).toEqual({ success: false, reason: 'cancelled' })

        const pedido2 = chamar('mpv:download-start', { sender: janela.sender })
        await esperar(() => estado.instalacoes.length === 2, 'segunda instalacao')
        estado.instalacoes[1].resolver({ success: false, reason: 'download-failed' })
        expect(await pedido2).toEqual({ success: false, reason: 'download-failed' })
    })

    it('uma falha antes do primeiro await tambem libera a vaga', async () => {
        const janela = remetente()
        estado.lancarNaHora = true
        await expect(chamar('mpv:download-start', { sender: janela.sender })).rejects.toThrow('falhou antes do primeiro await')

        const pedido = chamar('mpv:download-start', { sender: janela.sender })
        await esperar(() => estado.instalacoes.length === 1, 'instalacao depois da falha')
        estado.instalacoes[0].resolver({ success: false, reason: 'cancelled' })
        expect(await pedido).toEqual({ success: false, reason: 'cancelled' })
    })

    it('o Cancelar depois do segundo pedido cancela o download unico, e os dois pedidos sabem', async () => {
        const janela = remetente()
        const pedido1 = chamar('mpv:download-start', { sender: janela.sender })
        await esperar(() => estado.instalacoes.length === 1, 'instalacao')
        const pedido2 = chamar('mpv:download-start', { sender: janela.sender })

        expect(await chamar('mpv:download-cancel', { sender: janela.sender })).toEqual({ success: true })
        expect(estado.instalacoes[0].opcoes.signal?.aborted).toBe(true)

        estado.instalacoes[0].resolver({ success: false, reason: 'cancelled' })
        expect(await pedido1).toEqual({ success: false, reason: 'cancelled' })
        expect(await pedido2).toEqual({ success: false, reason: 'cancelled' })
        expect(estado.instalacoes).toHaveLength(1)
    })
})
