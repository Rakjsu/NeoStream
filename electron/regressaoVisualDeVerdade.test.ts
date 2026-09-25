import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🖼️ A regressão visual tem que COMPARAR de verdade — e reprovar quando difere.
 *
 * Até o #D145 ela era um `bash e2e/visual-diff.sh` chamando o `compare` e o
 * `identify` do ImageMagick no job e2e (windows-latest). O passo saía com
 * código 1 em TODO run (inclusive no run do próprio commit que gravou as
 * baselines, em 19/07), nunca produziu um único PNG de diff (o artefato
 * visual-diffs jamais subiu) e o `continue-on-error: true` pintava isso de
 * verde. Medido em 25/09 com as telas do run verde da main: as cinco baselines
 * seguiam dentro do limiar — o problema nunca foi a baseline velha, era o
 * comparador que não rodava.
 *
 * Agora quem compara é o `toHaveScreenshot` do próprio Playwright (vem no
 * @playwright/test; roda em qualquer runner) dentro do e2e/screenshots.spec.ts,
 * e a falha reprova o job. O comportamento em si é provado pelo próprio e2e
 * (que também confere, em tempo de execução, que TODA baseline foi comparada).
 * Este guarda amarra as pontas que, soltas, devolvem o teste de mentira: o
 * template de caminho aponta pra e2e/baselines, cada nome comparado tem
 * baseline, o limiar existe e é apertado, a espera é pela tela e não pelo
 * relógio, e o ci.yml não volta a depender de binário externo nem a engolir a
 * falha com continue-on-error.
 */
vi.mock('@playwright/test', () => ({
    // defineConfig é identidade; o que interessa é o OBJETO que o config monta.
    defineConfig: (config: unknown) => config,
}))

type ConfigE2e = {
    testDir?: string
    snapshotPathTemplate?: string
    expect?: { toHaveScreenshot?: { maxDiffPixelRatio?: number; maxDiffPixels?: number } }
}

const RAIZ = path.join(__dirname, '..')
const BASELINES = path.join(RAIZ, 'e2e', 'baselines')
const SPEC = path.join(RAIZ, 'e2e', 'screenshots.spec.ts')
const HELPERS = path.join(RAIZ, 'e2e', 'helpers.ts')
const WORKFLOW = path.join(RAIZ, '.github', 'workflows', 'ci.yml')

/** Fontes chegam CRLF no Windows: normaliza antes de qualquer regex. */
function ler(arquivo: string): string {
    return fs.readFileSync(arquivo, 'utf-8').split('\r\n').join('\n')
}

