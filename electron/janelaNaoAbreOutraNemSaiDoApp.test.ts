/**
 * 🛡️ Nenhuma janela abre outra nem sai do próprio index.html (D138).
 *
 * Endurecimento, sem exploração demonstrada: as três janelas (principal, PiP,
 * multi-view) sobem com o preload e a allowlist inteira do `ipcRenderer`
 * (`auth:get-credentials` incluído). Antes, nenhuma declarava
 * `setWindowOpenHandler` nem ouvia `will-navigate`. Medido no app empacotado
 * (Electron 44.4.2): uma navegação do quadro principal para uma página http
 * qualquer chegava lá COM `window.ipcRenderer` (o preload roda de novo), e um
 * `window.open` abria uma 2ª janela solta (sem o `ipcRenderer`, mas fora do
 * controle do app).
 *
 * O teste roda a guarda DE VERDADE contra um `app` e um `webContents` falsos:
 * dispara o `web-contents-created` como o Electron faz e cobra o que acontece
 * com `window.open`, com cada navegação e com `<webview>`. No fim, confere que
 * o main.ts liga a guarda antes da primeira janela.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

type Ouvinte = (...args: unknown[]) => void

const h = vi.hoisted(() => ({
    ouvintesDoApp: new Map<string, Ouvinte>(),
    registrosNoApp: [] as string[],
    openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined),
    warn: vi.fn<(...args: unknown[]) => void>(),
}))

vi.mock('electron', () => ({
    app: {
        on: (evento: string, fn: Ouvinte) => { h.registrosNoApp.push(evento); h.ouvintesDoApp.set(evento, fn) },
    },
    shell: { openExternal: h.openExternal },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: h.warn, error: vi.fn() } }))

import { setupWindowGuard, ehNavegacaoDoApp, destinoExterno } from './windowGuard'

type RespostaDoOpen = { action: 'deny' | 'allow' }

class ConteudoFalso {
    ouvintes = new Map<string, Ouvinte>()
    abrirJanela: ((details: { url: string }) => RespostaDoOpen) | null = null
    constructor(private url: string, private tipo: string = 'window') {}
    getURL() { return this.url }
    getType() { return this.tipo }
    on(evento: string, fn: Ouvinte) { this.ouvintes.set(evento, fn); return this }
    setWindowOpenHandler(fn: (details: { url: string }) => RespostaDoOpen) { this.abrirJanela = fn }
}

/** O que o Electron faz ao criar a janela: avisa o app. */
function criarJanela(url: string, tipo = 'window'): ConteudoFalso {
    const conteudo = new ConteudoFalso(url, tipo)
    const criado = h.ouvintesDoApp.get('web-contents-created')
    expect(criado).toBeTypeOf('function')
    criado!({}, conteudo)
    return conteudo
}

/** Dispara um `will-navigate` e diz se a navegação foi barrada. */
function navegar(conteudo: ConteudoFalso, destino: string): boolean {
    const preventDefault = vi.fn()
    const ouvinte = conteudo.ouvintes.get('will-navigate')
    expect(ouvinte).toBeTypeOf('function')
    ouvinte!({ url: destino, preventDefault })
    return preventDefault.mock.calls.length > 0
}

// Formato do que o Chromium devolve em getURL() depois do loadFile (Windows
// e Linux): a guarda compara com ELA, nunca com uma URL montada à mão.
const INDEX_WIN = 'file:///C:/Program%20Files/NeoStream/resources/app.asar/dist/index.html'
const INDEX_LINUX = 'file:///opt/NeoStream/resources/app.asar/dist/index.html'
const DEV = 'http://localhost:5173/'

