import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🪟 Instância única ANTES de qualquer setup.
 *
 * O lock ficava depois de todos os setup*(): app.quit() é assíncrono e não
 * interrompe a avaliação do módulo, e `return` solto não existe em ESM. A 2ª
 * instância subia INTEIRA — DLNA, AirPlay, Cast, WebRemote, DVR, tray — e
 * ainda criava janela. Visto no main.log real do dono em 02/09/2026: três
 * inicializações completas em 47 s, disputando a porta 8974 e o SQLite.
 *
 * Invariante por posição no fonte (imune a reformatação): o lock vem antes do
 * primeiro setup, depois do redirecionamento de userData do E2E (o lock
 * deriva do userData), e o ramo de falha encerra na hora com app.exit.
 */

const fonte = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf-8').split(String.fromCharCode(13)).join('')

describe('main.ts adquire o lock de instância única cedo', () => {
    const lock = fonte.indexOf('app.requestSingleInstanceLock()')
    const primeiroSetup = fonte.search(/^setup\w+\(\)/m)
    const e2eUserData = fonte.indexOf("import './e2eUserData'")

    it('o lock existe', () => {
        expect(lock).toBeGreaterThan(-1)
        expect(primeiroSetup).toBeGreaterThan(-1)
    })

    it('o lock vem ANTES do primeiro setup*()', () => {
        expect(lock).toBeLessThan(primeiroSetup)
    })

    it('o lock vem DEPOIS do redirecionamento de userData do E2E', () => {
        // O lock do Electron deriva do userData; o E2E redireciona por
        // execução pra specs paralelos pegarem locks distintos.
        expect(e2eUserData).toBeGreaterThan(-1)
        expect(e2eUserData).toBeLessThan(lock)
    })

    it('o ramo de falha encerra com app.exit, não app.quit', () => {
        const ramo = fonte.slice(lock, lock + 400)
        expect(ramo).toContain('app.exit(')
        expect(ramo).not.toContain('app.quit()')
    })
})
