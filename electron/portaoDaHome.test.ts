import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔒 A Home precisa CONSUMIR o portão parental/infantil, não só tê-lo.
 *
 * A regra do portão é provada montada em `src/hooks/useHomeContentGate.test.tsx`,
 * e a tradução "item da fileira → o que o portão julga" (`descreverItemDaHome`)
 * tem teste de unidade no mesmo arquivo. O que nenhum dos dois alcança é a
 * outra ponta: que a Home ENTREGUE ao portão os itens certos. Apagar a chamada
 * — ou mantê-la e entregar a categoria vazia — deixa os dois verdes e a Home
 * servindo catálogo cru de novo, que é o defeito original.
 *
 * Guarda estrutural porque montar a Home sai mais caro que o conserto (~2200
 * linhas, react-router, uma dúzia de canais IPC, IndexedDB). Mas NÃO é
 * reencenação do diff: como em `electron/ordemDoContinuarAssistindo.test.ts`,
 * os trechos que importam são RECORTADOS do fonte, compilados com
 * `new Function` e EXECUTADOS com dados falsos — o guarda mede o que a Home
 * faz, não o texto que ela tem. Fica verde para qualquer outra forma de
 * escrever a mesma coisa.
 *
 * Preço: se essa lógica sair da Home para um helper, o recorte falha dizendo
 * "não achei ... em Home.tsx" e o guarda vira teste de unidade do helper.
 */
const HOME = path.join(__dirname, '..', 'src', 'pages', 'Home.tsx')
const fonte = fs.readFileSync(HOME, 'utf-8').replace(/\r\n/g, '\n')

/** Recorta o argumento entre parênteses balanceados a partir de `abre`. */
function argumentoDe(origem: number, abre: string, rotulo: string): string {
    const ini = fonte.indexOf(abre, origem)
    expect(ini, `não achei \`${abre}\` (${rotulo}) em Home.tsx`).toBeGreaterThan(-1)
    let i = ini + abre.length - 1
    let nivel = 0
    for (; i < fonte.length; i++) {
        if (fonte[i] === '(') nivel++
        else if (fonte[i] === ')') {
            nivel--
            if (nivel === 0) break
        }
    }
    expect(i, `parênteses não fecharam em ${rotulo}`).toBeLessThan(fonte.length)
    // `as const` é a única anotação de tipo dentro dos trechos recortados;
    // sai para o `new Function` compilar JavaScript puro.
    return fonte.slice(ini + abre.length, i).replace(/ as const/g, '')
}

/** Primeiro argumento de uma lista: o `useCallback(fn, [deps])` traz os dois. */
function primeiroArgumento(lista: string): string {
    let nivel = 0
    for (let i = 0; i < lista.length; i++) {
        const c = lista[i]
        if (c === '(' || c === '[' || c === '{') nivel++
        else if (c === ')' || c === ']' || c === '}') nivel--
        else if (c === ',' && nivel === 0) return lista.slice(0, i)
    }
    return lista
}

type ItemJulgado = { name: string; categoryIds: string[]; kind: string }

/** A mesma tradução do hook, para o trecho recortado poder chamá-la. */
function descreverItemDaHome(item: Record<string, unknown>, fileira: string): ItemJulgado {
    const kind = fileira === 'continue'
        ? (item.type === 'series' ? 'series' : 'movie')
        : (fileira === 'series' || (fileira === 'recommendations' && 'series_id' in item) ? 'series' : 'movie')
    return {
        name: typeof item.name === 'string' ? item.name : String(item.name ?? ''),
        categoryIds: item.category_id === undefined
            ? []
            : (Array.isArray(item.category_id) ? item.category_id : [item.category_id]).map(String),
        kind,
    }
}

