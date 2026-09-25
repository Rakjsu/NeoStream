import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * 🔒 Regressão (D144): o typecheck do CI não enxergava o processo principal.
 *
 * O passo "Typecheck" do ci.yml é `npx tsc -b`, que só compila os projetos
 * listados em `references` do tsconfig.json. Eram dois: tsconfig.app.json
 * (`include: ["src"]`) e tsconfig.node.json (`include: ["vite.config.ts"]`).
 * Nenhum arquivo de electron/ nem de e2e/ passava pelo tsc — o esbuild do
 * vite-plugin-electron só apaga os tipos e o eslint roda sem type-checking.
 * Resultado: narrowing faltando (`airplaySession?.device.id === deviceId`
 * com deviceId `any` lê `.device` de null), cast que mente
 * (`as ChildProcessWithoutNullStreams` num spawn com stdout 'ignore'), chave
 * duplicada num literal, parâmetro morto — tudo verde no CI.
 *
 * O teste resolve a configuração do jeito que o `tsc -b` resolve (API do
 * próprio TypeScript, seguindo as `references`) e exige que TODO .ts/.tsx do
 * repositório caia num projeto com `strict` ligado — e que o código de
 * produção do main seja checado SEM a lib DOM (ele roda em Node).
 */

const ROOT = path.join(__dirname, '..')

/** Pastas que não são fonte: dependências, saídas de build e pastas ocultas. */
const PASTAS_FORA = new Set(['node_modules', 'dist', 'dist-electron', 'release'])

const normalizar = (arquivo: string) => path.resolve(arquivo).replace(/\\/g, '/').toLowerCase()
const relativo = (arquivo: string) => path.relative(ROOT, arquivo).replace(/\\/g, '/')

function lerProjeto(configPath: string): ts.ParsedCommandLine {
    const host: ts.ParseConfigFileHost = {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
            throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        },
    }
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host)
    if (!parsed) throw new Error(`não deu pra ler ${configPath}`)
    return parsed
}

/** Os projetos que o `tsc -b` compila a partir do tsconfig.json da raiz. */
function projetosDoBuild(): ts.ParsedCommandLine[] {
    const raiz = lerProjeto(path.join(ROOT, 'tsconfig.json'))
    return (raiz.projectReferences ?? []).map((ref) => lerProjeto(ts.resolveProjectReferencePath(ref)))
}

function arquivosTs(dir: string): string[] {
    const saida: string[] = []
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const cheio = path.join(dir, entrada.name)
        if (entrada.isDirectory()) {
            if (entrada.name.startsWith('.') || PASTAS_FORA.has(entrada.name)) continue
            saida.push(...arquivosTs(cheio))
        } else if (/\.[cm]?tsx?$/.test(entrada.name) && !/\.d\.[cm]?ts$/.test(entrada.name)) {
            saida.push(cheio)
        }
    }
    return saida
}

/** Para cada arquivo, as opções de todos os projetos que o têm como raiz. */
function coberturaPorArquivo(): Map<string, ts.CompilerOptions[]> {
    const cobertos = new Map<string, ts.CompilerOptions[]>()
    for (const parsed of projetosDoBuild()) {
        for (const arquivo of parsed.fileNames) {
            const chave = normalizar(arquivo)
            cobertos.set(chave, [...(cobertos.get(chave) ?? []), parsed.options])
        }
    }
    return cobertos
}

const temDom = (opcoes: ts.CompilerOptions) => (opcoes.lib ?? []).some((lib) => /dom/i.test(lib))

describe('typecheck do CI cobre o processo principal e o E2E (D144)', () => {
    it('o passo Typecheck do CI é o `tsc -b` que segue as references do tsconfig.json', () => {
        const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
        expect(/run:\s*npx tsc -b\s*$/m.test(ci)).toBe(true)
    })

    it('todo .ts/.tsx do repositório entra num projeto referenciado, com strict ligado', () => {
        const cobertos = coberturaPorArquivo()
        const alvo = arquivosTs(ROOT)
        // Sanidade da varredura: as três pastas de código e as configs da raiz.
        for (const esperado of ['electron/main.ts', 'e2e/app.spec.ts', 'src/main.tsx', 'vitest.config.ts', 'playwright.config.ts']) {
            expect(alvo.map(relativo)).toContain(esperado)
        }

        const fora = alvo.filter((f) => !cobertos.has(normalizar(f)))
        expect(fora.map(relativo)).toEqual([])

        const semStrict = alvo.filter((f) => !(cobertos.get(normalizar(f)) ?? []).every((o) => o.strict === true))
        expect(semStrict.map(relativo)).toEqual([])
    })

    it('o código de produção do main é checado sem a lib DOM (ele roda em Node, não no navegador)', () => {
        const cobertos = coberturaPorArquivo()
        const producao = arquivosTs(path.join(ROOT, 'electron')).filter((f) => !/\.test\.ts$/.test(f))
        expect(producao.length).toBeGreaterThan(50)

        // Sem projeto nenhum também reprova: "sem DOM" não pode passar por vácuo.
        const naoChecadoSemDom = producao.filter((f) => {
            const projetos = cobertos.get(normalizar(f)) ?? []
            return projetos.length === 0 || projetos.some(temDom)
        })
        expect(naoChecadoSemDom.map(relativo)).toEqual([])
    })

    it('o projeto dos testes do main enxerga as declarações globais do renderer (window.ipcRenderer, __APP_VERSION__)', () => {
        // Testes do main importam módulos de src/ e specs E2E falam com
        // window.ipcRenderer: sem essas duas .d.ts o projeto reprovaria
        // código correto — e a tentação seria afrouxar o strict.
        const umTeste = normalizar(path.join(ROOT, 'electron', 'typecheckCobreOMain.test.ts'))
        const doTeste = projetosDoBuild().find((parsed) => parsed.fileNames.some((f) => normalizar(f) === umTeste))
        expect(doTeste).toBeDefined()
        const arquivos = new Set(doTeste!.fileNames.map(normalizar))
        expect(arquivos.has(normalizar(path.join(ROOT, 'src', 'types', 'electron.d.ts')))).toBe(true)
        expect(arquivos.has(normalizar(path.join(ROOT, 'src', 'vite-env.d.ts')))).toBe(true)
    })
})
