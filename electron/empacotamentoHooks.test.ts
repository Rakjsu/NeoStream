import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 📦 Hooks do electron-builder não podem depender da máquina de quem escreveu.
 *
 * O `afterPack` antigo (build/afterPack.cjs) chamava um rcedit num caminho
 * absoluto de uma instalação local (`C:\rcedit-2.0.0\...`). Em todo runner de
 * CI esse arquivo não existe, então o hook imprimia "Skipping" e voltava: nunca
 * fez nada em nenhum build publicado — e ainda sujava o log com um banner de
 * "Applying custom icon" que dava a impressão de que algo tinha sido aplicado.
 *
 * Nem fazia falta: o ícone do .exe é gravado pelo próprio electron-builder
 * (resedit, em `signApp`, que roda DEPOIS do afterPack) a partir de
 * `win.icon`. `win.signExecutable: false` desliga só a assinatura; quem
 * desliga a edição de recursos (ícone + metadados) é
 * `signAndEditExecutable: false` — esse não pode aparecer.
 */
const RAIZ = path.join(__dirname, '..')

type ConfigWin = { icon?: string; signExecutable?: boolean; signAndEditExecutable?: boolean }
type ConfigBuild = Record<string, unknown> & { win?: ConfigWin }

function lerBuild(): ConfigBuild {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf-8')) as { build: ConfigBuild }
    return pkg.build
}

/** Hooks de ciclo de vida que o electron-builder aceita como caminho de arquivo. */
const HOOKS = [
    'beforeBuild',
    'beforePack',
    'afterPack',
    'afterSign',
    'afterExtract',
    'artifactBuildStarted',
    'artifactBuildCompleted',
    'afterAllArtifactBuild',
    'onNodeModuleFile',
    'appxManifestCreated',
    'msiProjectCreated',
]

/** Caminho absoluto de Windows (`C:\...` ou `C:/...`) dentro de um literal de string. */
const CAMINHO_ABSOLUTO_DE_MAQUINA = /['"`][A-Za-z]:[\\/]/

describe('package.json: hooks de empacotamento', () => {
    const build = lerBuild()

    it('o afterPack mudo (rcedit em caminho local) não está mais ligado ao build', () => {
        const antigo = path.join(RAIZ, 'build', 'afterPack.cjs')
        expect(fs.existsSync(antigo)).toBe(false)
        for (const nome of HOOKS) {
            const valor = build[nome]
            if (typeof valor !== 'string') continue
            expect(path.join(RAIZ, valor), `${nome} -> ${valor}`).not.toBe(antigo)
        }
    })

    it('todo hook declarado existe e não aponta para ferramenta instalada numa máquina só', () => {
        for (const nome of HOOKS) {
            const valor = build[nome]
            if (typeof valor !== 'string') continue
            const arquivo = path.join(RAIZ, valor)
            expect(fs.existsSync(arquivo), `${nome} -> ${valor}`).toBe(true)
            const fonte = fs.readFileSync(arquivo, 'utf-8')
            expect(CAMINHO_ABSOLUTO_DE_MAQUINA.test(fonte), `${nome} (${valor}) tem caminho absoluto de máquina`).toBe(false)
        }
    })

    it('o ícone do .exe continua sendo gravado pelo próprio electron-builder', () => {
        const win = build.win ?? {}
        expect(typeof win.icon).toBe('string')
        expect(fs.existsSync(path.join(RAIZ, win.icon as string))).toBe(true)
        // Desligar só a assinatura (signExecutable: false) mantém o resedit;
        // signAndEditExecutable: false desligaria também o ícone e os metadados.
        expect(win.signAndEditExecutable).not.toBe(false)
    })
})
