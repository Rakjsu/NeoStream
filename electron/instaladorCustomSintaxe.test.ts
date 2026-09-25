import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// D150 — o JavaScript do instalador customizado (installer-shell/) vira o
// NeoStream-IPTV-Installer-<versão>.exe de toda release (release.yml, passo
// "Build custom installer"), mas está no globalIgnores do ESLint, fora de todo
// tsconfig (tsconfig.app.json só inclui src/) e não tinha teste: um erro de
// sintaxe só aparecia no PC de quem baixou o instalador.

const RAIZ = path.resolve(__dirname, '..')
const SHELL_REAL = path.join(RAIZ, 'installer-shell')
const PORTAO = path.join(RAIZ, 'build', 'check-installer-shell.cjs')
const BUILD = path.join(RAIZ, 'build', 'build-custom-installer.cjs')

// Cada teste dispara processos node (node --check por arquivo): folga
// explícita para não estourar os 5 s padrão sob a carga da suíte inteira.
const FOLGA = 30_000

type Resultado = { conferidos: string[]; falhas: { arquivo: string; detalhe: string }[] }

function carregarPortao(): { conferirSintaxeDoShell: (dir: string) => Resultado } {
    // Carregado sob demanda: sem o módulo (antes do D150) cada teste falha
    // sozinho, com a mensagem do require, em vez de derrubar o arquivo todo.
    return createRequire(import.meta.url)(PORTAO)
}

let tmp: string

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-d150-'))
})

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function montarShell(dir: string, arquivos: Record<string, string>) {
    for (const [nome, conteudo] of Object.entries(arquivos)) {
        const destino = path.join(dir, ...nome.split('/'))
        fs.mkdirSync(path.dirname(destino), { recursive: true })
        fs.writeFileSync(destino, conteudo)
    }
}

const SHELL_OK = {
    'package.json': JSON.stringify({ name: 'shell', version: '1.0.0', main: 'main.cjs' }),
    'main.cjs': "'use strict';\nconst x = 1;\nmodule.exports = x;\n",
    'preload.cjs': "'use strict';\n",
    'renderer/app.js': "'use strict';\nconst $ = (id) => document.getElementById(id);\n",
}

describe('portão de sintaxe do installer-shell (D150)', () => {
    it('o installer-shell de verdade passa, e os três scripts do exe são conferidos', () => {
        const { conferidos, falhas } = carregarPortao().conferirSintaxeDoShell(SHELL_REAL)
        expect(falhas).toEqual([])
        // Também garante que nenhum dos três sumiu ou mudou de nome sem o
        // portão perceber (o renderer/index.html carrega renderer/app.js).
        expect(conferidos).toEqual(expect.arrayContaining(['main.cjs', 'preload.cjs', 'renderer/app.js']))
    }, FOLGA)

    it('reprova o renderer com erro de sintaxe, apontando o arquivo e o SyntaxError', () => {
        montarShell(tmp, { ...SHELL_OK, 'renderer/app.js': "'use strict';\nconst passo = ;\n" })
        const { falhas } = carregarPortao().conferirSintaxeDoShell(tmp)
        expect(falhas.map((f) => f.arquivo)).toEqual(['renderer/app.js'])
        expect(falhas[0].detalhe).toMatch(/SyntaxError/)
    }, FOLGA)

    it('reprova o main.cjs quebrado e pega script novo sem lista para atualizar', () => {
        montarShell(tmp, {
            ...SHELL_OK,
            'main.cjs': "'use strict';\nfunction abrir( {\n",
            'renderer/extra/novo.mjs': 'export const a = ;\n',
        })
        const { conferidos, falhas } = carregarPortao().conferirSintaxeDoShell(tmp)
        expect(conferidos).toContain('renderer/extra/novo.mjs')
        expect(falhas.map((f) => f.arquivo).sort()).toEqual(['main.cjs', 'renderer/extra/novo.mjs'])
    }, FOLGA)

    it('não entra em node_modules: dependência de terceiro não é código do shell', () => {
        montarShell(tmp, {
            ...SHELL_OK,
            'node_modules/pacote/index.js': 'module.exports = ;\n',
            'renderer/node_modules/outro/lib.cjs': 'function ( {\n',
        })
        const { conferidos, falhas } = carregarPortao().conferirSintaxeDoShell(tmp)
        expect(falhas).toEqual([])
        expect(conferidos.sort()).toEqual(['main.cjs', 'preload.cjs', 'renderer/app.js'])
    }, FOLGA)
})

