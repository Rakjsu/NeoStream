import { describe, it, expect } from 'vitest'
import { urlDeArquivoLocal } from './urlDeArquivoLocal'

/**
 * Strings puras de propósito: a suíte roda no Windows (máquina do dono) e no
 * ubuntu-latest (CI), e cada caso aqui vale igual nos dois — nada passa por
 * `path` nem pelo disco. A ida e volta com a guarda do mpv está em
 * electron/mpvTocaArquivoDoDisco.test.ts.
 */
describe('urlDeArquivoLocal', () => {
    it('Windows: três barras antes da letra da unidade, `\\` vira `/`', () => {
        expect(urlDeArquivoLocal('C:\\Users\\rak\\Videos\\a.ts')).toBe('file:///C:/Users/rak/Videos/a.ts')
        expect(urlDeArquivoLocal('D:/NeoStream/downloads/b.mp4')).toBe('file:///D:/NeoStream/downloads/b.mp4')
    })

    it('POSIX: o `/` da raiz é a terceira barra — nunca quatro', () => {
        expect(urlDeArquivoLocal('/home/rak/Vídeos/a.ts')).toBe('file:///home/rak/Vídeos/a.ts')
        expect(urlDeArquivoLocal('/home/rak/Vídeos/a.ts').startsWith('file:////')).toBe(false)
    })

    it('POSIX: `\\` é caractere de nome, não separador', () => {
        expect(urlDeArquivoLocal('/home/rak/a\\b.ts')).toBe('file:///home/rak/a\\b.ts')
    })

    it('não codifica espaço, acento nem `%` — a guarda do mpv não decodifica', () => {
        expect(urlDeArquivoLocal('C:\\Gravações\\Canal 5 50%.ts')).toBe('file:///C:/Gravações/Canal 5 50%.ts')
        expect(urlDeArquivoLocal('/srv/Gravações/Canal 5 50%.ts')).toBe('file:///srv/Gravações/Canal 5 50%.ts')
    })
})