async function carregarConfig(): Promise<ConfigE2e> {
    const antes = process.env.CI
    process.env.CI = 'true'
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
 * Resolve o snapshotPathTemplate como o Playwright faz para um
 * `toHaveScreenshot('<nome>.png')`: {arg} é o nome sem extensão, {ext} a
 * extensão com ponto, {testDir} a pasta de testes relativa à raiz.
 */
function resolverBaseline(cfg: ConfigE2e, nome: string): string {
    const template = cfg.snapshotPathTemplate ?? ''
    const ext = path.extname(nome)
    const arg = nome.slice(0, nome.length - ext.length)
    const testDir = path.join(RAIZ, cfg.testDir ?? '.')
    const trocado = template
        .split('{testDir}').join(testDir)
        .split('{arg}').join(arg)
        .split('{ext}').join(ext)
    return path.isAbsolute(trocado) ? path.normalize(trocado) : path.join(RAIZ, trocado)
}

/** Os nomes de tela que o spec captura e compara (literal ou via a lista TELAS). */
function nomesComparadosNoSpec(spec: string): string[] {
    expect(spec.includes('toHaveScreenshot('), 'o screenshots.spec.ts não compara mais nada').toBe(true)
    return [...new Set([...spec.matchAll(/'(\d{2}-[a-z0-9-]+\.png)'/g)].map((m) => m[1]))].sort()
}

/** Largura x altura lidas do cabeçalho IHDR do PNG. */
function dimensoesPng(arquivo: string): [number, number] {
    const buf = fs.readFileSync(arquivo)
    expect(buf.subarray(1, 4).toString('latin1'), `${arquivo} não é PNG`).toBe('PNG')
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

/** Só o job e2e do ci.yml, até o próximo job de topo. */
function jobDoE2e(fonte: string): string {
    const inicio = fonte.indexOf('\n  e2e:\n')
    expect(inicio, 'o ci.yml não tem mais o job e2e').toBeGreaterThan(-1)
    const resto = fonte.slice(inicio + 1)
    const fim = resto.slice(1).search(/\n {2}[A-Za-z_][\w-]*:\n/)
    return fim === -1 ? resto : resto.slice(0, fim + 1)
}

describe('regressão visual que compara de verdade (#D145)', () => {
    let cfg: ConfigE2e

    beforeAll(async () => {
        cfg = await carregarConfig()
    })

    it('cada tela comparada no spec resolve para um PNG versionado em e2e/baselines', () => {
        const nomes = nomesComparadosNoSpec(ler(SPEC))
        expect(nomes.length).toBeGreaterThan(0)
        for (const nome of nomes) {
            const alvo = resolverBaseline(cfg, nome)
            expect(path.dirname(alvo), `${nome} não resolve para e2e/baselines`).toBe(BASELINES)
            expect(fs.existsSync(alvo), `${nome}: baseline ausente em ${alvo}`).toBe(true)
            // O spec crava a janela em 1024x720 com escala 1 forçada: baseline
            // com outra dimensão reprova sempre.
            expect(dimensoesPng(alvo), `${nome}: dimensão da baseline`).toEqual([1024, 720])
        }
    })

    it('nenhuma baseline fica órfã: todo PNG de e2e/baselines é citado no spec', () => {
        const nomes = nomesComparadosNoSpec(ler(SPEC))
        const baselines = fs.readdirSync(BASELINES).filter((f) => f.endsWith('.png')).sort()
        expect(baselines).toEqual(nomes)
    })

    it('o limiar existe e é apertado: 1% dos pixels, no máximo', () => {
        const limiar = cfg.expect?.toHaveScreenshot?.maxDiffPixelRatio
        expect(limiar, 'sem maxDiffPixelRatio o toHaveScreenshot exige pixel idêntico').toBeTypeOf('number')
        expect(limiar as number).toBeGreaterThan(0)
        expect(limiar as number).toBeLessThanOrEqual(0.01)
    })

    it('a captura sai no tamanho das baselines em qualquer máquina (escala 1, 1024x720)', () => {
        const spec = ler(SPEC)
        // Sem isto a janela herda a tela: 1024x720 no runner, 1503x1003 num PC
        // com escala de 125% — e todo `npx playwright test` local reprova por
        // dimensão, o que empurra alguém a apagar o teste.
        expect(spec.includes("'--force-device-scale-factor=1'")).toBe(true)
        expect(spec.includes('setContentSize(')).toBe(true)
        expect(/const LARGURA = 1024;/.test(spec) && /const ALTURA = 720;/.test(spec)).toBe(true)
        // E o launchApp repassa os switches ao Electron (senão o de cima é enfeite).
        expect(ler(HELPERS).includes('args: [...(options.electronArgs ?? []), MAIN_JS]')).toBe(true)
    })

    it('uma captura que falha reprova o teste em vez de sumir num catch', () => {
        // O `catch {}` antigo deixava uma tela que não abriu passar calada.
        expect(/\bcatch\b/.test(ler(SPEC))).toBe(false)
    })

    it('a captura espera a tela assentar, não um número fixo de milissegundos', () => {
        // Com a comparação reprovando o job, `waitForTimeout(2000)` vira moeda:
        // runner lento = tela ainda carregando = vermelho. O toHaveScreenshot
        // já espera a tela parar de mudar antes de comparar.
        expect(/waitForTimeout\s*\(/.test(ler(SPEC))).toBe(false)
    })

    it('o ci.yml não depende de binário de imagem externo nem engole a falha', () => {
        const job = jobDoE2e(ler(WORKFLOW))
        expect(job.includes('visual-diff.sh'), 'o passo do bash/ImageMagick voltou').toBe(false)
        expect(/\b(magick|compare|identify)\s+-/.test(job), 'binário do ImageMagick no job e2e').toBe(false)
        // A CHAVE do YAML, não a palavra: o comentário do job cita o passo antigo.
        expect(/\n\s+continue-on-error\s*:/.test(job), 'continue-on-error no job e2e').toBe(false)
        expect(fs.existsSync(path.join(RAIZ, 'e2e', 'visual-diff.sh'))).toBe(false)
    })
})
