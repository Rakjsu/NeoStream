import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * ⏱️ O menu de categorias abre em tempo constante, não em tempo de lista.
 *
 * Cada item do `CategoryMenu` nasce com `opacity: 0` e só aparece quando a
 * animação `itemFadeIn` chega nele. O atraso era `index * 0.03s` puro: numa
 * lista de provedor grande, o 300º item só aparecia **9 s** depois de abrir o
 * painel. E o item invisível continua ocupando espaço, então o que a pessoa vê
 * ao rolar é linha em branco, não uma lista mais curta.
 *
 * Pior: o painel sai de `display: none`, e sair de `display: none` **cancela e
 * reinicia** as animações do elemento (CSS Animations Level 1) — junto com o
 * `forwards`. Ou seja, a espera é cobrada a cada abertura do menu, não só na
 * primeira.
 *
 * Mesmo defeito já corrigido em `Favorites.tsx` (`Math.min(index, 12) * 0.05`,
 * #372: *"com 300 itens virava uma entrada de 15 s"*) e em `History.tsx`. O
 * `CategoryMenu` ficou de fora daquela varredura.
 *
 * O guarda é estrutural e **não** procura `Math.min`: ele extrai a própria
 * expressão de atraso do fonte e a avalia. Qualquer estratégia que limite
 * (teto, módulo, janela visível) passa; só o crescimento sem teto fica
 * vermelho.
 */
const CATEGORY_MENU = path.join(__dirname, '..', 'src', 'components', 'CategoryMenu.tsx')

// Captura o que está dentro do `${...}` do template da linha do `animation`.
const EXPRESSAO_DO_ATRASO = /animation:\s*`itemFadeIn[^`]*?\$\{(.+?)\}s forwards`/

function atrasoDoItem(): (index: number) => number {
    const fonte = fs.readFileSync(CATEGORY_MENU, 'utf-8')
    const achado = fonte.match(EXPRESSAO_DO_ATRASO)
    // Se alguém reescrever a linha do `animation`, o guarda grita em vez de
    // passar mudo por não ter encontrado nada para medir.
    expect(achado, 'não achei a expressão de atraso de `itemFadeIn` em CategoryMenu.tsx').not.toBeNull()
    return new Function('index', `return (${achado![1]})`) as (index: number) => number
}

describe('CategoryMenu: o atraso de entrada dos itens tem teto', () => {
    it('o último item de uma lista grande não espera mais que meio segundo', () => {
        const atraso = atrasoDoItem()
        expect(atraso(300)).toBeLessThanOrEqual(0.5)
        expect(atraso(3000)).toBeLessThanOrEqual(0.5)
    })

    it('os primeiros itens continuam entrando em cascata', () => {
        // Cerca do outro lado: "consertar" zerando o atraso mataria o efeito.
        const atraso = atrasoDoItem()
        expect(atraso(0)).toBe(0)
        expect(atraso(5)).toBeGreaterThan(0)
    })
})
