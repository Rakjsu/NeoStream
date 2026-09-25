/**
 * 📐 A janela principal reabre onde o usuário deixou (D121).
 *
 * Antes: todo boot abria em 1200×800 na posição padrão, mesmo pra quem deixa o
 * app num monitor secundário — o PiP já lembrava os próprios bounds, a
 * principal não. Aqui a peça roda de verdade, do jeito que o main.ts a usa
 * (`prepararJanelaPrincipal` com um "arquivo" e uma "tela" falsos), contra uma
 * janela falsa que dispara os eventos como o Electron: mover/redimensionar
 * grava, o PRÓXIMO BOOT (nova chamada, mesmo arquivo) reabre ali, e o monitor
 * que saiu devolve o tamanho de fábrica. No fim, confere que o main.ts e o PiP
 * usam esta mesma peça.
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Rectangle } from 'electron'
import {
    boundsIniciaisDaJanelaPrincipal,
    boundsVisiveis,
    lembrarBoundsDaJanela,
    lerBoundsSalvos,
    prepararJanelaPrincipal,
    TAMANHO_PADRAO_DA_JANELA,
    type ArquivoDoEstadoDaJanela,
    type JanelaComBounds,
    type Monitor,
    type TelaDoSistema,
} from './boundsDaJanela'

const PRINCIPAL: Monitor = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
}
const SECUNDARIO: Monitor = {
    bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
    workArea: { x: 1920, y: 0, width: 1280, height: 984 },
}

class JanelaFalsa implements JanelaComBounds {
    ouvintes = new Map<string, Array<() => void>>()
    bounds: Rectangle = { x: 100, y: 100, width: 1200, height: 800 }
    minimizada = false
    destruida = false
    telaCheia = false
    on(evento: string, fn: () => void) {
        const lista = this.ouvintes.get(evento) ?? []
        lista.push(fn)
        this.ouvintes.set(evento, lista)
        return this
    }
    emitir(evento: string) { for (const fn of this.ouvintes.get(evento) ?? []) fn() }
    getBounds() { return { ...this.bounds } }
    isDestroyed() { return this.destruida }
    isMinimized() { return this.minimizada }
    isFullScreen() { return this.telaCheia }
}

/** Um electron-store em memória: o MESMO objeto sobrevive entre "boots". */
class ArquivoFalso implements ArquivoDoEstadoDaJanela {
    dados = new Map<string, unknown>()
    get(chave: 'mainBounds') { return this.dados.get(chave) }
    set(chave: 'mainBounds', valor: Rectangle) { this.dados.set(chave, valor) }
}

/** O `screen` do Electron com os monitores dados (getDisplayMatching pelo canto, como o Electron faz com a maior interseção). */
function telaCom(monitores: Monitor[]): TelaDoSistema {
    return {
        getAllDisplays: () => monitores,
        getDisplayMatching: (b) => monitores.find(m => boundsVisiveis(b, [m])) ?? monitores[0],
    }
}

/** Um boot do app: o que o createWindow do main.ts faz. */
function boot(arquivo: ArquivoDoEstadoDaJanela, monitores: Monitor[] = [PRINCIPAL, SECUNDARIO]) {
    const avisar = vi.fn()
    const estado = prepararJanelaPrincipal(() => arquivo, telaCom(monitores), avisar)
    const janela = new JanelaFalsa()
    estado.lembrar(janela)
    return { bounds: estado.bounds, janela, avisar }
}

