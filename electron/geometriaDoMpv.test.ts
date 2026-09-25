import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { MPV_CONTROLS_HEIGHT, MPV_TITLEBAR_HEIGHT } from './mpvProtocol'

/**
 * 🎞️ As faixas que a janela do mpv NÃO cobre têm de bater com o que o
 * renderer reserva (#D017).
 *
 * O main posiciona a janela nativa do mpv (`--no-border --ontop`) com
 * computeMpvGeometry: a área do app MENOS os MPV_TITLEBAR_HEIGHT px de cima e
 * os MPV_CONTROLS_HEIGHT px de baixo. O renderer reserva essas mesmas faixas
 * por conta própria, com números escritos à mão em outros arquivos — um deles
 * o CSS da barra de título, onde ninguém suspeita de vídeo:
 *
 *   - MpvPlayerView.tsx: `const CONTROLS_HEIGHT` (altura da faixa de controles)
 *     e o `inset` do `.mpv-view-backdrop` (o fundo do player, que começa sob a
 *     barra e termina no rodapé da janela, onde a faixa de controles encosta);
 *   - CustomTitleBar.css: `top`/`height` do `.custom-title-bar` (a única
 *     superfície de arrastar/minimizar/maximizar/fechar da janela sem moldura);
 *   - index.css: o `padding-top` do body e o `calc(100vh - Npx)` do #root, que
 *     empurram o app para baixo da mesma barra.
 *
 * Se um lado muda e o outro não, a janela do mpv (nativa: nenhum z-index do
 * DOM passa por cima dela) engole a barra de título ou os controles — ou
 * sobra uma tira preta. Os comentários "must match" não conferiam nada; este
 * teste confere. Guarda estrutural porque o jsdom não calcula layout.
 *
 * Todas as regras do seletor contam (não só a primeira): uma sobrescrita mais
 * abaixo no arquivo, ou dentro de um @media, também tem de bater.
 */
const RAIZ = path.join(__dirname, '..')

const ler = (...partes: string[]): string =>
    fs.readFileSync(path.join(RAIZ, ...partes), 'utf-8').replace(/\r\n/g, '\n')

/** CSS sem comentários: "height: 36px" dentro de um comentário não é declaração. */
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const VIEW = ler('src', 'components', 'MpvPlayerView.tsx')
/** Só o template `viewStyles` do MpvPlayerView: é ali que mora o CSS do player. */
const VIEW_CSS = ((): string => {
    const abertura = 'const viewStyles = `'
    const inicio = VIEW.indexOf(abertura)
    if (inicio < 0) throw new Error('o viewStyles sumiu do MpvPlayerView.tsx')
    const corpo = inicio + abertura.length
    return semComentarios(VIEW.slice(corpo, VIEW.indexOf('`', corpo)))
})()
const TITLEBAR_CSS = semComentarios(ler('src', 'components', 'CustomTitleBar', 'CustomTitleBar.css'))
const INDEX_CSS = semComentarios(ler('src', 'index.css'))
const MPV_PLAYER = ler('electron', 'mpvPlayer.ts')

/**
 * Corpos de TODAS as regras em que `seletor` é um seletor INTEIRO da lista
 * (`.a {`, `.a, .b {`, `.b, .a {`) — não `.a-algo`, nem `html .a`.
 */
const regras = (fonte: string, seletor: string): string[] => {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')
    const padrao = new RegExp('(?:^|[{},])\\s*' + escapado + '\\s*(?:,[^{}]*)?\\{([^}]*)(?=\\})', 'g')
    const achadas = [...fonte.matchAll(padrao)].map((m) => m[1])
    if (achadas.length === 0) throw new Error(`a regra ${seletor} sumiu`)
    return achadas
}

/** Todos os valores de `prop` (regex) declarados nos blocos, na ordem do arquivo. */
const valores = (blocos: string[], prop: string): string[] =>
    blocos.flatMap((bloco) =>
        [...bloco.matchAll(new RegExp('(?:^|[\\s;{])' + prop + '\\s*:\\s*([^;]+)', 'g'))].map((m) => m[1].trim()),
    )

