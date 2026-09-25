import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Settings } from '../Settings'
import { AppearanceSection } from './AppearanceSection'
import { NetworkSection } from './NetworkSection'
import { ParentalSection } from './ParentalSection'
import { PlaybackSection } from './PlaybackSection'
import { SearchSection } from './SearchSection'
import { UpdatesSection } from './UpdatesSection'
import { searchConfigService } from '../../services/searchConfigService'

/**
 * D127 — os interruptores das Configuracoes.
 *
 * O padrao repetido em toda a tela e
 *   <label className="toggle-switch"><input type="checkbox" /><span className="toggle-slider" /></label>
 * e ele nasceu com dois buracos:
 *
 * 1. NOME. O <label> que embrulha o input nao tem texto nenhum (so o span
 *    vazio do slider), e o rotulo que a pessoa le mora num <label> IRMAO,
 *    dentro de .setting-info, sem htmlFor. Resultado: o leitor de tela
 *    anuncia "caixa de selecao, marcada" e mais nada.
 *
 * 2. FOCO. O anel global de `:focus-visible` (index.css) cai no input, e
 *    `.toggle-switch input` e `opacity: 0` — opacity apaga o desenho INTEIRO
 *    do elemento, contorno junto. Quem navega por Tab (ou de controle remoto,
 *    no Modo TV) nao via anel nenhum. O conserto desenha o anel no
 *    .toggle-slider, que e a caixa de 56x30 que a pessoa enxerga.
 *
 * COMO O FOCO E TESTADO. A folha nao e remontada aqui a partir do fonte: o
 * teste MONTA a tela de Configuracoes de verdade e le o <style> que ela
 * renderiza — se alguem tirar o `<style>{settingsStyles}</style>` do JSX, o
 * CSS deixa de chegar na tela e o teste cai junto.
 *
 * Da folha real tiramos os seletores. O `:focus-visible` do jsdom depende de
 * uma heuristica de ultimo-evento que muda de resposta conforme a ordem das
 * chamadas — perguntar `input.matches(':focus-visible')` seria um teste que
 * passa por acidente. Entao exigimos que o seletor fale em `:focus-visible`
 * (e nao em `:focus` puro, senao o anel acenderia tambem no clique de mouse) e
 * trocamos a pseudo-classe por `:focus` SO na hora de perguntar ao DOM se ela
 * casa. O que e de fato exercitado contra a arvore montada e o que importa e o
 * jsdom sabe responder: em QUAL elemento o anel cai, pelo combinador irmao, e
 * se ele some quando o foco sai.
 *
 * Nao cobertos de proposito: os 2 interruptores de BackupSection.tsx e o 1 de
 * DiagnosticsSection.tsx — esses arquivos estao travados por PR aberto nesta
 * leva, entao o NOME deles fica pendente. O anel de foco, esse sim, ja vale
 * para eles: e CSS e mora no Settings.tsx.
 */

const ipcFalso = {
    invoke: vi.fn(async () => ({ success: true })),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
}

const SECOES: Array<[string, () => React.JSX.Element]> = [
    ['Aparencia', AppearanceSection],
    ['Rede', NetworkSection],
    ['Controle dos pais', ParentalSection],
    ['Reproducao', PlaybackSection],
    ['Busca', SearchSection],
    ['Atualizacoes', () => <UpdatesSection checking={false} setChecking={() => { }} />],
]

const raizes: Root[] = []
const lixo: HTMLElement[] = []

