import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔁 O cartao de erro do AsyncVideoPlayer nao pode ser beco sem saida.
 *
 * Quando o `buildStreamUrl` falha (provedor fora do ar por um instante, token
 * expirado, credencial recusada) o AsyncVideoPlayer mostra um cartao com ⚠️.
 * Antes deste guarda, os DOIS caminhos do cartao (o ✕ e o botao) chamavam o
 * mesmo `onClose`: o usuario tinha que voltar pra grade, achar o titulo de
 * novo e reabrir. O player interno, na falha equivalente, ja oferece "Tentar
 * novamente" ao lado de "Fechar" (VideoPlayer.tsx, bloco `fatalStreamError`) —
 * a mesma tela com duas reguas.
 *
 * Nao ha @testing-library/react no repo, entao o invariante e estrutural
 * (molde: electron/scrollContainerRef.test.ts). Ele cobra as duas metades que
 * so valem juntas:
 *   1. o cartao oferece uma acao ALEM de fechar (e continua podendo fechar);
 *   2. essa acao mexe num estado que esta nas deps do efeito que monta a URL —
 *      senao o botao existe mas nao remonta nada, e o beco continua la.
 * Nao amarra o NOME do estado nem o TEXTO do botao: quem renomear ou trocar a
 * chave de i18n continua verde.
 */
const ARQUIVO = path.join(__dirname, '..', 'src', 'components', 'AsyncVideoPlayer.tsx')
const fonte = fs.readFileSync(ARQUIVO, 'utf-8').replace(/\r\n/g, '\n')

/** O corpo do `if (error) { ... }`, cortado antes do `if (loading`. */
function cartaoDeErro(): string {
    const inicio = fonte.indexOf('if (error) {')
    expect(inicio, 'nao achei o `if (error) {` no AsyncVideoPlayer').toBeGreaterThan(-1)
    const fim = fonte.indexOf('if (loading', inicio)
    expect(fim, 'nao achei o bloco de loading depois do cartao de erro').toBeGreaterThan(inicio)
    return fonte.slice(inicio, fim)
}

/** Todo `onClick={...}`, tolerando um nivel de chaves aninhadas. */
function handlers(trecho: string): string[] {
    return [...trecho.matchAll(/onClick=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].map(m => m[1].trim())
}

/**
 * Setters chamados por um handler. Se o handler for so um identificador
 * (`onClick={handleRetry}`), resolve a definicao dele no arquivo antes de
 * procurar — assim extrair a acao pra um useCallback nao vira falso vermelho.
 */
function setters(handler: string): string[] {
    let corpo = handler
    const soIdentificador = /^[A-Za-z_$][\w$]*$/.test(handler)
    if (soIdentificador) {
        const def = new RegExp(`(?:const|function)\\s+${handler}\\b[\\s\\S]{0,600}`).exec(fonte)
        corpo = def ? def[0] : handler
    }
    return [...corpo.matchAll(/\bset([A-Z][\w$]*)/g)].map(m => m[1])
}

/** A lista de deps do efeito 1 (o que monta a URL do stream). */
function depsDoEfeito1(): string {
    const marcador = fonte.indexOf('// Effect 1')
    expect(marcador, 'nao achei o marcador `// Effect 1`').toBeGreaterThan(-1)
    const deps = /\n\s*\}, \[([^\]]*)\]\);/.exec(fonte.slice(marcador))
    expect(deps, 'nao achei a lista de deps do efeito 1').not.toBeNull()
    return deps![1]
}

describe('cartao de erro do AsyncVideoPlayer: tentar de novo sem fechar', () => {
    it('oferece uma acao alem de fechar', () => {
        const cliques = handlers(cartaoDeErro())
        expect(cliques.some(c => c.includes('onClose')), 'o cartao perdeu o caminho de fechar').toBe(true)
        const fora = cliques.filter(c => !c.includes('onClose'))
        expect(fora, 'todo botao do cartao de erro chama onClose: beco sem saida').not.toHaveLength(0)
    })

    it('essa acao re-dispara o efeito que monta a URL', () => {
        const fora = handlers(cartaoDeErro()).filter(c => !c.includes('onClose'))
        expect(fora[0], 'nenhum onClick no cartao de erro alem de onClose').toBeDefined()
        const deps = depsDoEfeito1()
        const candidatos = fora.flatMap(setters).map(s => s[0].toLowerCase() + s.slice(1))
        expect(candidatos, 'a acao do cartao nao chama nenhum setter de estado').not.toHaveLength(0)
        const ligado = candidatos.some(nome => new RegExp(`\\b${nome}\\b`).test(deps))
        expect(ligado, `o estado mexido pelo botao (${candidatos.join(', ')}) nao esta nas deps do efeito 1 (${deps.trim()}): o botao nao remonta a URL`).toBe(true)
    })
})