/** Todas as declarações de `prop` em px (exige ao menos uma). */
const pxs = (blocos: string[], prop: string): number[] => {
    const achados = valores(blocos, prop)
    if (achados.length === 0) throw new Error(`${prop} sumiu da regra`)
    return achados.map((v) => {
        const m = v.match(/^(-?\d+)px$/)
        if (!m) throw new Error(`${prop} deixou de ser um valor em px: "${v}"`)
        return Number(m[1])
    })
}

describe('geometria do mpv: main e renderer reservam as mesmas faixas', () => {
    it('o main posiciona a janela do mpv com as alturas padrão', () => {
        // computeMpvGeometry aceita alturas próprias; uma altura passada à mão
        // no main tira a janela do mpv da conta que este teste confere.
        const argumentos = [...MPV_PLAYER.matchAll(/computeMpvGeometry\((.*)$/gm)].map((m) => m[1].trim())
        expect(argumentos.length, 'o mpvPlayer.ts parou de chamar computeMpvGeometry').toBeGreaterThan(0)
        for (const resto of argumentos) expect(resto).toBe('win.getContentBounds())')
    })

    it('CONTROLS_HEIGHT do MpvPlayerView = MPV_CONTROLS_HEIGHT', () => {
        const achado = VIEW.match(/\bconst\s+CONTROLS_HEIGHT\s*=\s*(\d+)\s*;/)
        expect(achado, 'const CONTROLS_HEIGHT sumiu do MpvPlayerView.tsx').not.toBeNull()
        expect(Number(achado![1])).toBe(MPV_CONTROLS_HEIGHT)
    })

    it('a faixa de controles tem exatamente CONTROLS_HEIGHT e encosta no rodapé', () => {
        expect(/className="mpv-view-controls"\s+style=\{\{\s*height:\s*CONTROLS_HEIGHT\s*\}\}/.test(VIEW)).toBe(true)
        const controles = regras(VIEW_CSS, '.mpv-view-controls')
        // Margem levantaria a faixa e a janela do mpv (que para a
        // MPV_CONTROLS_HEIGHT do rodapé) morderia o topo dos controles.
        expect(valores(controles, 'margin(?:-[a-z]+)?')).toEqual([])
        // border-top de 1px: em content-box a faixa teria 97px. Vale o
        // box-sizing da própria regra ou, se ela não declarar, o `*` do index.css.
        const proprio = valores(controles, 'box-sizing')
        const efetivo = proprio.length > 0 ? proprio : valores(regras(INDEX_CSS, '*'), 'box-sizing')
        expect(efetivo.length, 'ninguém mais garante box-sizing na faixa de controles').toBeGreaterThan(0)
        for (const v of efetivo) expect(v).toBe('border-box')
    })

    it('o fundo do player vai de MPV_TITLEBAR_HEIGHT até o rodapé (.mpv-view-backdrop)', () => {
        const fundo = regras(VIEW_CSS, '.mpv-view-backdrop')
        const insets = valores(fundo, 'inset')
        expect(insets.length, 'o .mpv-view-backdrop perdeu o inset').toBeGreaterThan(0)
        for (const v of insets) expect(v).toBe(`${MPV_TITLEBAR_HEIGHT}px 0 0 0`)
        // Nada que desloque as bordas depois do inset.
        expect(valores(fundo, '(?:top|bottom)')).toEqual([])
        expect(valores(fundo, 'padding(?:-[a-z]+)?')).toEqual([])
    })

    it('o .custom-title-bar ocupa exatamente os MPV_TITLEBAR_HEIGHT px de cima', () => {
        const barra = regras(TITLEBAR_CSS, '.custom-title-bar')
        for (const h of pxs(barra, 'height')) expect(h).toBe(MPV_TITLEBAR_HEIGHT)
        expect(valores(barra, 'top')).toEqual(['0'])
    })

    it('o app começa logo abaixo da barra de título (index.css)', () => {
        // index.css tem mais de uma regra `body`; valem todas as que declaram padding-top.
        for (const p of pxs(regras(INDEX_CSS, 'body'), 'padding-top')) expect(p).toBe(MPV_TITLEBAR_HEIGHT)
        const alturas = valores(regras(INDEX_CSS, '#root'), 'height')
        expect(alturas.length, '#root perdeu o height').toBeGreaterThan(0)
        for (const h of alturas) expect(h).toBe(`calc(100vh - ${MPV_TITLEBAR_HEIGHT}px)`)
    })
})
