import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { MPV_CONTROLS_HEIGHT } from './mpvProtocol'

/**
 * 💬 O menu de legendas do MPV tem de caber na faixa de controles.
 *
 * A janela do mpv é lançada `--no-border --ontop` (mpvProtocol.ts:196-197) e
 * colada sobre a área do app MENOS os MPV_CONTROLS_HEIGHT px de baixo
 * (computeMpvGeometry). Ela é uma janela NATIVA: nenhum z-index do DOM passa
 * por cima dela. O MpvPlayerView já documenta a consequência na linha 272
 * ("the mpv window covers everything above the controls strip, so dropdown
 * menus can't render — cycling fits the 96px bar") e foi por isso que faixa de
 * áudio e de legenda viraram botões de CICLO, não menus.
 *
 * O painel de busca de legendas chegou depois (#89) e ignorou a regra: abria
 * empilhado em coluna com `bottom: calc(100% + 8px)`, ~172px subindo de dentro
 * da faixa de 96 — mais de 80% dele nascia atrás da janela do mpv.
 *
 * Guarda estrutural porque não há @testing-library/react no repo e o jsdom não
 * calcula layout: o que dá para cobrar é o orçamento declarado.
 */
const VIEW = path.join(__dirname, '..', 'src', 'components', 'MpvPlayerView.tsx')
const SUBS = path.join(__dirname, '..', 'src', 'services', 'subtitleService.ts')

const fonte = fs.readFileSync(VIEW, 'utf-8')

const regra = (classe: string): string => {
    const achado = fonte.match(new RegExp('\\.' + classe + '\\s*\\{([^}]*)\\}'))
    if (!achado) throw new Error(`a regra .${classe} sumiu do viewStyles`)
    return achado[1]
}

const px = (bloco: string, prop: string): number => {
    const achado = bloco.match(new RegExp(prop + '\\s*:\\s*(-?\\d+)px'))
    return achado ? Number(achado[1]) : 0
}

describe('menu de legendas do MPV', () => {
    it('não é ancorado acima da faixa — lá em cima é a janela nativa do mpv', () => {
        expect(regra('mpv-view-subsearch')).not.toMatch(/bottom:\s*calc\(\s*100%/)
    })

    it('cabe na faixa com todos os idiomas de SUBTITLE_LANGUAGE_OPTIONS', () => {
        const painel = regra('mpv-view-subsearch')
        const opcao = regra('mpv-view-subsearch-option')

        // +1: a opção "abrir legenda do disco", que não vem da lista de idiomas.
        const opcoes = (fs.readFileSync(SUBS, 'utf-8')
            .match(/SUBTITLE_LANGUAGE_OPTIONS[\s\S]*?\n\];/)?.[0]
            .match(/code:\s*'/g)?.length ?? 0) + 1
        expect(opcoes).toBeGreaterThan(1)

        const empilhadas = /flex-direction:\s*column/.test(painel) ? opcoes : 1
        const alturaOpcao = Math.round(px(opcao, 'font-size') * 1.2) + 2 * px(opcao, 'padding')
        const altura = empilhadas * alturaOpcao
            + (empilhadas - 1) * px(painel, 'gap')
            + 2 * px(painel, 'padding')
            + 2 // bordas

        expect(altura).toBeLessThanOrEqual(MPV_CONTROLS_HEIGHT)
    })

    it('as opções não quebram em duas linhas (estouraria a faixa)', () => {
        expect(regra('mpv-view-subsearch-option')).toMatch(/white-space:\s*nowrap/)
    })

    /**
     * A altura é o que a janela do mpv corta; a LARGURA é o que a borda da
     * janela corta. Medido no Chromium do Electron, janela de 1200px (o
     * tamanho com que o app abre — electron/main.ts:122) e os botões de sync
     * de legenda visíveis: com o rótulo inteiro o painel dá 558px e nasce a
     * -85px, ou seja 85px dele ficam fora da tela. Só com o ícone dá 407px e
     * sobra folga. O texto não some — vai para o `title`.
     */
    it('a opção de arquivo é só o ícone, com o texto no title', () => {
        // Nada de `[\s\S]*?>` para achar o fim da tag: as arrow functions dos
        // atributos (`() => void ...`) têm `>` e o casamento pararia nelas.
        const bloco = fonte.match(/<button\s+className="mpv-view-subsearch-option"[\s\S]*?<\/button>/)?.[0] ?? ''
        const fim = bloco.indexOf('</button>')
        const conteudo = bloco.slice(bloco.lastIndexOf('>', fim - 1) + 1, fim).trim()

        expect(conteudo).toBe('📂')
        expect(bloco).toMatch(/title=\{t\('player', 'openSubtitleFile'\)\}/)
    })
})
