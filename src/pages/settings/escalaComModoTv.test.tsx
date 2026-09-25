import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AppearanceSection } from './AppearanceSection'
import { themeService, type UiScale } from '../../services/themeService'
import { TV_MODE_ZOOM, tvModeService } from '../../services/tvModeService'

/**
 * D129 — Modo TV e Escala da interface disputavam o `zoom` do body.
 *
 * O tvModeService escrevia `body.style.zoom = '1.25'` inline, e inline vence a
 * regra `body { zoom: ... }` do index.css: com o Modo TV ligado, o seletor de
 * 90/100/110/125% (logo abaixo, na mesma seção Aparência) não mudava nada.
 *
 * O teste carrega o index.css DE VERDADE num <style> e lê o zoom que a
 * cascata entrega pro body — pelos serviços e pela tela montada (o interruptor
 * e o <select> de verdade). O jsdom devolve o valor vencedor sem resolver
 * `var()`/`calc()`, então o teste resolve as variáveis pelo estilo computado e
 * multiplica os fatores: a mesma conta que o Chromium faz (conferido no
 * Electron do app: 1.1 × 1.25 = 1.375).
 */

/**
 * A folha global real, lida do disco. O Vitest esvazia todo `.css` importado
 * (até com `?raw`) e o tsconfig do app não traz os tipos do Node — daí o
 * import dinâmico com o nome montado (mesmo truque de
 * verificacaoParentalMarcaOCard.test.tsx). Caminho relativo à raiz do projeto.
 */
async function lerIndexCss(): Promise<string> {
    const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':')) as {
        readFileSync: (caminho: string, codificacao: 'utf8') => string
    }
    const css = fs.readFileSync('src/index.css', 'utf8')
    if (!/body\s*\{[^}]*zoom/.test(css)) throw new Error('não achei a regra de zoom do body no index.css')
    return css
}

const ipcFalso = {
    invoke: vi.fn(async () => ({ success: true })),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
}

const raizes: Root[] = []
const lixo: HTMLElement[] = []

beforeAll(async () => {
    const folha = document.createElement('style')
    folha.textContent = await lerIndexCss()
    document.head.appendChild(folha)
})

beforeEach(() => {
    ; (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = ipcFalso
})

afterEach(() => {
    for (const r of raizes) { try { r.unmount() } catch { /* ja foi */ } }
    raizes.length = 0
    for (const el of lixo) el.remove()
    lixo.length = 0
    tvModeService.setEnabled(false)
    themeService.setTheme({ scale: 100 })
    try { localStorage.clear() } catch { /* jsdom sem storage */ }
})

/** Zoom que a cascata entrega pro body, com var()/calc() de produto resolvidos. */
function zoomEfetivoDoBody(): number {
    const cs = getComputedStyle(document.body)
    const bruto = cs.getPropertyValue('zoom').trim()
    const semVars = bruto.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, nome: string, padrao?: string) => {
        const valor = cs.getPropertyValue(nome).trim()
        return valor !== '' ? valor : (padrao ?? '').trim()
    })
    const expr = semVars.replace(/^calc\((.*)\)$/, '$1')
    const fatores = expr.split('*').map(f => Number(f.trim()))
    if (bruto === '' || fatores.some(f => !Number.isFinite(f))) {
        throw new Error(`zoom do body fora do formato esperado: "${bruto}" -> "${expr}"`)
    }
    return fatores.reduce((a, b) => a * b, 1)
}

function escala(scale: UiScale): void {
    themeService.setTheme({ scale })
}

/** Monta de verdade (react-dom/client + act) e devolve o container. */
async function montarAparencia() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    lixo.push(container)
    const root = createRoot(container)
    raizes.push(root)
    await act(async () => { root.render(<AppearanceSection />) })
    return container
}

