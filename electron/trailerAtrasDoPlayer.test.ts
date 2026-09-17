import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔇 Nenhum trailer toca por baixo do player.
 *
 * A ficha (`ContentDetailModal`) monta um `<iframe>` do YouTube com
 * `autoplay=1` e lembra a preferência de som por perfil — quem desmutou uma
 * vez continua desmutado. Quatro páginas (VOD, Home, Favoritos, Ver Depois)
 * limpam o item selecionado dentro do `onPlay` e a ficha desmonta junto com o
 * iframe. A Série não pode fazer isso: zerar `selectedSeries` derruba o
 * `seriesInfo` da página e o `buildSeriesStreamUrl` perde o episódio. Só que
 * ela também não fazia nada, então a ficha ficava montada atrás do
 * `.player-backdrop` (z-index 99999, AsyncVideoPlayer.tsx) com o trailer em
 * loop — áudio por cima do episódio e um segundo vídeo baixando e
 * decodificando durante toda a reprodução.
 *
 * O guarda é estrutural (não há @testing-library no repositório) e vale para
 * TODA página que monta a ficha: ou o `onPlay` fecha a ficha, ou a página
 * marca a ficha como suspensa enquanto houver player. Quem repetir o desenho
 * da Série fica vermelho.
 */
const SRC = path.join(__dirname, '..', 'src')
const PAGINAS = ['VOD.tsx', 'Series.tsx', 'Home.tsx', 'Favorites.tsx', 'WatchLater.tsx']

/** Recorta o elemento `<ContentDetailModal ... />` inteiro (fecha no `/>` de nível 0). */
function blocoDaFicha(fonte: string): string {
    const inicio = fonte.indexOf('<ContentDetailModal')
    if (inicio < 0) return ''
    let profundidade = 0
    for (let i = inicio; i < fonte.length; i++) {
        const c = fonte[i]
        if (c === '{') profundidade++
        else if (c === '}') profundidade--
        else if (profundidade === 0 && c === '/' && fonte[i + 1] === '>') return fonte.slice(inicio, i + 2)
    }
    return fonte.slice(inicio)
}

/** Recorta o valor de uma prop `nome={...}` de dentro do bloco, com chaves balanceadas. */
function corpoDaProp(bloco: string, nome: string): string {
    const marca = `${nome}={`
    const achou = bloco.indexOf(marca)
    if (achou < 0) return ''
    const inicio = achou + marca.length - 1
    let profundidade = 0
    for (let i = inicio; i < bloco.length; i++) {
        if (bloco[i] === '{') profundidade++
        else if (bloco[i] === '}' && --profundidade === 0) return bloco.slice(inicio, i + 1)
    }
    return bloco.slice(inicio)
}

const fonteDaFicha = () => fs.readFileSync(path.join(SRC, 'components', 'ContentDetailModal.tsx'), 'utf-8')

describe('ficha atrás do player: o trailer não pode continuar tocando', () => {
    it.each(PAGINAS)('%s fecha a ficha no Play ou marca a ficha como suspensa', (arquivo) => {
        const bloco = blocoDaFicha(fs.readFileSync(path.join(SRC, 'pages', arquivo), 'utf-8'))
        expect(bloco.length).toBeGreaterThan(0)
        // `setSelected*(null)` só conta se estiver no onPlay — no onClose ele
        // existe em todas as páginas e não diz nada sobre tocar.
        const fechaNoPlay = /setSelected\w*\(\s*null\s*\)/.test(corpoDaProp(bloco, 'onPlay'))
        // E `suspended` só conta se estiver amarrado ao estado do player: um
        // `suspended={false}` decorativo passaria e não calaria nada.
        const marcaSuspensa = /\bsuspended=\{[^}]*\bplaying\w*/.test(bloco)
        expect(fechaNoPlay || marcaSuspensa).toBe(true)
    })

    it('a ficha suspensa não monta o iframe do trailer', () => {
        // `trailerId` é quem decide entre o `<iframe>` e o pôster de reserva —
        // desmontar o iframe é o que de fato mata o áudio e o segundo download.
        const linha = fonteDaFicha().split('\n').find((l: string) => l.includes('const trailerId')) ?? ''
        expect(linha.includes('suspended')).toBe(true)
    })

    it('a ficha suspensa não deixa na tela controle nenhum do trailer', () => {
        // ⛶ (tela cheia) e 🔇 (som) mandam no iframe pelo `trailerFrameRef`.
        // Suspensa, a ficha mostra o pôster: botão de trailer ali é controle
        // de algo que não existe mais.
        const portoes = fonteDaFicha().split('\n')
            .filter((l: string) => l.includes('extractYouTubeId(trailerUrl)'))
        expect(portoes.length).toBeGreaterThan(0)
        const semGuarda = portoes.filter((l: string) => !l.includes('suspended'))
        expect(semGuarda).toEqual([])
    })
})
