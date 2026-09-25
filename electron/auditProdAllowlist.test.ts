import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { avaliarGate } from '../scripts/audit-prod-avaliar.mjs'

/**
 * 🔒 D147 — a allowlist do gate de audit (scripts/audit-prod.mjs) não avisava
 * quando uma exceção morria.
 *
 * O script só imprimia as exceções que CASARAM. Uma entrada que parou de casar
 * (advisory corrigida, rebaixada, dependência removida) nunca era reportada e
 * ficava na lista para sempre — justamente a "exceção com motivo falso" que o
 * próprio arquivo diz ser pior que nenhuma. Foi o que aconteceu com
 * GHSA-qwww-vcr4-c8h2 (react-router RSC): o lock foi para 7.18.4, o
 * `npm audit --omit=dev` passou a devolver zero vulnerabilidades e a exceção
 * seguiu lá, "justificada" com "não há correção na linha 7.x".
 *
 * Contrato: exceção não vista vira AVISO (anotação ::warning do Actions),
 * nunca falha. O advisory sumir é um evento BOM — pintar a main de vermelho
 * por isso seria um vermelho sem commit culpado.
 */

const VIVA = 'GHSA-aaaa-bbbb-cccc'
const MORTA = 'GHSA-dddd-eeee-ffff'
const NOVA = 'GHSA-gggg-hhhh-iiii'

const ALLOWLIST: Record<string, string> = {
    [VIVA]: 'motivo da viva',
    [MORTA]: 'motivo da morta',
}

function advisory(ghsa: string, severity: string, name = 'pacote') {
    return { url: `https://github.com/advisories/${ghsa}`, severity, title: `titulo ${ghsa}`, name }
}

/** Relatório no formato do `npm audit --json` (auditReportVersion 2). */
function relatorio(vulnerabilities: Record<string, unknown>) {
    return { auditReportVersion: 2, vulnerabilities, metadata: {} }
}

const avisoDeObsoleta = (ghsa: string, motivo: string) =>
    `::warning title=Allowlist do audit::${ghsa} não apareceu no audit (motivo registrado: "${motivo}") — exceção obsoleta, remova de scripts/audit-prod.mjs.`

const OK = '✅ Audit de produção OK (nenhuma HIGH+ fora da allowlist).'

