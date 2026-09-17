import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🧹 Limpeza de pasta temporária em teste precisa tolerar handle preso.
 *
 * Vários testes criam uma pasta com `mkdtempSync` e a apagam no `afterEach`
 * com `fs.rmSync(dir, { recursive: true, force: true })`. No Windows isso é
 * moeda: `force: true` só ignora "não existe" — não resolve arquivo em uso. Um
 * `WriteStream` que ainda não fechou, um ffmpeg que acabou de receber `kill()`
 * (o `TerminateProcess` volta ANTES de o processo morrer), o indexador ou o
 * antivírus abrindo o arquivo recém-escrito: qualquer um deles faz o `rmSync`
 * estourar `EBUSY`/`ENOTEMPTY`/`EPERM`.
 *
 * E como isso acontece na fase de `afterEach`, o corpo do teste já PASSOU: o
 * job fica vermelho sem nenhum teste ruim, e o próximo `vitest run` fica verde.
 * É o retrato do flake que aparece e some (a mesma armadilha da lição
 * "timeout no afterEach lê a fase, não a causa").
 *
 * O `rmSync` aceita `maxRetries`/`retryDelay` exatamente para isso — só valem
 * com `recursive: true`. Custo: nada quando não há lock; no máximo ~100 ms
 * quando há.
 *
 * Este guarda varre os próprios testes e cobra a opção em toda remoção
 * recursiva, para que a próxima suíte que criar pasta temporária já nasça
 * protegida em vez de reintroduzir o flake.
 */
const RAIZ = path.join(__dirname, '..')

function arquivosDeTeste(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) return []
        const p = path.join(dir, e.name)
        if (e.isDirectory()) return arquivosDeTeste(p)
        // O próprio guarda cita `rmSync` no texto e na varredura; ele não é
        // sujeito da regra.
        if (e.name === path.basename(__filename).replace(/\.\w+$/, '.ts')) return []
        return /\.test\.tsx?$/.test(e.name) ? [p] : []
    })
}

/**
 * Tira comentários antes de varrer: vários testes DESCREVEM o `rmSync` do
 * código de produção no cabeçalho (`exclusaoConfirmada.test.ts` é um deles), e
 * cobrar `maxRetries` de uma frase em português não faz sentido.
 */
function semComentarios(fonte: string): string {
    return fonte
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n')
}

/** Toda chamada `rmSync(...)` do arquivo, com os argumentos entre parênteses. */
function remocoes(fonte: string): string[] {
    const achados: string[] = []
    const marca = 'rmSync('
    let at = fonte.indexOf(marca)
    while (at > -1) {
        let i = at + marca.length
        let nivel = 1
        for (; i < fonte.length && nivel > 0; i++) {
            if (fonte[i] === '(') nivel++
            else if (fonte[i] === ')') nivel--
        }
        achados.push(fonte.slice(at, i))
        at = fonte.indexOf(marca, at + 1)
    }
    return achados
}

describe('limpeza de pasta temporária nos testes', () => {
    it('toda remoção recursiva tolera arquivo preso (maxRetries)', () => {
        const semRetry: string[] = []
        for (const arquivo of [...arquivosDeTeste(path.join(RAIZ, 'electron')), ...arquivosDeTeste(path.join(RAIZ, 'src'))]) {
            const fonte = semComentarios(fs.readFileSync(arquivo, 'utf-8').split('\r\n').join('\n'))
            for (const chamada of remocoes(fonte)) {
                // Remoção de UM arquivo não sofre do problema (é o diretório
                // que fica preso pelo filho aberto) e não aceita a opção.
                if (!chamada.includes('recursive: true')) continue
                if (!chamada.includes('maxRetries')) {
                    semRetry.push(`${path.basename(arquivo)}: ${chamada.replace(/\s+/g, ' ').slice(0, 90)}`)
                }
            }
        }
        expect(semRetry).toEqual([])
    })

    it('o guarda está de fato olhando alguma coisa', () => {
        // Cerca contra o teste virar letra morta se a varredura parar de achar
        // arquivos (rename de pasta, mudança de extensão).
        const comRemocao = [...arquivosDeTeste(path.join(RAIZ, 'electron'))]
            .filter(a => remocoes(semComentarios(fs.readFileSync(a, 'utf-8'))).some(c => c.includes('recursive: true')))
        expect(comRemocao.length).toBeGreaterThanOrEqual(5)
    })
})
