import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { juntarPartes } from './juntarPartes'

let dir: string

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-merge-'))
})

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

function parte(nome: string, conteudo: string): string {
    const p = path.join(dir, nome)
    fs.writeFileSync(p, conteudo)
    return p
}

describe('juntarPartes', () => {
    it('concatena na ordem e apaga cada parte consumida', async () => {
        const destino = path.join(dir, 'filme.mp4')
        const partes = [parte('a.part0', 'AAA'), parte('b.part1', 'BBB'), parte('c.part2', 'CCC')]

        await juntarPartes(destino, partes)

        expect(fs.readFileSync(destino, 'utf-8')).toBe('AAABBBCCC')
        for (const p of partes) expect(fs.existsSync(p)).toBe(false)
    })

    it('parte que não existe é pulada (o download pode ter usado menos conexões)', async () => {
        const destino = path.join(dir, 'filme.mp4')
        await juntarPartes(destino, [parte('a.part0', 'AAA'), path.join(dir, 'nao-existe.part1')])
        expect(fs.readFileSync(destino, 'utf-8')).toBe('AAA')
    })

    it('lista vazia gera arquivo vazio, sem quebrar', async () => {
        const destino = path.join(dir, 'vazio.mp4')
        await juntarPartes(destino, [])
        expect(fs.readFileSync(destino, 'utf-8')).toBe('')
    })

    it('falha da ESCRITA vira rejeição — não exceção assíncrona que derruba o app', async () => {
        // Destino impossível (a pasta não existe): é o mesmo caminho por onde
        // "disco cheio" chega — um 'error' no stream de escrita. Sem o listener,
        // isso subia como uncaughtException e abria o diálogo de crash em vez
        // de virar a mensagem de erro que o handler já sabe mostrar.
        const destino = path.join(dir, 'pasta-que-nao-existe', 'filme.mp4')
        await expect(juntarPartes(destino, [parte('a.part0', 'AAA')])).rejects.toThrow()
    })

    it('depois de falhar, a parte não é apagada — o retry ainda tem o que juntar', async () => {
        const p = parte('a.part0', 'AAA')
        const destino = path.join(dir, 'pasta-que-nao-existe', 'filme.mp4')
        await expect(juntarPartes(destino, [p])).rejects.toThrow()
        expect(fs.existsSync(p)).toBe(true)
    })
})