/** O interruptor do Modo TV: o da linha que tem o 📺. */
function interruptorDoModoTv(container: HTMLElement): HTMLInputElement {
    const linha = Array.from(container.querySelectorAll('.setting-item'))
        .find(item => (item.querySelector('.setting-info label')?.textContent ?? '').includes('📺'))
    const input = linha?.querySelector('label.toggle-switch input[type="checkbox"]') as HTMLInputElement | null
    if (!input) throw new Error('não achei o interruptor do Modo TV')
    return input
}

/** Escolhe uma opção no <select> da Escala do jeito que o React enxerga. */
async function escolherEscala(container: HTMLElement, scale: UiScale) {
    const select = container.querySelector('select') as HTMLSelectElement | null
    if (!select) throw new Error('não achei o seletor de Escala da interface')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(select, String(scale))
        select.dispatchEvent(new Event('change', { bubbles: true }))
    })
}

describe('Modo TV + Escala da interface (D129)', () => {
    it('com o Modo TV ligado, a Escala da interface continua valendo (multiplica)', () => {
        escala(110)
        tvModeService.setEnabled(true)
        expect(zoomEfetivoDoBody()).toBeCloseTo(1.1 * TV_MODE_ZOOM, 5)
        expect(document.documentElement.classList.contains('tv-mode')).toBe(true)
    })

    it('mexer na Escala com o Modo TV ligado muda o zoom na hora', () => {
        tvModeService.setEnabled(true)
        escala(90)
        expect(zoomEfetivoDoBody()).toBeCloseTo(0.9 * TV_MODE_ZOOM, 5)
        escala(125)
        expect(zoomEfetivoDoBody()).toBeCloseTo(1.25 * TV_MODE_ZOOM, 5)
    })

    it('reabrir o app com o Modo TV salvo (apply do boot) aplica os dois fatores', () => {
        escala(110)
        localStorage.setItem('neostream_tv_mode', '1')
        tvModeService.apply()
        expect(zoomEfetivoDoBody()).toBeCloseTo(1.1 * TV_MODE_ZOOM, 5)
    })

    it('desligar o Modo TV volta pra escala pura, sem sobra de zoom', () => {
        escala(110)
        tvModeService.setEnabled(true)
        tvModeService.setEnabled(false)
        expect(zoomEfetivoDoBody()).toBeCloseTo(1.1, 5)
        expect(document.documentElement.classList.contains('tv-mode')).toBe(false)
    })

    it('o boot de verdade chama o apply: o App.tsx aplica o Modo TV salvo no nível do módulo', async () => {
        // O caso acima prova o que o apply() faz; este amarra a ponta que o
        // teste montado não alcança — o App inteiro é pesado demais pra montar
        // aqui (o RaizDoApp.test.tsx também o troca por um vazio).
        const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':')) as {
            readFileSync: (caminho: string, codificacao: 'utf8') => string
        }
        const app = fs.readFileSync('src/App.tsx', 'utf8').replace(/\r\n/g, '\n')
        expect(app.includes('\ntvModeService.apply();\n')).toBe(true)
    })

    it('sem Modo TV e na escala padrão o zoom é 1', () => {
        expect(zoomEfetivoDoBody()).toBeCloseTo(1, 5)
    })

    it('na tela Aparência: ligar o Modo TV e depois trocar a Escala muda o zoom do app', async () => {
        const container = await montarAparencia()
        const tv = interruptorDoModoTv(container)

        await act(async () => { tv.click() })
        expect(tv.checked).toBe(true)
        expect(zoomEfetivoDoBody()).toBeCloseTo(TV_MODE_ZOOM, 5)

        await escolherEscala(container, 90)
        expect(zoomEfetivoDoBody()).toBeCloseTo(0.9 * TV_MODE_ZOOM, 5)

        await escolherEscala(container, 110)
        expect(zoomEfetivoDoBody()).toBeCloseTo(1.1 * TV_MODE_ZOOM, 5)

        await act(async () => { tv.click() })
        expect(tv.checked).toBe(false)
        expect(zoomEfetivoDoBody()).toBeCloseTo(1.1, 5)
    })
})