describe('janela principal lembra tamanho e posição (D121)', () => {
    it('primeiro boot (nada salvo) abre no tamanho de fábrica, sem x/y', () => {
        const { bounds, avisar } = boot(new ArquivoFalso())
        expect(bounds).toEqual({ width: 1200, height: 800 })
        expect(TAMANHO_PADRAO_DA_JANELA).toEqual({ width: 1200, height: 800 })
        expect(avisar).not.toHaveBeenCalled()
    })

    it('mover pro monitor secundário e redimensionar: o PRÓXIMO BOOT reabre lá', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.bounds = { x: 2000, y: 50, width: 1000, height: 700 }
        janela.emitir('moved')
        janela.bounds = { x: 2000, y: 50, width: 1100, height: 900 }
        janela.emitir('resized')

        expect(boot(arquivo).bounds).toEqual({ x: 2000, y: 50, width: 1100, height: 900 })
    })

    it('fechar/esconder na bandeja também grava (no Linux não há moved/resized)', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.bounds = { x: 300, y: 200, width: 900, height: 600 }
        janela.emitir('close')
        expect(boot(arquivo).bounds).toEqual({ x: 300, y: 200, width: 900, height: 600 })
    })

    it('monitor secundário desconectado: volta pro tamanho de fábrica em vez de abrir fora da tela', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.bounds = { x: 2000, y: 50, width: 1100, height: 900 }
        janela.emitir('moved')
        expect(boot(arquivo, [PRINCIPAL]).bounds).toEqual({ width: 1200, height: 800 })
    })

    it('janela salva maior que a tela de agora é recortada à workArea do monitor', () => {
        const salvo = { x: 1930, y: 0, width: 1900, height: 1100 }
        expect(boundsIniciaisDaJanelaPrincipal(salvo, [PRINCIPAL, SECUNDARIO]))
            .toEqual({ x: 1930, y: 0, width: 1280, height: 984 })
    })

    it('janela minúscula salva cresce até o mínimo', () => {
        const salvo = { x: 10, y: 10, width: 50, height: 20 }
        expect(boundsIniciaisDaJanelaPrincipal(salvo, [PRINCIPAL])).toEqual({ x: 10, y: 10, width: 320, height: 240 })
    })

    it('lixo no arquivo não quebra o boot: cai no tamanho de fábrica', () => {
        for (const lixo of [null, 'x', 42, [], {}, { x: 1, y: 2, width: 3 }, { x: NaN, y: 0, width: 800, height: 600 },
            { x: 0, y: 0, width: '800', height: 600 }, { x: 0, y: 0, width: 0, height: 600 },
            { x: 0, y: 0, width: 800, height: -1 }, { x: 0, y: 0, width: Infinity, height: 600 }]) {
            expect(boundsIniciaisDaJanelaPrincipal(lixo, [PRINCIPAL])).toEqual({ width: 1200, height: 800 })
        }
        expect(lerBoundsSalvos({ x: 10.4, y: 20.6, width: 800.2, height: 600.7 }))
            .toEqual({ x: 10, y: 21, width: 800, height: 601 })
    })

    it('arquivo ilegível (electron-store lança ao abrir) abre no padrão, avisa no log e não grava', () => {
        const avisar = vi.fn()
        const estado = prepararJanelaPrincipal(() => { throw new SyntaxError('JSON corrompido') }, telaCom([PRINCIPAL]), avisar)
        expect(estado.bounds).toEqual({ width: 1200, height: 800 })
        expect(avisar).toHaveBeenCalledTimes(1)
        const janela = new JanelaFalsa()
        expect(() => estado.lembrar(janela)).not.toThrow()
        expect(janela.ouvintes.size).toBe(0)
    })

    it('minimizada ou destruída não grava (no Windows a minimizada vem em -32000)', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.minimizada = true
        janela.bounds = { x: -32000, y: -32000, width: 160, height: 28 }
        janela.emitir('moved')
        janela.emitir('resized')
        janela.emitir('close')
        expect(arquivo.dados.has('mainBounds')).toBe(false)

        janela.minimizada = false
        janela.destruida = true
        janela.bounds = { x: 300, y: 200, width: 900, height: 600 }
        janela.emitir('close')
        expect(arquivo.dados.has('mainBounds')).toBe(false)
    })

    it('tela cheia do player (requestFullscreen) não vira o "tamanho normal"', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.bounds = { x: 150, y: 120, width: 1000, height: 700 }
        janela.emitir('resized')
        janela.telaCheia = true
        janela.bounds = { ...PRINCIPAL.bounds }
        janela.emitir('resized')
        janela.emitir('close') // Alt+F4 / "Sair" da bandeja com o vídeo em tela cheia
        expect(boot(arquivo).bounds).toEqual({ x: 150, y: 120, width: 1000, height: 700 })
    })

    it('a geometria do maximizado próprio (== workArea, com 1 px de arredondamento) não vira o "tamanho normal"', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.bounds = { x: 150, y: 120, width: 1000, height: 700 }
        janela.emitir('resized')
        // Clique no maximizar: o ipcHandlers faz setBounds(workArea).
        janela.bounds = { ...PRINCIPAL.workArea }
        janela.emitir('close')
        // Vaivém DIP↔pixel com escala 125%: 1 px de diferença ainda é o maximizado.
        janela.bounds = { x: 0, y: 0, width: 1921, height: 1039 }
        janela.emitir('close')
        expect(boot(arquivo).bounds).toEqual({ x: 150, y: 120, width: 1000, height: 700 })
    })

    it('o maximizado é reconhecido pela workArea do monitor ONDE a janela está (secundário)', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.bounds = { x: 2000, y: 50, width: 1000, height: 700 }
        janela.emitir('moved')
        janela.bounds = { ...SECUNDARIO.workArea }
        janela.emitir('close')
        expect(boot(arquivo).bounds).toEqual({ x: 2000, y: 50, width: 1000, height: 700 })
    })

    it('janela quase do tamanho da tela, mas não maximizada, é gravada', () => {
        const arquivo = new ArquivoFalso()
        const { janela } = boot(arquivo)
        janela.bounds = { x: 0, y: 0, width: 1916, height: 1040 }
        janela.emitir('close')
        expect(boot(arquivo).bounds).toEqual({ x: 0, y: 0, width: 1916, height: 1040 })
    })

    it('falha ao gravar (disco cheio) não escapa do ouvinte do evento nativo', () => {
        const janela = new JanelaFalsa()
        const gravar = vi.fn(() => { throw new Error('ENOSPC') })
        lembrarBoundsDaJanela(janela, gravar, () => PRINCIPAL.workArea)
        expect(() => janela.emitir('moved')).not.toThrow()
        expect(gravar).toHaveBeenCalledTimes(1)
    })

    it('o PiP e a principal usam a MESMA checagem de visibilidade', () => {
        expect(boundsVisiveis({ x: -5, y: -5, width: 400, height: 250 }, [PRINCIPAL])).toBe(true)
        expect(boundsVisiveis({ x: -20, y: 0, width: 400, height: 250 }, [PRINCIPAL])).toBe(false)
        expect(boundsVisiveis({ x: 0, y: -20, width: 400, height: 250 }, [PRINCIPAL])).toBe(false)
        expect(boundsVisiveis({ x: 1920, y: 0, width: 400, height: 250 }, [PRINCIPAL])).toBe(false)
        expect(boundsVisiveis({ x: 0, y: 1080, width: 400, height: 250 }, [PRINCIPAL])).toBe(false)
        expect(boundsVisiveis({ x: 1920, y: 0, width: 400, height: 250 }, [PRINCIPAL, SECUNDARIO])).toBe(true)

        const pip = fs.readFileSync(path.join(__dirname, 'pipHandlers.ts'), 'utf-8').replace(/\r\n/g, '\n')
        expect(pip.includes("import { boundsVisiveis } from './boundsDaJanela'")).toBe(true)
        expect(pip.includes('boundsVisiveis(savedBounds, screen.getAllDisplays())')).toBe(true)
        // A cópia inline da checagem saiu (senão as duas divergem com o tempo).
        expect(pip.includes('savedBounds.x >= d.bounds.x')).toBe(false)
    })

    it('main.ts abre a principal com os bounds lembrados e liga a gravação', () => {
        const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf-8').replace(/\r\n/g, '\n')
        expect(main.includes("import { prepararJanelaPrincipal } from './boundsDaJanela'")).toBe(true)
        const inicio = main.indexOf('function createWindow()')
        expect(inicio).toBeGreaterThan(-1)
        const createWindow = main.slice(inicio, main.indexOf('\n}\n', inicio))
        const preparo = createWindow.indexOf('prepararJanelaPrincipal(')
        const construtor = createWindow.indexOf('new BrowserWindow({')
        expect(preparo).toBeGreaterThan(-1)
        expect(preparo).toBeLessThan(construtor)
        expect(createWindow.includes("new Store<{ mainBounds?: unknown }>({ name: 'window-state' })")).toBe(true)
        expect(/prepararJanelaPrincipal\([\s\S]*?\n\s+screen,\n/.test(createWindow)).toBe(true)
        expect(createWindow.includes('...estadoDaJanela.bounds,')).toBe(true)
        expect(createWindow.indexOf('estadoDaJanela.lembrar(win)')).toBeGreaterThan(construtor)
        // O tamanho fixo sai do construtor: senão os bounds salvos seriam ignorados.
        expect(/width:\s*1200/.test(createWindow)).toBe(false)
        expect(/height:\s*800/.test(createWindow)).toBe(false)
    })
})
