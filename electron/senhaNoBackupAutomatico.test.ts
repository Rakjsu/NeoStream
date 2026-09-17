/**
 * 🔒 O backup que roda SOZINHO não leva credencial para a nuvem de ninguém.
 *
 * O agendador (`backup:auto-save`) gravava em disco o MESMO payload do export
 * manual: `playlists[].passwordB64`, o bloco `openSubtitles` e, dentro de
 * `data`, as chaves de API do usuário (TMDB e Trakt — esta com o par de tokens
 * OAuth). Base64 é ofuscação, não cifra; o cabeçalho do `backupService.ts` diz
 * isso com todas as letras. No export manual a troca é justa: a pessoa escolhe
 * a pasta na hora e pode cifrar o arquivo inteiro com senha (`encryptBackup`,
 * prefixo NEOENC2). No automático não existe nem uma coisa nem outra — e o
 * atalho "salvar na nuvem" (`backup:cloud-use`) aponta a pasta pro
 * OneDrive/Dropbox/Drive e LIGA o agendamento no mesmo clique.
 *
 * O teste roda o HANDLER de verdade (electron e electron-store mockados) e lê
 * o ARQUIVO que sobrou numa pasta temporária: afere o byte que o cliente do
 * OneDrive subiria, não a intenção do código. O payload não é escrito à mão —
 * vem do `collectBackup()` real, o mesmo coletor do renderer, para que uma
 * mudança de formato lá não deixe o guarda passando pelo motivo errado.
 *
 * As asserções são sobre o VALOR do segredo, nunca sobre o nome do campo: uma
 * implementação que prefira mandar a playlist sem senha em vez de omiti-la
 * continua válida.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Handler = (evento: unknown, argumento: unknown) => unknown

const state = vi.hoisted(() => ({
    data: {} as Record<string, unknown>,
    handlers: new Map<string, (evento: unknown, argumento: unknown) => unknown>(),
}))

vi.mock('electron', () => ({
    ipcMain: { handle: (canal: string, fn: Handler) => { state.handlers.set(canal, fn) } },
    app: { getPath: () => '' },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    BrowserWindow: class { },
}))
vi.mock('electron-store', () => ({
    default: class {
        get(chave: string) { return state.data[chave] }
        set(chave: string, valor: unknown) { state.data[chave] = valor }
    },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupAutoBackup } from './autoBackup'
import { collectBackup, encodePlaylistPassword } from '../src/services/backupService'

const SENHA_DO_PROVEDOR = 'MinhaSenhaDoProvedor2026'
const SENHA_OPENSUBTITLES = 'SenhaDoOpenSubtitles2026'
const CHAVE_OPENSUBTITLES = 'chave-api-opensubtitles-do-usuario'
const CHAVE_TMDB = 'chave-api-tmdb-do-usuario'
const REFRESH_TRAKT = 'refresh-token-do-trakt'

let pasta = ''

/** O payload exatamente como o renderer o monta no `backup:auto-collect`. */
function payloadDoRenderer(): string {
    localStorage.clear()
    localStorage.setItem('neostream_profiles', JSON.stringify({ profiles: [{ id: 'p1', name: 'Eu' }] }))
    localStorage.setItem('neostream_theme', 'dark')
    localStorage.setItem('neostream_tmdb_api_key', CHAVE_TMDB)
    localStorage.setItem('neostream_trakt_token', JSON.stringify({ access: 'acesso', refresh: REFRESH_TRAKT }))
    const payload = collectBackup(
        [{
            name: 'Casa',
            url: 'http://provedor.example',
            username: 'joao',
            passwordB64: encodePlaylistPassword(SENHA_DO_PROVEDOR),
        }],
        { apiKey: CHAVE_OPENSUBTITLES, username: 'joao', password: SENHA_OPENSUBTITLES },
    )
    return JSON.stringify(payload, null, 2)
}

async function salvarSozinho(json: string): Promise<{ success: boolean; path?: string }> {
    const handler = state.handlers.get('backup:auto-save')
    if (!handler) throw new Error('backup:auto-save não foi registrado')
    return await handler(null, { json }) as { success: boolean; path?: string }
}

beforeEach(() => {
    pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-backup-auto-'))
    state.handlers = new Map()
    state.data = {
        autoBackup: { enabled: true, dirPath: pasta, intervalDays: 7, lastBackupAt: 0 },
    }
    setupAutoBackup(() => null)
})

afterEach(() => {
    fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

describe('backup automático na pasta da nuvem', () => {
    it('o arquivo gravado não leva a senha do provedor, a do OpenSubtitles nem as chaves de API', async () => {
        const resultado = await salvarSozinho(payloadDoRenderer())

        expect(resultado.success).toBe(true)
        // `includes` em vez de `toContain`: quando falha, o toContain despeja o
        // arquivo de backup inteiro no log.
        const arquivo = fs.readFileSync(resultado.path as string, 'utf-8')
        expect(arquivo.includes(SENHA_DO_PROVEDOR)).toBe(false)
        expect(arquivo.includes(encodePlaylistPassword(SENHA_DO_PROVEDOR))).toBe(false)
        expect(arquivo.includes(SENHA_OPENSUBTITLES)).toBe(false)
        expect(arquivo.includes(encodePlaylistPassword(SENHA_OPENSUBTITLES))).toBe(false)
        expect(arquivo.includes(CHAVE_OPENSUBTITLES)).toBe(false)
        expect(arquivo.includes(CHAVE_TMDB)).toBe(false)
        expect(arquivo.includes(REFRESH_TRAKT)).toBe(false)
    })

    it('o resto do backup continua inteiro (senão "não vaza" seria gravar arquivo vazio)', async () => {
        const resultado = await salvarSozinho(payloadDoRenderer())

        const salvo = JSON.parse(fs.readFileSync(resultado.path as string, 'utf-8')) as {
            app?: string
            version?: number
            data?: Record<string, string>
        }
        expect(salvo.app).toBe('neostream')
        expect(salvo.version).toBe(3)
        expect(salvo.data?.neostream_theme).toBe('dark')
        expect(typeof salvo.data?.neostream_profiles).toBe('string')
    })

    it('payload que não dá pra ler não vira arquivo — nem cria a pasta na nuvem', async () => {
        // A pasta do atalho "salvar na nuvem" ainda não existe: um payload que
        // o main não entende não deve deixar rastro nenhum lá dentro.
        const destino = path.join(pasta, 'NeoStream Backups')
        state.data.autoBackup = { enabled: true, dirPath: destino, intervalDays: 7, lastBackupAt: 0 }

        for (const payload of [
            'isto não é um backup',
            // JSON VÁLIDO, mas não um backup: espalhar um array ou um número
            // num objeto não estoura — sai `{}` ou `{"0":…}`, e a pasta da
            // nuvem ganharia um arquivo de lixo com cara de backup.
            '[{"playlists": []}]',
            '42',
        ]) {
            const resultado = await salvarSozinho(payload)

            expect(resultado.success, payload).toBe(false)
            expect(fs.existsSync(destino), payload).toBe(false)
            expect(fs.readdirSync(pasta), payload).toEqual([])
        }
    })
})
