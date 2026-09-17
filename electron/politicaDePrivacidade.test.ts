import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔒 A política de privacidade não pode prometer cifra que o app não tem.
 *
 * A tela "Política de Privacidade" dizia que as credenciais de IPTV ficam
 * "criptografadas". Não ficam: o `electron/store.ts` instancia o
 * electron-store sem `encryptionKey`, ninguém no repositório usa `safeStorage`,
 * e o `playlistManager` grava a `password` em texto claro no `config.json`. O
 * próprio SECURITY.md declara o contrário da tela — *"Credenciais gravadas sem
 * criptografia própria (…) é uma limitação conhecida, não um bug"*.
 *
 * Teste estrutural no estilo do `windowChromeOwner.test.ts`: mora em
 * `electron/` porque varre o renderer com `node:fs`, e o tsconfig de `src/`
 * não tem os tipos do Node.
 *
 * Ele amarra DUAS fontes independentes — a afirmação na tela e o mecanismo no
 * main — e só reprova a combinação mentirosa. Fica verde nos dois mundos
 * coerentes: texto honesto sem cifra (hoje), e texto "criptografadas" no dia
 * em que o main de fato cifrar.
 */
const ROOT = path.join(__dirname, '..')
const TELA = path.join(ROOT, 'src', 'pages', 'settings', 'AboutSection.tsx')

/** Onde a credencial nasce, é gravada e é espelhada no main. */
const ARQUIVOS_DO_MAIN = ['store.ts', 'playlistsModel.ts', 'playlistManager.ts']

/** Único jeito de cifrar credencial no Electron sem lib nova: um destes dois. */
const MECANISMO_DE_CIFRA = /encryptionKey|safeStorage/

/** "criptografada/o/as/os" — a forma que AFIRMA cifra. "criptografia" não entra. */
const AFIRMA_CIFRA = /criptografad/i
/** …salvo quando a frase nega ("sem criptografia própria" é honesto). */
const NEGA = /\b(sem|não|nao)\b/i

function cifraLigadaNoMain(): boolean {
    return ARQUIVOS_DO_MAIN.some(nome =>
        MECANISMO_DE_CIFRA.test(fs.readFileSync(path.join(ROOT, 'electron', nome), 'utf-8')),
    )
}

describe('política de privacidade: a tela não promete cifra que o main não faz', () => {
    const fonte = fs.readFileSync(TELA, 'utf-8')
    const linhas = fonte.split('\n')

    it('acha o bloco da política e o item das credenciais (guarda contra varredura vazia)', () => {
        expect(fonte).toContain('Política de Privacidade')
        expect(fonte).toContain('1. Dados que Coletamos')
        expect(linhas.filter(l => /credenci/i.test(l)).length).toBeGreaterThan(0)
    })

    it('nenhuma linha sobre credencial afirma criptografia enquanto o main não cifrar', () => {
        if (cifraLigadaNoMain()) return
        const mentirosas = linhas.filter(
            l => /credenci|senha/i.test(l) && AFIRMA_CIFRA.test(l) && !NEGA.test(l),
        )
        expect(mentirosas).toEqual([])
    })
})
