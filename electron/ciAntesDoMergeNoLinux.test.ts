import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🐧 D146 — o PR tem que passar num sistema de arquivos que diferencia caixa.
 *
 * O app sai para Windows, Linux e macOS (matriz do release.yml), mas a CI de PR
 * (ci.yml) só rodava em `windows-latest`. No NTFS `import './Foo'` acha o
 * `foo.ts`, e um teste que monta caminho com `\\` na mão passa; no Linux os dois
 * quebram. O único lugar que compilava fora do Windows era o build.yml, que só
 * dispara em `push` na main — isto é, DEPOIS do merge — e a suíte inteira só
 * rodava no Linux no portão da release (job `verificar`, ubuntu). Resultado: o
 * erro chegava à main e aparecia justamente na hora de tagar a versão.
 *
 * O contrato aqui: o job `check` do ci.yml (o que roda em `pull_request`) roda
 * também num Linux, e o veredito do Linux VALE — nenhum passo preso a um
 * sistema só (fora o audit, que olha o lockfile e dá o mesmo resultado nos
 * dois), nada de `continue-on-error`, nada de `if:` no job, nada de `exclude`
 * na matriz. Qualquer um desses devolveria o buraco sem mudar o que se vê no
 * nome do job. O e2e, que precisa do Electron com tela, continua só no Windows.
 */
const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml')

/** Lê o workflow normalizando CRLF (o repositório entrega CRLF no Windows). */
function lerWorkflow(): string {
    return fs.readFileSync(WORKFLOW, 'utf-8').split('\r\n').join('\n')
}

/** Recorta um job de topo (`  nome:`) até o próximo job de topo. */
function recortarJob(fonte: string, nome: string): string {
    const inicio = fonte.indexOf(`\n  ${nome}:\n`)
    expect(inicio, `o ci.yml não tem mais o job ${nome}`).toBeGreaterThan(-1)
    const resto = fonte.slice(inicio + 1)
    const fim = resto.slice(1).search(/\n {2}[A-Za-z_][\w-]*:\n/)
    return fim === -1 ? resto : resto.slice(0, fim + 1)
}

/** O cabeçalho do job: tudo antes de `steps:` (runs-on, if, strategy...). */
function cabecalhoDoJob(job: string): string {
    const i = job.indexOf('\n    steps:\n')
    expect(i, 'job sem steps:').toBeGreaterThan(-1)
    return job.slice(0, i + 1)
}

/**
 * Os sistemas em que o job roda de fato: o `runs-on` literal, ou — quando ele
 * vem da matriz — a lista `os:` da `strategy.matrix` do próprio job.
 */
function sistemasDoJob(job: string): string[] {
    const runsOn = /\n {4}runs-on: (.+)\n/.exec(job)?.[1]?.trim()
    expect(runsOn, 'job sem runs-on').toBeTruthy()
    if (!runsOn!.includes('${{')) return [runsOn!]
    expect(runsOn).toBe('${{ matrix.os }}')
    const lista = /\n {8}os: \[([^\]]*)\]\n/.exec(job)?.[1]
    expect(lista, 'runs-on vem da matriz, mas a matriz não tem a lista os: [...]').toBeTruthy()
    return lista!
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
}

/** Os passos (`      - ...`) do job, cada um com o seu bloco de chaves. */
function passosDoJob(job: string): string[] {
    return job.split('\n      - ').slice(1)
}

/** O passo que roda `comando`, e só ele. */
function passoQueRoda(job: string, comando: string): string {
    const achados = passosDoJob(job).filter((p) => new RegExp(`\\n? *run: ${comando}\\s*(\\n|$)`).test(p))
    expect(achados.length, `esperava exatamente um passo rodando "${comando}"`).toBe(1)
    return achados[0]
}

describe('ci.yml: o PR também roda num Linux (D146)', () => {
    const fonte = lerWorkflow()
    const check = recortarJob(fonte, 'check')

    it('a CI dispara no pull_request — é ANTES do merge que o Linux tem que falar', () => {
        expect(/^on:\n(?: {2}.*\n|\s*#.*\n)* {2}pull_request:/m.test(fonte)).toBe(true)
    })

    it('o job check roda no Windows E num Linux (caixa alta importa lá)', () => {
        const sistemas = sistemasDoJob(check)
        expect(sistemas).toContain('windows-latest')
        expect(sistemas.some((s) => s.startsWith('ubuntu-'))).toBe(true)
    })

    it('typecheck, lint, testes e build rodam nos dois sistemas', () => {
        // Os passos que decidem o veredito existem, cada um uma vez só.
        for (const comando of ['npx tsc -b', 'npx eslint src electron', 'npx vitest run', 'npx vite build']) {
            passoQueRoda(check, comando)
        }
        // E nenhum passo fica preso a um sistema — um `if: matrix.os ==
        // 'windows-latest'` no vitest devolveria o buraco inteiro. O audit é a
        // única exceção: ele lê o package-lock, que é o mesmo nos dois.
        const presos = passosDoJob(check)
            .filter((p) => /\n {8}if:/.test(p))
            .filter((p) => !/\n {8}run: node scripts\/audit-prod\.mjs\s*(\n|$)/.test(p))
        expect(presos.map((p) => p.split('\n')[0])).toEqual([])
    })

    it('o veredito do Linux vale: sem continue-on-error, sem if: no job, sem exclude na matriz', () => {
        expect(check.includes('continue-on-error'), 'continue-on-error no job check').toBe(false)
        const cabecalho = cabecalhoDoJob(check)
        expect(/\n {4}if:/.test(cabecalho), 'if: no job check').toBe(false)
        expect(/\n {8}(exclude|include):/.test(cabecalho), 'exclude/include na matriz do check').toBe(false)
    })

    it('um sistema vermelho não cancela o outro (cada um dá o seu veredito)', () => {
        // Com fail-fast (o padrão), o Linux vermelho cancela o Windows no meio e
        // o PR fica sem saber se o problema é só do Linux.
        expect(/\n {6}fail-fast: false\n/.test(cabecalhoDoJob(check))).toBe(true)
    })

    it('o e2e (Electron com tela) continua só no Windows', () => {
        expect(sistemasDoJob(recortarJob(fonte, 'e2e'))).toEqual(['windows-latest'])
    })
})