describe('avaliarGate — exceções obsoletas da allowlist (D147)', () => {
    it('avisa a exceção que não apareceu no audit e segue usando a que apareceu', () => {
        const r = avaliarGate(
            relatorio({ pacote: { severity: 'high', via: [advisory(VIVA, 'high')] } }),
            ALLOWLIST,
        )
        expect(r.log).toEqual([
            `⚠️  Ignorado (allowlist): ${VIVA} — motivo da viva`,
            avisoDeObsoleta(MORTA, 'motivo da morta'),
            OK,
        ])
        expect(r.erro).toEqual([])
        expect(r.codigo).toBe(0)
    })

    it('audit limpo: toda a allowlist vira aviso e o gate passa (o caso do react-router 7.18.4)', () => {
        const r = avaliarGate(relatorio({}), ALLOWLIST)
        expect(r.log).toEqual([
            avisoDeObsoleta(VIVA, 'motivo da viva'),
            avisoDeObsoleta(MORTA, 'motivo da morta'),
            OK,
        ])
        expect(r.codigo).toBe(0)
    })

    it('advisory rebaixada para moderate também torna a exceção obsoleta', () => {
        const r = avaliarGate(
            relatorio({ pacote: { severity: 'moderate', via: [advisory(VIVA, 'moderate')] } }),
            { [VIVA]: 'motivo' },
        )
        expect(r.log).toEqual([avisoDeObsoleta(VIVA, 'motivo'), OK])
        expect(r.codigo).toBe(0)
    })

    it('pacote HIGH cuja advisory é só moderate não conta como uso da exceção', () => {
        const r = avaliarGate(
            relatorio({ pacote: { severity: 'high', via: [advisory(VIVA, 'moderate')] } }),
            { [VIVA]: 'motivo' },
        )
        expect(r.log).toEqual([avisoDeObsoleta(VIVA, 'motivo'), OK])
    })

    it('obsoleta NÃO bloqueia: só HIGH+ fora da lista derruba o gate', () => {
        const r = avaliarGate(
            relatorio({
                // a mensagem nomeia o pacote da advisory (`via.name`), não a chave
                'chave-do-no': { severity: 'critical', via: [advisory(NOVA, 'critical', 'outro')] },
                // entrada transitiva (string em `via`) não é advisory
                dependente: { severity: 'critical', via: ['chave-do-no'] },
            }),
            ALLOWLIST,
        )
        expect(r.codigo).toBe(1)
        expect(r.log).toEqual([
            avisoDeObsoleta(VIVA, 'motivo da viva'),
            avisoDeObsoleta(MORTA, 'motivo da morta'),
        ])
        expect(r.erro).toEqual([
            '',
            '❌ Vulnerabilidades HIGH+ de produção fora da allowlist:',
            `   • ${NOVA} (outro): titulo ${NOVA}`,
            '',
            'Corrija a dependência ou, se comprovadamente não se aplica ao app,',
            'adicione o GHSA à ALLOWLIST em scripts/audit-prod.mjs com o motivo.',
        ])
    })

    it('audit que falhou (JSON de erro do npm, sem `vulnerabilities`) não manda remover nada', () => {
        // Sem o relatório não dá pra saber se a exceção ainda casa: avisar
        // "remova" aqui seria mandar apagar uma exceção possivelmente viva.
        const r = avaliarGate({ error: { code: 'ENOTFOUND', summary: 'registry fora' } }, ALLOWLIST)
        expect(r.log).toEqual([
            '⚠️  O relatório do npm audit veio sem `vulnerabilities`: não dá pra conferir se a allowlist ainda vale.',
            OK,
        ])
        expect(r.log.some((l) => l.includes('::warning'))).toBe(false)
        expect(r.codigo).toBe(0)
    })

    it('allowlist vazia e audit limpo: nenhum aviso', () => {
        expect(avaliarGate(relatorio({}), {}).log).toEqual([OK])
    })
})

describe('scripts/audit-prod.mjs de ponta a ponta (relatório salvo, sem rede)', () => {
    const script = path.join(__dirname, '..', 'scripts', 'audit-prod.mjs')
    let pasta = ''

    beforeAll(() => {
        pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-audit-'))
    })
    afterAll(() => {
        fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    function rodar(nome: string, conteudo: unknown) {
        const arquivo = path.join(pasta, nome)
        fs.writeFileSync(arquivo, JSON.stringify(conteudo))
        const r = spawnSync(process.execPath, [script, arquivo], { encoding: 'utf-8' })
        return { codigo: r.status, stdout: r.stdout, stderr: r.stderr }
    }

    it('HIGH+ fora da allowlist: sai com 1 e lista a advisory no stderr', () => {
        const r = rodar('bloqueante.json', relatorio({
            outro: { severity: 'high', via: [advisory(NOVA, 'high', 'outro')] },
        }))
        expect(r.codigo).toBe(1)
        expect(r.stderr.includes('❌ Vulnerabilidades HIGH+ de produção fora da allowlist:')).toBe(true)
        expect(r.stderr.includes(`   • ${NOVA} (outro): titulo ${NOVA}`)).toBe(true)
        expect(r.stdout.includes(OK)).toBe(false)
    })

    it('relatório limpo: sai com 0 e imprime o OK no stdout', () => {
        const r = rodar('limpo.json', relatorio({}))
        expect(r.stderr).toBe('')
        expect(r.stdout.includes(OK)).toBe(true)
        expect(r.codigo).toBe(0)
    })
})
