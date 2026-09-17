import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔁 O e2e que só passou na SEGUNDA tentativa tem que deixar rastro.
 *
 * `retries: 1` vale também no CI: o teste que é moeda falha, repete, passa — e o
 * job fica verde. Os reporters list+github ainda contam o "flaky" no log do job,
 * mas o relatório HTML (onde moram o error-context e o último passo da tentativa
 * que falhou) era guardado com `if: failure()`, ou seja, JAMAIS no caso que
 * interessa.
 *
 * O contrato atravessa DOIS arquivos e só vale com as duas pontas AMARRADAS: a
 * pasta que o reporter html escreve (playwright.config.ts) tem que ser a pasta
 * que o passo de upload sobe (ci.yml), no MESMO job que roda o Playwright, e o
 * passo tem que rodar com o job verde. Checar "existe reporter html" de um lado
 * e "existe um upload" do outro passaria pelo motivo errado: bastaria renomear
 * a pasta de uma das pontas para o artefato voltar a sair vazio — e, com
 * `if-no-files-found: ignore`, sem nem o aviso amarelo.
 */
vi.mock('@playwright/test', () => ({
    // defineConfig é identidade; o que interessa é o OBJETO que o config monta.
    // Importar o @playwright/test de verdade custa segundos (carrega o runner) e
    // não acrescenta nada aqui.
    defineConfig: (config: unknown) => config,
}))

type ConfigE2e = {
    retries?: number
    forbidOnly?: boolean
    reporter?: unknown
}

/** Carrega o playwright.config.ts com (ou sem) CI ligado. */
async function carregarConfig(comCi: boolean): Promise<ConfigE2e> {
    const antes = process.env.CI
    if (comCi) process.env.CI = 'true'
    else delete process.env.CI
    vi.resetModules()
    try {
        const mod = await import('../playwright.config')
        return mod.default as ConfigE2e
    } finally {
        if (antes === undefined) delete process.env.CI
        else process.env.CI = antes
    }
}

/**
 * A pasta que o reporter html grava. Sem reporter html não existe pasta nenhuma
 * para o ci.yml subir — por isso a ausência é falha aqui, e não um default.
 */
function pastaDoRelatorio(cfg: ConfigE2e): string {
    const reporters: unknown[] = Array.isArray(cfg.reporter) ? cfg.reporter : []
    const html = reporters.find(
        (r): r is [string, { outputFolder?: string } | undefined] =>
            Array.isArray(r) && r[0] === 'html',
    )
    expect(html, 'o CI não gera mais o relatório html: não há pasta para subir').toBeTruthy()
    return html?.[1]?.outputFolder ?? 'playwright-report'
}

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml')

/**
 * Lê o workflow normalizando a quebra de linha: o repositório entrega CRLF no
 * Windows, que é justamente onde este CI roda.
 */
function lerWorkflow(): string {
    return fs.readFileSync(WORKFLOW, 'utf-8').split('\r\n').join('\n')
}

/**
 * Só o job que roda o Playwright, recortado até o próximo job de topo. Um upload
 * em OUTRO job sobe nada: cada job tem o seu workspace.
 */
function jobDoE2e(fonte: string): string {
    const inicio = fonte.indexOf('\n  e2e:\n')
    expect(inicio, 'o ci.yml não tem mais o job e2e').toBeGreaterThan(-1)
    const resto = fonte.slice(inicio + 1)
    const fim = resto.slice(1).search(/\n {2}[A-Za-z_][\w-]*:\n/)
    return fim === -1 ? resto : resto.slice(0, fim + 1)
}

/** O passo do job que sobe o artefato chamado playwright-report. */
function passoDoUpload(job: string): string {
    const blocos = job.split('\n      - ')
    const achados = blocos.filter(
        (b) =>
            /\n {8}uses: actions\/upload-artifact/.test(b) &&
            /\n {10}name: playwright-report\n/.test(b),
    )
    expect(achados.length, 'esperava exatamente um passo subindo o artefato playwright-report').toBe(1)
    return achados[0]
}

describe('rastro do e2e que passou na segunda tentativa', () => {
    let noCi: ConfigE2e
    let local: ConfigE2e
    const job = jobDoE2e(lerWorkflow())

    beforeAll(async () => {
        noCi = await carregarConfig(true)
        local = await carregarConfig(false)
    })

    it('o CI repete o e2e que falha — logo existe rastro a guardar', () => {
        // Se um dia isto virar 0 no CI, o flaky passa a pintar o job de vermelho
        // sozinho e este guarda inteiro precisa ser relido, não remendado.
        expect(noCi.retries ?? 0).toBeGreaterThan(0)
    })

    it('o ci.yml sobe a MESMA pasta que o reporter html escreve, no mesmo job', () => {
        // As duas pontas amarradas: renomear a pasta de um lado só derruba isto.
        const pasta = pastaDoRelatorio(noCi)
        const passo = passoDoUpload(job)
        expect(passo.includes(`\n          path: ${pasta}/\n`)).toBe(true)
        // E o Playwright, que é quem gera a pasta, roda neste mesmo job.
        expect(/\n {8}run: (?:.*playwright test|npm run test:e2e)/.test(job)).toBe(true)
    })

    it('o relatório é guardado mesmo quando o job termina verde', () => {
        // `if: failure()` guardava tudo, MENOS o único caso em que o job fica
        // verde escondendo uma falha: o teste que passou na repetição.
        const passo = passoDoUpload(job)
        expect(/\n {8}if: always\(\)\n/.test(passo)).toBe(true)
        expect(/\n {8}if: failure\(\)\n/.test(passo)).toBe(false)
    })

    it('um test.only esquecido derruba o CI em vez de deixá-lo verde', () => {
        // Com `.only` o Playwright roda UM teste e sai zero: a suíte inteira
        // some e o job segue verde. Localmente o `.only` continua valendo, que é
        // para o que ele serve.
        expect(noCi.forbidOnly).toBe(true)
        expect(local.forbidOnly ?? false).toBe(false)
    })
})