describe('D138 — guarda de janelas', () => {
    beforeEach(() => {
        h.openExternal.mockReset()
        h.openExternal.mockImplementation(async () => undefined)
        h.warn.mockClear()
        setupWindowGuard()
    })

    it('liga no web-contents-created (vale pra toda janela, inclusive as futuras)', () => {
        expect(h.ouvintesDoApp.has('web-contents-created')).toBe(true)
    })

    it('ligar de novo não empilha outra guarda (senão o mailto abriria duas vezes)', () => {
        setupWindowGuard()
        setupWindowGuard()
        expect(h.registrosNoApp.filter(e => e === 'web-contents-created')).toHaveLength(1)
    })

    it('window.open é negado — nenhuma 2ª janela solta nasce', () => {
        for (const [atual, alvo] of [
            [INDEX_WIN, 'https://exemplo.invalid/'],
            [`${INDEX_WIN}#/pip?data=x`, INDEX_WIN],
            [DEV, `${DEV}#/dashboard`],
        ]) {
            const janela = criarJanela(atual)
            expect(janela.abrirJanela).toBeTypeOf('function')
            expect(janela.abrirJanela!({ url: alvo })).toEqual({ action: 'deny' })
        }
        // Popup não vira aba do navegador: o iframe do trailer também passa aqui.
        expect(h.openExternal).not.toHaveBeenCalled()
    })

    it('navegar dentro do próprio index.html (rota/hash) passa', () => {
        const principal = criarJanela(`${INDEX_WIN}#/dashboard/live`)
        expect(navegar(principal, `${INDEX_WIN}#/dashboard/vod`)).toBe(false)
        expect(navegar(principal, INDEX_WIN)).toBe(false)

        const pip = criarJanela(`${INDEX_LINUX}#/pip?data=%7B%7D`)
        expect(navegar(pip, `${INDEX_LINUX}#/pip?data=%7B%22a%22%3A1%7D`)).toBe(false)

        const dev = criarJanela(`${DEV}#/multiview`)
        expect(navegar(dev, `${DEV}#/dashboard`)).toBe(false)
        expect(navegar(dev, `${DEV}index.html`)).toBe(false)
        expect(h.openExternal).not.toHaveBeenCalled()
    })

    it('outro arquivo do disco (arquivo solto na janela) é barrado e não sai pra lugar nenhum', () => {
        const janela = criarJanela(`${INDEX_WIN}#/dashboard`)
        expect(navegar(janela, 'file:///C:/Users/fulano/Downloads/pagina.html')).toBe(true)
        expect(navegar(janela, 'file:///C:/Program%20Files/NeoStream/resources/app.asar/dist/outra.html')).toBe(true)
        expect(navegar(janela, 'file://servidor/share/index.html')).toBe(true)

        const linux = criarJanela(INDEX_LINUX)
        expect(navegar(linux, 'file:///home/fulano/pagina.html')).toBe(true)
        // Mesmo caminho, outra máquina (compartilhamento de rede): não é o app.
        expect(navegar(linux, 'file://servidor/opt/NeoStream/resources/app.asar/dist/index.html')).toBe(true)
        expect(h.openExternal).not.toHaveBeenCalled()
    })

    it('https e mailto do quadro principal são barrados no app e seguem pro sistema', () => {
        const janela = criarJanela(INDEX_WIN)
        expect(navegar(janela, 'https://www.themoviedb.org/settings/api')).toBe(true)
        expect(navegar(janela, 'mailto:suporte@neostream.app')).toBe(true)
        expect(h.openExternal.mock.calls.map(c => c[0])).toEqual([
            'https://www.themoviedb.org/settings/api',
            'mailto:suporte@neostream.app',
        ])
        // Seguiu pro sistema: não é registrado como navegação barrada.
        expect(h.warn).not.toHaveBeenCalled()
    })

    it('se o sistema não abre o link (sem cliente de e-mail), vira aviso no log — não promessa solta', async () => {
        h.openExternal.mockImplementation(async () => { throw new Error('sem cliente de e-mail') })
        const janela = criarJanela(INDEX_WIN)
        expect(navegar(janela, 'mailto:suporte@neostream.app')).toBe(true)
        await vi.waitFor(() => {
            expect(h.warn.mock.calls.some(c => String(c[0]).includes('não abriu o link'))).toBe(true)
        })
    })

    it('http em claro, javascript:, data: e outra porta do dev server: barrados, sem sair', () => {
        const dev = criarJanela(DEV)
        expect(navegar(dev, 'http://localhost:5174/')).toBe(true)
        expect(navegar(dev, 'http://exemplo.invalid/')).toBe(true)
        // Parecidos com a origem do dev server, mas outra origem: comparar
        // por prefixo de texto deixaria os dois entrarem.
        expect(navegar(dev, 'http://localhost:51730/')).toBe(true)
        expect(navegar(dev, 'http://localhost:5173.exemplo.invalid/')).toBe(true)
        expect(navegar(dev, 'http://localhost:5173@exemplo.invalid/')).toBe(true)

        const janela = criarJanela(INDEX_WIN)
        expect(navegar(janela, 'http://exemplo.invalid/')).toBe(true)
        expect(navegar(janela, 'javascript:alert(1)')).toBe(true)
        expect(navegar(janela, 'data:text/html,<p>x</p>')).toBe(true)
        expect(navegar(janela, 'não é url')).toBe(true)
        expect(h.openExternal).not.toHaveBeenCalled()
    })

    it('<webview> não se anexa', () => {
        const janela = criarJanela(INDEX_WIN)
        const preventDefault = vi.fn()
        janela.ouvintes.get('will-attach-webview')!({ preventDefault }, {}, {})
        expect(preventDefault).toHaveBeenCalledTimes(1)
    })

    it('DevTools (e o que não é janela do app) fica de fora', () => {
        const devtools = criarJanela('devtools://devtools/bundled/devtools_app.html', 'remote')
        expect(devtools.abrirJanela).toBeNull()
        expect(devtools.ouvintes.size).toBe(0)
    })

    it('funções puras: origem própria e destino externo', () => {
        expect(ehNavegacaoDoApp(`${INDEX_WIN}#/x`, INDEX_WIN)).toBe(true)
        expect(ehNavegacaoDoApp(`${INDEX_WIN}?q=1`, INDEX_WIN)).toBe(true)
        expect(ehNavegacaoDoApp('file:///C:/outro/index.html', INDEX_WIN)).toBe(false)
        expect(ehNavegacaoDoApp('https://localhost:5173/', DEV)).toBe(false)
        // Janela ainda sem URL (ou numa origem opaca): nada passa.
        expect(ehNavegacaoDoApp(INDEX_WIN, '')).toBe(false)
        expect(ehNavegacaoDoApp(INDEX_WIN, 'about:blank')).toBe(false)

        expect(destinoExterno('https://exemplo.invalid/a b')).toBe('https://exemplo.invalid/a%20b')
        expect(destinoExterno('mailto:a@b.c')).toBe('mailto:a@b.c')
        expect(destinoExterno('http://exemplo.invalid/')).toBeNull()
        expect(destinoExterno('file:///C:/x.html')).toBeNull()
        expect(destinoExterno('javascript:alert(1)')).toBeNull()
        expect(destinoExterno('lixo')).toBeNull()
    })
})

describe('D138 — main.ts liga a guarda antes da primeira janela', () => {
    const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8').replace(/\r\n/g, '\n')

    it('importa e chama setupWindowGuard() no topo, antes do whenReady/createWindow', () => {
        expect(main.includes("import { setupWindowGuard } from './windowGuard'")).toBe(true)
        const chamada = main.indexOf('\nsetupWindowGuard()\n')
        expect(chamada).toBeGreaterThan(-1)
        expect(chamada).toBeLessThan(main.indexOf('app.whenReady()'))
        expect(chamada).toBeLessThan(main.indexOf('function createWindow('))
    })
})
