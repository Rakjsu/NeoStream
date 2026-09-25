import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🎯 A ficha e o fundo da tela falam do MESMO título.
 *
 * O provedor manda `tmdb_id` em cada filme e série. A página de filmes já
 * usava esse id pro fundo da tela (`fetchMovieDetails` → `backdrop_path`), mas
 * o bloco `contentData={{ … }}` que monta a ficha jogava o id fora: dentro do
 * modal, a sinopse, a nota, os gêneros e os rails "Parecidos"/elenco/coleção
 * vinham do `results[0]` de uma busca por NOME. Quando a busca errava — e com
 * nome de provedor ("4K", "[DUB]", "(2019)") ela erra —, as duas metades da
 * mesma tela eram de filmes diferentes.
 *
 * O guarda é estrutural porque o defeito mora na BORDA: o id se perde no JSX
 * da página, e o projeto não tem @testing-library pra montar o componente. A
 * escolha da fonte (id primeiro, nome como reserva) está coberta por
 * comportamento em `src/services/tmdb.test.ts`.
 */
const SRC = path.join(__dirname, '..', 'src')

const ler = (...partes: string[]) => fs.readFileSync(path.join(SRC, ...partes), 'utf-8')

/** Recorta o objeto passado em `contentData={{ … }}` (até o `}}` que o fecha). */
const blocoContentData = (fonte: string): string => {
    const inicio = fonte.indexOf('contentData={{')
    expect(inicio).toBeGreaterThan(-1)
    const fim = fonte.indexOf('}}', inicio)
    expect(fim).toBeGreaterThan(inicio)
    return fonte.slice(inicio, fim)
}

describe('ficha: o tmdb_id do provedor chega ao modal', () => {
    it('o modal não resolve a ficha por nome quando existe id', () => {
        const fonte = ler('components', 'ContentDetailModal.tsx')
        expect(fonte).not.toContain('searchMovieByName(')
        expect(fonte).not.toContain('searchSeriesByName(')
        expect(fonte).toContain('resolveMovieDetails(contentData.tmdb_id')
        expect(fonte).toContain('resolveSeriesDetails(contentData.tmdb_id')
    })

    it('a página de filmes passa o id no contentData', () => {
        expect(blocoContentData(ler('pages', 'VOD.tsx'))).toContain('tmdb_id: selectedMovie.tmdb_id')
    })

    it('a página de séries passa o id no contentData', () => {
        expect(blocoContentData(ler('pages', 'Series.tsx'))).toContain('tmdb_id: selectedSeries.tmdb_id')
    })

    it('o título do episódio no player sai do mesmo id da série que está tocando', () => {
        // O painel antigo (e o `useSeriesMetadata` que resolvia a série por
        // nome pra ele) saiu no #D047; o que sobrou na página é o nome do
        // episódio tocando — e ele tem que vir do id do provedor, não de busca.
        const hook = ler('hooks', 'useEpisodeTitle.ts')
        expect(hook.includes('searchSeriesByName(')).toBe(false)
        expect(hook.includes('fetchEpisodeDetails(tmdbId')).toBe(true)
        expect(/useEpisodeTitle\(\s*playingSeries\?\.tmdb_id,/.test(ler('pages', 'Series.tsx'))).toBe(true)
    })
})
