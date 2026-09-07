import { describe, it, expect, vi } from 'vitest'
import {
    ERRO_ARQUIVO_SUMIDO,
    ERRO_LISTA_INVALIDA,
    ERRO_LISTA_VAZIA,
    lerCanaisM3uDoDisco,
    type LeitorDeArquivo,
} from './m3uDiskSource'
import { M3U_MAX_BYTES } from './httpLimits'

const LISTA = '#EXTM3U\n#EXTINF:-1 tvg-id="globo" group-title="Abertos",Globo São Paulo\nhttp://p.tv/1.ts\n'

function leitor(conteudo: string | Uint8Array, tamanho?: number): LeitorDeArquivo {
    const bytes = typeof conteudo === 'string' ? new TextEncoder().encode(conteudo) : conteudo
    return {
        stat: vi.fn(async () => ({ size: tamanho ?? bytes.byteLength })),
        readFile: vi.fn(async () => bytes),
    }
}

describe('lerCanaisM3uDoDisco', () => {
    it('lê os canais de um arquivo válido', async () => {
        const canais = await lerCanaisM3uDoDisco('C:/listas/a.m3u', leitor(LISTA))
        expect(canais).toHaveLength(1)
        expect(canais[0].name).toBe('Globo São Paulo')
    })

    // Sem o stat antes do read, um arquivo de vários GB entra inteiro na
    // memória do processo principal antes de qualquer checagem.
    it('recusa arquivo grande demais SEM ler o conteúdo', async () => {
        const fs = leitor(LISTA, M3U_MAX_BYTES + 1)
        await expect(lerCanaisM3uDoDisco('C:/listas/enorme.m3u', fs)).rejects.toThrow(/grande demais/)
        expect(fs.readFile).not.toHaveBeenCalled()
    })

    it('arquivo sumido vira mensagem própria, não erro de rede', async () => {
        const fs: LeitorDeArquivo = {
            stat: vi.fn(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }),
            readFile: vi.fn(async () => new Uint8Array()),
        }
        await expect(lerCanaisM3uDoDisco('C:/listas/foi.m3u', fs)).rejects.toThrow(ERRO_ARQUIVO_SUMIDO)
    })

    // `.m3u` de painel antigo costuma vir em windows-1252. Ler tudo como utf-8
    // transformaria "São Paulo" em lixo — e só em lista velha, o que passaria
    // batido num teste escrito com UTF-8.
    it('lista em windows-1252 sai com os acentos certos', async () => {
        const cp1252 = Uint8Array.from([
            ...new TextEncoder().encode('#EXTM3U\n#EXTINF:-1,Globo S'),
            0xE3, // ã
            ...new TextEncoder().encode('o Paulo\nhttp://p.tv/1.ts\n'),
        ])
        const canais = await lerCanaisM3uDoDisco('C:/listas/velha.m3u', leitor(cp1252))
        expect(canais[0].name).toBe('Globo São Paulo')
    })

    it('arquivo que não é lista cai na mesma mensagem do caminho de rede', async () => {
        await expect(lerCanaisM3uDoDisco('C:/listas/x.m3u', leitor('só um texto qualquer')))
            .rejects.toThrow(ERRO_LISTA_INVALIDA)
    })

    it('lista sem canal nenhum também', async () => {
        await expect(lerCanaisM3uDoDisco('C:/listas/vazia.m3u', leitor('#EXTM3U\n')))
            .rejects.toThrow(ERRO_LISTA_VAZIA)
    })
})