// Réplica mínima da raiz do repo: o script resolve tudo a partir de build/..
// — package.json, installer-shell/ e release/ — e roda com o PATH apontando
// para uma pasta vazia: o `npx electron-builder` do passo 3 falha na hora em
// vez de ir à rede (no Windows o cmd não acha o npx; no Linux, ENOENT).
function rodarBuildNaReplica(renderer: string) {
    const versao = '9.9.9'
    fs.mkdirSync(path.join(tmp, 'build'))
    fs.copyFileSync(BUILD, path.join(tmp, 'build', 'build-custom-installer.cjs'))
    if (fs.existsSync(PORTAO)) fs.copyFileSync(PORTAO, path.join(tmp, 'build', 'check-installer-shell.cjs'))
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'raiz', version: versao }))
    montarShell(path.join(tmp, 'installer-shell'), { ...SHELL_OK, 'renderer/app.js': renderer })
    // Setup NSIS "pronto": sem ele o script dispararia o build inteiro do app.
    montarShell(path.join(tmp, 'release'), { [`NeoStream-IPTV-Setup-${versao}.exe`]: 'MZ' })

    const vazio = path.join(tmp, 'sem-path')
    fs.mkdirSync(vazio)
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) {
        if (k.toLowerCase() !== 'path') env[k] = v
    }
    env.PATH = vazio

    const r = spawnSync(process.execPath, [path.join(tmp, 'build', 'build-custom-installer.cjs')], {
        cwd: tmp,
        env,
        encoding: 'utf8',
        timeout: 60_000,
    })
    return {
        status: r.status,
        saida: `${r.stdout}\n${r.stderr}`,
        payloadNoShell: fs.existsSync(path.join(tmp, 'installer-shell', 'payload.exe')),
        versaoDoShell: JSON.parse(fs.readFileSync(path.join(tmp, 'installer-shell', 'package.json'), 'utf8')).version,
    }
}

describe('build-custom-installer.cjs roda o portão antes de tudo (D150)', () => {
    it('com o renderer quebrado, o build para ANTES de colocar o payload no shell e diz qual arquivo', () => {
        const r = rodarBuildNaReplica('const passo = ;\n')
        expect(r.status).not.toBe(0)
        // "- <arquivo>:" é a linha da lista do portão (o stderr do node --check
        // traz o caminho completo, que no Linux também casaria com renderer/app.js).
        expect(r.saida).toMatch(/- renderer\/app\.js:/)
        // O payload nem chegou a ser copiado, e o package.json do shell não
        // foi reescrito com a versão: o portão veio antes de mexer em qualquer coisa.
        expect(r.payloadNoShell).toBe(false)
        expect(r.versaoDoShell).toBe('1.0.0')
    }, 90_000)

    it('com o shell são, o portão deixa o build seguir (e diz o que conferiu)', () => {
        const r = rodarBuildNaReplica(SHELL_OK['renderer/app.js'])
        expect(r.saida).toMatch(/sintaxe OK: .*main\.cjs/)
        expect(r.saida).toMatch(/sintaxe OK: .*renderer\/app\.js/)
        // Passou do portão: o payload foi posto no shell e a versão sincronizada.
        // (Depois o `npx` sem PATH falha — o que não interessa aqui.)
        expect(r.payloadNoShell).toBe(true)
        expect(r.versaoDoShell).toBe('9.9.9')
    }, 90_000)
})