beforeEach(() => {
    ; (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = ipcFalso
        ; (window as unknown as { electronAPI: unknown }).electronAPI = ipcFalso
})

afterEach(() => {
    for (const r of raizes) { try { r.unmount() } catch { /* ja foi */ } }
    raizes.length = 0
    for (const el of lixo) el.remove()
    lixo.length = 0
    document.documentElement.classList.remove('tv-mode')
    try { localStorage.clear() } catch { /* jsdom sem storage */ }
})

/** Monta de verdade (react-dom/client + act) e devolve o container. */
async function montar(no: ReactNode) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    lixo.push(container)
    const root = createRoot(container)
    raizes.push(root)
    await act(async () => { root.render(no) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    return container
}

function interruptores(container: HTMLElement) {
    return Array.from(
        container.querySelectorAll('label.toggle-switch input[type="checkbox"]')
    ) as HTMLInputElement[]
}

const limpo = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * O nome que o leitor de tela anuncia, na ordem que a especificacao manda:
 * aria-label > aria-labelledby > <label> associado (embrulho ou htmlFor).
 */
function nomeAcessivel(input: HTMLInputElement): string {
    const rotulo = limpo(input.getAttribute('aria-label'))
    if (rotulo) return rotulo
    const ids = (input.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
    if (ids.length) {
        return limpo(ids.map(id => document.getElementById(id)?.textContent ?? '').join(' '))
    }
    const associados = Array.from(input.labels ?? [])
    return limpo(associados.map(l => l.textContent ?? '').join(' '))
}

/**
 * O TITULO que a pessoa le naquela linha — de proposito sem o paragrafo de
 * descricao que vem embaixo, para que anunciar a descricao no lugar do titulo
 * conte como erro. Nas linhas de trilho da Aparencia nao ha `.setting-info`;
 * ali o titulo e o proprio texto da linha (que traz as setas ↑↓ junto).
 */
function tituloVisivel(input: HTMLInputElement): string {
    const linha = (input.closest('.setting-item')
        ?? input.closest('label.toggle-switch')?.parentElement) as HTMLElement | null
    const titulo = linha?.querySelector('.setting-info label')
    return limpo(titulo?.textContent ?? linha?.textContent ?? '')
}

// ------------------------------------------------- a folha que a tela publica

/**
 * Monta a tela de Configuracoes inteira e devolve a folha de estilo que ELA
 * renderiza. Nada e lido do fonte: se o `<style>` sair do JSX, nao ha folha.
 */
async function folhaDaTelaDeConfiguracoes(): Promise<CSSStyleSheet> {
    const container = await montar(<MemoryRouter><Settings /></MemoryRouter>)
    const folhas = Array.from(container.querySelectorAll('style'))
        .map(s => s.sheet)
        .filter((s): s is CSSStyleSheet => !!s)
        .filter(s => Array.from(s.cssRules).some(r => (r as CSSStyleRule).selectorText?.includes('toggle-switch')))
    expect(
        folhas.length,
        'a tela de Configuracoes nao publicou nenhuma folha com as regras do interruptor'
    ).toBe(1)
    return folhas[0]
}

function regrasDe(folha: CSSStyleSheet): CSSStyleRule[] {
    const saida: CSSStyleRule[] = []
    const varre = (lista: CSSRuleList) => {
        for (const regra of Array.from(lista)) {
            const grupo = (regra as CSSGroupingRule).cssRules
            if (grupo) varre(grupo)
            if ((regra as CSSStyleRule).selectorText) saida.push(regra as CSSStyleRule)
        }
    }
    varre(folha.cssRules)
    return saida
}

/**
 * Largura (px) do anel que as regras de FOCO da folha desenham neste elemento,
 * considerando o input como focado. So entram regras que falam em
 * `:focus-visible`; na hora de perguntar ao DOM a pseudo-classe vira `:focus`,
 * que o jsdom resolve de forma deterministica.
 */
function anelDeFocoEmPx(folha: CSSStyleSheet, alvo: Element): number {
    let largura = 0
    for (const regra of regrasDe(folha)) {
        if (!regra.selectorText.includes('toggle-')) continue
        if (!regra.selectorText.includes(':focus')) continue
        // um anel preso a `:focus` puro acenderia tambem no clique de mouse
        expect(
            regra.selectorText.includes(':focus-visible'),
            `a regra "${regra.selectorText}" usa :focus puro — o anel apareceria no clique de mouse`
        ).toBe(true)
        const seletor = regra.selectorText.split(':focus-visible').join(':focus')
        let casa: boolean
        try { casa = alvo.matches(seletor) } catch { casa = false }
        if (!casa) continue
        const taquigrafia = regra.style.getPropertyValue('outline')
        if (/\bnone\b/.test(taquigrafia)) { largura = 0; continue }
        const texto = `${taquigrafia} ${regra.style.getPropertyValue('outline-width')}`
        const px = texto.match(/(\d+(?:\.\d+)?)px/)
        if (px) largura = Math.max(largura, Number(px[1]))
    }
    return largura
}

describe('D127 — interruptores das Configuracoes', () => {
    it('cada interruptor se apresenta com o nome que esta na tela', async () => {
        const semNome: string[] = []
        const nomeErrado: string[] = []
        let total = 0

        for (const [secao, Comp] of SECOES) {
            const container = await montar(<Comp />)
            const achados = interruptores(container)
            expect(achados.length, `${secao} nao renderizou interruptor nenhum`).toBeGreaterThan(0)
            for (const input of achados) {
                total++
                const nome = nomeAcessivel(input)
                const titulo = tituloVisivel(input)
                if (!nome) { semNome.push(`${secao}: "${titulo.slice(0, 40)}"`); continue }
                // o nome anunciado tem que ser o TITULO daquela linha — nao um
                // apelido inventado, nem o paragrafo de descricao que vem embaixo
                if (!titulo.includes(nome)) {
                    nomeErrado.push(`${secao}: "${nome}" nao e o titulo "${titulo.slice(0, 60)}"`)
                }
            }
        }

        expect(total, 'esperava os 29 interruptores das 6 secoes livres').toBe(29)
        expect(semNome, 'interruptores mudos para o leitor de tela').toEqual([])
        expect(nomeErrado, 'nome anunciado diferente do titulo visivel').toEqual([])
    })

    it('cada interruptor tem um nome DIFERENTE do vizinho', async () => {
        const container = await montar(<SearchSection />) // Busca: 4 interruptores irmaos
        const nomes = interruptores(container).map(nomeAcessivel)
        expect(nomes.length).toBe(4)
        expect(new Set(nomes).size, `nomes repetidos: ${nomes.join(' / ')}`).toBe(4)
    })

    it('o anel do foco e desenhado NO slider, e some quando o foco sai', async () => {
        const folha = await folhaDaTelaDeConfiguracoes()
        const container = await montar(<SearchSection />)
        const input = interruptores(container)[0]
        const slider = input.nextElementSibling as HTMLElement
        expect(slider?.className).toBe('toggle-slider')

        // a premissa do conserto: o input segue invisivel (opacity 0 apaga o
        // desenho inteiro dele, contorno junto) e sem tamanho. Se um dia ele
        // voltar a aparecer, este anel no irmao vira anel duplicado.
        const regraDoInput = regrasDe(folha).find(r => r.selectorText === '.toggle-switch input')
        expect(regraDoInput?.style.getPropertyValue('opacity')).toBe('0')
        expect(regraDoInput?.style.getPropertyValue('width')).toMatch(/^0(px)?$/)

        input.focus()
        expect(document.activeElement).toBe(input)
        expect(
            anelDeFocoEmPx(folha, slider),
            'com o interruptor focado nenhuma regra da folha desenha anel no slider'
        ).toBeGreaterThanOrEqual(2)
        expect(
            anelDeFocoEmPx(folha, input),
            'o anel nao pode ser desenhado no input, que e 0x0 e opacity:0'
        ).toBe(0)

        input.blur()
        expect(anelDeFocoEmPx(folha, slider), 'o anel ficou aceso depois de sair o foco').toBe(0)
    })

    /**
     * O anel e UMA regra de CSS, mas ela so alcanca um interruptor se o
     * `.toggle-slider` for mesmo o irmao seguinte do input (o combinador `+`).
     * Basta alguem renomear esse span numa secao para aquele punhado de
     * interruptores ficar sem anel — e o teste do primeiro interruptor da
     * Busca nao veria nada. Entao aqui todos passam pela peneira.
     *
     * Interruptor `disabled` fica de fora: ele nao entra na ordem de
     * tabulacao, nao recebe foco, e anel em controle desligado seria mentira
     * (hoje sao 2: o "Bloquear categorias adultas" do Controle dos pais, que
     * depende do "Ativar", e o "Instalar automaticamente" das Atualizacoes;
     * o "Filtrar por TMDB" saiu no #D078 -- ninguem lia a opcao).
     */
    it('o anel alcanca TODOS os interruptores das secoes, nao so o primeiro', async () => {
        const folha = await folhaDaTelaDeConfiguracoes()
        const semAnel: string[] = []
        let total = 0
        let conferidos = 0

        for (const [secao, Comp] of SECOES) {
            const container = await montar(<Comp />)
            for (const input of interruptores(container)) {
                total++
                if (input.disabled) continue
                conferidos++
                const irmao = input.nextElementSibling
                const quem = `${secao}: "${limpo(input.getAttribute('aria-label')).slice(0, 30)}"`
                if (!irmao || !irmao.matches('.toggle-slider')) {
                    semAnel.push(`${quem} — o irmao do input nao e .toggle-slider`)
                    continue
                }
                input.focus()
                if (anelDeFocoEmPx(folha, irmao) < 2) semAnel.push(`${quem} — sem anel no slider`)
                input.blur()
            }
        }

        expect(total, 'esperava os 29 interruptores das 6 secoes livres').toBe(29)
        expect(conferidos, 'esperava 27 interruptores focaveis (2 nascem disabled)').toBe(27)
        expect(semAnel, 'interruptores em que o foco nao acende o anel').toEqual([])
    })

    it('no Modo TV o anel do interruptor engrossa, como no resto do app', async () => {
        const folha = await folhaDaTelaDeConfiguracoes()
        const container = await montar(<SearchSection />)
        const input = interruptores(container)[0]
        const slider = input.nextElementSibling as HTMLElement

        expect(anelDeFocoEmPx(folha, slider)).toBe(0)
        input.focus()
        const normal = anelDeFocoEmPx(folha, slider)

        // o Modo TV entra por classe no <html> (tvModeService.apply)
        document.documentElement.classList.add('tv-mode')
        const naTv = anelDeFocoEmPx(folha, slider)
        expect(naTv, 'no Modo TV o anel tem que ser mais grosso').toBeGreaterThan(normal)
        expect(naTv).toBeGreaterThanOrEqual(3)
    })

    it('o interruptor continua ligando e desligando o ajuste', async () => {
        const container = await montar(<SearchSection />)
        const input = interruptores(container)[0]
        const antes = searchConfigService.getConfig().live

        await act(async () => { input.click() })
        expect(searchConfigService.getConfig().live).toBe(!antes)

        await act(async () => { input.click() })
        expect(searchConfigService.getConfig().live).toBe(antes)
    })
})