describe('a Home entrega as fileiras ao portão', () => {
    it('o filtro roda para TODA fileira e julga com a categoria do item', () => {
        const corpo = argumentoDe(fonte.indexOf('const visibleItems'), 'items.filter(', 'o filtro das fileiras')
        const filtrar = new Function(
            'descreverItemDaHome', 'passaNoPortao', 'isKidsProfile', 'hiddenItems', 'normalizeName', 'type',
            `return (${corpo});`,
        )

        const julgados: ItemJulgado[] = []
        const espiao = (alvo: ItemJulgado) => { julgados.push(alvo); return alvo.name !== 'Adulto' }
        const rodar = (type: string, itens: Record<string, unknown>[]) => {
            julgados.length = 0
            const predicado = filtrar(descreverItemDaHome, espiao, false, new Set(), (s: string) => s, type)
            return { sobraram: itens.filter(predicado).map(i => i.name), julgados: [...julgados] }
        }

        // 1) Todo item passa pelo portão — e o bloqueado some de verdade.
        const r = rodar('movie', [{ name: 'Adulto', category_id: 9 }, { name: 'Ação', category_id: 1 }])
        expect(r.sobraram).toEqual(['Ação'])

        // 2) E o portão recebe a CATEGORIA do item, não as mãos vazias: sem
        // isto (`categoryIds: []`) o filtro continua "rodando" e nada é barrado
        // por categoria — o defeito de volta, com o teste verde.
        expect(r.julgados.map(j => j.categoryIds)).toEqual([['9'], ['1']])

        // 3) A fileira de "continuar assistindo" leva o tipo de dentro do item
        // e também carrega categoria.
        const c = rodar('continue', [{ name: 'S', type: 'series', category_id: '66' }])
        expect(c.julgados).toEqual([{ name: 'S', categoryIds: ['66'], kind: 'series' }])
    })

    it('o ⏯️ entrega a categoria do catálogo, senão o portão julga de mãos vazias', () => {
        // A fileira "continuar assistindo" é montada à mão: um objeto novo,
        // CÓPIA de alguns campos do item do catálogo. Esquecer a categoria ali
        // deixa o filtro rodando e o portão cego — o filme bloqueado volta à
        // Home por esta porta, com os outros testes todos verdes.
        const inicio = fonte.indexOf('const items: ContinueWatchingItem[] = []')
        expect(inicio, 'não achei a montagem do continuar assistindo').toBeGreaterThan(-1)

        const montar = (origem: number, nomeDaFonte: string, dados: Record<string, unknown>) => {
            const literal = argumentoDe(origem, 'items.push(', `o push de ${nomeDaFonte}`)
            const fabricar = new Function(nomeDaFonte, 'seriesId', 'movieId', 'progress',
                `return (${literal});`)
            return fabricar(dados, 'id', 'id', {}) as Record<string, unknown>
        }

        const daSerie = montar(inicio, 'seriesData', { name: 'S', cover: '', category_id: '7' })
        const doFilme = montar(fonte.indexOf('items.push(', fonte.indexOf('items.push(', inicio) + 1),
            'movieData', { name: 'F', stream_icon: '', category_id: '9' })

        expect(descreverItemDaHome(daSerie, 'continue').categoryIds).toEqual(['7'])
        expect(descreverItemDaHome(doFilme, 'continue').categoryIds).toEqual(['9'])
    })

    it('o filtro não volta a valer só no perfil infantil', () => {
        // Era `isKidsProfile ? items.filter(...) : items`: com parental ligado
        // num perfil adulto, a Home mostrava tudo.
        expect(fonte.includes('const visibleItems = isKidsProfile ?')).toBe(false)
    })

    it('a roleta sorteia DENTRO do portão', () => {
        const corpo = primeiroArgumento(argumentoDe(fonte.indexOf('const spinTheRoulette'), 'useCallback(', 'a roleta'))
        const sortear = new Function(
            'descreverItemDaHome', 'passaNoPortao', 'allMovies', 'movieProgressService',
            'favoredCategoryIds', 'spinRoulette', 'setRouletteItem',
            `return (${corpo});`,
        )

        const catalogo = [
            // O 1 já foi assistido (de antes do parental); o 3 nunca foi, e é o
            // que denuncia um sorteio tirado do catálogo cru.
            { stream_id: 1, name: 'Adulto visto', category_id: 9 },
            { stream_id: 2, name: 'Ação', category_id: 1 },
            { stream_id: 3, name: 'Adulto novo', category_id: 9 },
        ]
        let sorteados: Record<string, unknown>[] = []
        let pesadas: unknown[] = []
        sortear(
            descreverItemDaHome,
            (alvo: ItemJulgado) => !alvo.name.startsWith('Adulto'),
            catalogo,
            // O bloqueado consta como JÁ ASSISTIDO (de antes do parental).
            { getWatchedMovies: () => ['1'] },
            (cats: unknown[]) => { pesadas = cats; return new Set<string>() },
            (pool: Record<string, unknown>[]) => { sorteados = pool; return pool[0] },
            () => undefined,
        )()

        // O catálogo cru tem os dois; o sorteio só pode ver o permitido.
        expect(sorteados.map(m => m.name)).toEqual(['Ação'])

        // E a preferência também sai do permitido: puxar a categoria do filme
        // assistido do catálogo CRU faz a roleta pender para a categoria
        // bloqueada — sem vazar item, mas escolhendo pelo gosto proibido.
        expect(pesadas).toEqual([undefined])
    })

    it('nenhum card abre a ficha por fora do handleContentClick', () => {
        // A roleta chamava `setSelectedContent({...})` direto, pulando a
        // checagem de classificação que o clique normal faz.
        const inicio = fonte.indexOf('const handleContentClick')
        expect(inicio).toBeGreaterThan(-1)
        const fim = fonte.indexOf('\n    };', inicio)
        const dentroDoHandler = fonte.slice(inicio, fim)

        const total = fonte.split('setSelectedContent({').length - 1
        const noHandler = dentroDoHandler.split('setSelectedContent({').length - 1
        expect(total).toBe(noHandler)
    })
})
