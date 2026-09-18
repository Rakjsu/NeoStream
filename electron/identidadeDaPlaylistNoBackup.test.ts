/**
 * D107 — a identidade da playlist tem de VIAJAR no backup.
 *
 * O id da playlist nasce local e aleatório (`createPlaylistId`) e escopa TODO
 * o estado do usuário (`${base}_${profileId}__pl_${playlistId}`). Num
 * restore/sync a mesma playlist (mesma url+username) recebe um id NOVO nesta
 * máquina: sem reescrever o sufixo das chaves, favoritos, progresso, fila e
 * "assistir depois" chegam como dados MORTOS e a tela abre vazia.
 *
 * O conserto tem QUATRO elos, e o teste guarda os quatro — quebrar qualquer
 * um deles em silêncio era exatamente o que acontecia:
 *   (1) o main EXPORTA o id e, no import, devolve {idDoArquivo -> idLocal};
 *   (2) o renderer não joga o id fora no caminho (sanitizeBackupPlaylists e os
 *       dois mapeadores `toBackupPlaylist`/`toPlaylistImport`, por onde passam
 *       os três chamadores do IPC);
 *   (3) o remap puro reescreve o sufixo das chaves (playlistIdRemap.ts);
 *   (4) o handler do IPC devolve o mapa, e as TRÊS portas o usam na ORDEM
 *       certa — antes do merge no sync, depois da escrita no restore. É o elo
 *       que o usuário enxerga, e o único que nenhum teste de unidade alcança
 *       (o main e o renderer não se falam pelo compilador): os dois últimos
 *       blocos leem fonte, como o guarda do D080 (backupPerdeTipoDaLista).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Store em memória com a mesma superfície usada pelo playlistManager
// (mesmo molde de electron/playlistManager.test.ts).
vi.mock('./store', () => {
    const data = new Map<string, unknown>()
    return {
        default: {
            get: (key: string) => data.get(key),
            set: (key: string, value: unknown) => { data.set(key, value) },
            delete: (key: string) => { data.delete(key) },
        },
    }
})
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import store from './store'
import {
    saveAndActivatePlaylist,
    listPublicPlaylists,
    removePlaylist,
    exportPlaylistsForBackup,
    importPlaylistsFromBackup,
} from './playlistManager'
import { remapPlaylistScopedKeys, remapLocalStoragePlaylistScope } from '../src/services/playlistIdRemap'
import { playlistScopedKeyFor } from '../src/services/activePlaylistService'
import {
    sanitizeBackupPlaylists,
    toBackupPlaylist,
    toPlaylistImport,
    collectBackup,
    applyBackup,
} from '../src/services/backupService'

const RAIZ = path.join(__dirname, '..')

/** Os fontes são CRLF; normalizar antes de procurar (molde do D080). */
function ler(rel: string): string {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf-8').split('\r\n').join('\n')
}

/** Zera a "máquina": store limpo, sem playlists nem ledger de removidas. */
function maquinaNova() {
    store.set('auth', {})
    store.set('playlists', [])
    store.delete('activePlaylistId')
    store.delete('removedPlaylists')
}

/** {nome -> id} das playlists desta "máquina" (independe da ordem da lista). */
function porNome(): Record<string, string> {
    return Object.fromEntries(listPublicPlaylists().map(p => [p.name, p.id] as [string, string]))
}

beforeEach(() => {
    maquinaNova()
    localStorage.clear()
})

describe('identidade da playlist viaja no backup (favoritos sobrevivem à outra máquina)', () => {
    it('o arquivo de backup carrega o id da playlist', () => {
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        const idLocal = listPublicPlaylists()[0].id

        const [exportada] = exportPlaylistsForBackup()

        expect(exportada.id).toBe(idLocal)
    })

    it('importar devolve o par {idDoArquivo -> idLocal} para cada playlist aceita', () => {
        // --- Máquina A: cria a playlist e exporta o arquivo.
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        const arquivo = exportPlaylistsForBackup()
        const idNaMaquinaA = listPublicPlaylists()[0].id

        // --- Máquina B: instalação limpa, restaura o mesmo arquivo.
        maquinaNova()
        const resultado = importPlaylistsFromBackup(arquivo)
        const idNaMaquinaB = listPublicPlaylists()[0].id

        expect(resultado.imported).toBe(1)
        expect(idNaMaquinaB).not.toBe(idNaMaquinaA) // o id nasce local e aleatório
        expect(resultado.idMap).toEqual({ [idNaMaquinaA]: idNaMaquinaB })
    })

    // 🔒 O caso do SYNC: a playlist JÁ existe aqui, então o import é RECUSADO
    // (importeBloqueado) — e é justamente ela que mais precisa do par, senão os
    // favoritos do arquivo nunca encontram o escopo daqui.
    it('playlist recusada por JÁ existir aqui ainda entra no mapa', () => {
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        const arquivo = exportPlaylistsForBackup()
        const idNaMaquinaA = listPublicPlaylists()[0].id

        maquinaNova()
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        const idNaMaquinaB = listPublicPlaylists()[0].id

        const resultado = importPlaylistsFromBackup(arquivo)

        expect(resultado.imported).toBe(0) // nada a importar: já está aqui
        expect(listPublicPlaylists()).toHaveLength(1) // e nada duplicou
        expect(resultado.idMap).toEqual({ [idNaMaquinaA]: idNaMaquinaB })
    })

    // 🔒 O portão do D080 (M3U de disco não se cadastra por payload de fora)
    // recusa o CADASTRO, não a identidade: se a lista de arquivo já foi aberta
    // AQUI pelo diálogo do sistema, os favoritos dela precisam do par do mesmo
    // jeito. Nenhuma escrita no store acontece neste ramo.
    it('M3U de disco recusada pelo portão, mas já aberta aqui, ainda entra no mapa', () => {
        saveAndActivatePlaylist({ name: 'Do disco', url: 'C:\\Listas\\minha.m3u', username: 'm3u', password: 'm3u', type: 'm3u' })
        const arquivo = exportPlaylistsForBackup()
        const idNaMaquinaA = listPublicPlaylists()[0].id

        maquinaNova()
        saveAndActivatePlaylist({ name: 'Do disco', url: 'C:\\Listas\\minha.m3u', username: 'm3u', password: 'm3u', type: 'm3u' })
        const idNaMaquinaB = listPublicPlaylists()[0].id

        const resultado = importPlaylistsFromBackup(arquivo)

        expect(resultado.imported).toBe(0) // o portão continua recusando o cadastro
        expect(listPublicPlaylists()).toHaveLength(1)
        expect(resultado.idMap).toEqual({ [idNaMaquinaA]: idNaMaquinaB })
    })

    // 🔒 Duas contas no MESMO servidor é o arranjo comum (a da casa e a do
    // filho). O par tem de casar url+username, igual ao `importeBloqueado` e ao
    // `upsertPlaylist`: procurar a local só pela url mandaria os favoritos de
    // uma conta para o escopo da OUTRA — pior que o defeito original, porque
    // aí o dado chega vivo no lugar errado, e o usuário não tem como desfazer.
    it('duas contas no mesmo servidor: cada uma ganha o par da conta certa', () => {
        saveAndActivatePlaylist({ name: 'Pai', url: 'http://a.tv', username: 'pai', password: 'p' })
        saveAndActivatePlaylist({ name: 'Filho', url: 'http://a.tv', username: 'filho', password: 'p' })
        const arquivo = exportPlaylistsForBackup()
        const naMaquinaA = porNome()

        maquinaNova()
        saveAndActivatePlaylist({ name: 'Pai', url: 'http://a.tv', username: 'pai', password: 'p' })
        saveAndActivatePlaylist({ name: 'Filho', url: 'http://a.tv', username: 'filho', password: 'p' })
        const naMaquinaB = porNome()

        const resultado = importPlaylistsFromBackup(arquivo)

        expect(resultado.imported).toBe(0) // as duas já moram aqui
        expect(resultado.idMap).toEqual({
            [naMaquinaA.Pai]: naMaquinaB.Pai,
            [naMaquinaA.Filho]: naMaquinaB.Filho,
        })
    })

    // 🔒 A apagada DE PROPÓSITO não pode voltar pela porta dos fundos: sem id
    // local, remapear o escopo dela seria ressuscitar os dados da playlist.
    it('playlist apagada de propósito (tombstone) NÃO entra no mapa', () => {
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        const arquivo = exportPlaylistsForBackup()

        maquinaNova()
        const p = saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        removePlaylist(p.id)

        const resultado = importPlaylistsFromBackup(arquivo)

        expect(resultado.imported).toBe(0)
        expect(resultado.idMap).toEqual({})
    })

    // 🔒 O saneamento da ENTRADA é o gargalo do renderer: se ele descartar o
    // `id` (era o que fazia até aqui), a identidade morre no meio do caminho e
    // o resto do conserto não adianta nada.
    it('o saneamento da entrada preserva o id, e recusa id que não é string', () => {
        expect(sanitizeBackupPlaylists([
            { id: 'pl_deLa', url: 'http://ok', username: 'u', passwordB64: 'YQ==' },
            { id: 42, url: 'http://outra', username: 'v', passwordB64: 'YQ==' },
        ])).toStrictEqual([
            { id: 'pl_deLa', name: '', url: 'http://ok', username: 'u', passwordB64: 'YQ==' },
            { name: '', url: 'http://outra', username: 'v', passwordB64: 'YQ==' },
        ])
    })

    // 🔒 Os dois mapeadores são o caminho ÚNICO dos três chamadores do IPC
    // (App.tsx, BackupSection.tsx, Welcome.tsx — guardado por
    // backupPerdeTipoDaLista.test.ts): campo esquecido aqui some nos três de
    // uma vez, e o compilador não liga o main ao renderer.
    it('os mapeadores do renderer levam o id na ida e na volta', () => {
        expect(toBackupPlaylist({ id: 'pl_daOrigem', name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' }))
            .toStrictEqual({ id: 'pl_daOrigem', name: 'Casa', url: 'http://a.tv', username: 'u', passwordB64: 'cA==' })
        expect(toPlaylistImport({ id: 'pl_daOrigem', name: 'Casa', url: 'http://a.tv', username: 'u', passwordB64: 'cA==' }))
            .toStrictEqual({ id: 'pl_daOrigem', name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })

        // Arquivo/entrada sem id não inventa a chave (backups v1/v2 antigos).
        expect(toBackupPlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' }).id).toBeUndefined()
        expect(toPlaylistImport({ name: 'Casa', url: 'http://a.tv', username: 'u', passwordB64: 'cA==' }).id).toBeUndefined()
    })

    // A travessia INTEIRA, do jeito que o app faz: main → mapeador → arquivo
    // JSON → applyBackup → mapeador → main. Qualquer elo que solte o id derruba
    // este teste, mesmo que os elos vizinhos continuem certos.
    it('main → arquivo → main: o id chega do outro lado e vira o par do mapa', () => {
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        const idNaMaquinaA = listPublicPlaylists()[0].id
        const arquivo = JSON.stringify(collectBackup(exportPlaylistsForBackup().map(toBackupPlaylist)))

        maquinaNova()
        localStorage.clear()
        const report = applyBackup(JSON.parse(arquivo))
        const { imported, idMap } = importPlaylistsFromBackup(report.playlists.map(toPlaylistImport))
        const idNaMaquinaB = listPublicPlaylists()[0].id

        expect(imported).toBe(1)
        expect(idMap).toEqual({ [idNaMaquinaA]: idNaMaquinaB })
    })

    it('favoritos e progresso da máquina A aterrissam no escopo da máquina B', () => {
        // --- Máquina A: playlist + estado escopado por ela.
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        const idA = listPublicPlaylists()[0].id
        const arquivo = exportPlaylistsForBackup()

        const chaveFavoritosA = playlistScopedKeyFor('neostream_profile', 'perfil1', idA)
        const chaveProgressoA = playlistScopedKeyFor('neostream_movie_progress', 'perfil1', idA)
        const dataDoArquivo: Record<string, string> = {
            [chaveFavoritosA]: JSON.stringify({ favorites: [{ id: '42', type: 'movie' }] }),
            [chaveProgressoA]: JSON.stringify({ '42': 1200 }),
            neostream_theme: 'dark', // chave global: não tem escopo, passa intacta
        }

        // --- Máquina B: restaura o arquivo (identidade primeiro, dados depois).
        maquinaNova()
        const { idMap } = importPlaylistsFromBackup(arquivo)
        const idB = listPublicPlaylists()[0].id

        const remapeado = remapPlaylistScopedKeys(dataDoArquivo, idMap)

        const chaveFavoritosB = playlistScopedKeyFor('neostream_profile', 'perfil1', idB)
        const chaveProgressoB = playlistScopedKeyFor('neostream_movie_progress', 'perfil1', idB)

        expect(Object.keys(remapeado).sort()).toEqual(
            [chaveFavoritosB, chaveProgressoB, 'neostream_theme'].sort()
        )
        expect(JSON.parse(remapeado[chaveFavoritosB]).favorites).toEqual([{ id: '42', type: 'movie' }])
        expect(remapeado[chaveProgressoB]).toBe(JSON.stringify({ '42': 1200 }))
        expect(remapeado[chaveFavoritosA]).toBeUndefined() // não sobra dado morto
    })

    it('playlist do arquivo que NÃO entrou aqui não ganha remapeamento (chave passa intacta)', () => {
        const orfa = playlistScopedKeyFor('neostream_profile', 'perfil1', 'pl_naoimportada')
        expect(remapPlaylistScopedKeys({ [orfa]: '{}' }, { pl_outra: 'pl_local' }))
            .toEqual({ [orfa]: '{}' })
    })

    // 🔒 Backup ANTIGO (sem id): mapa vazio, tudo passa como passava antes.
    it('arquivo sem id não mexe em nada', () => {
        const chave = playlistScopedKeyFor('neostream_profile', 'perfil1', 'pl_velho')
        expect(remapPlaylistScopedKeys({ [chave]: '{}', neostream_theme: 'dark' }, {}))
            .toEqual({ [chave]: '{}', neostream_theme: 'dark' })

        localStorage.setItem(chave, '{}')
        expect(remapLocalStoragePlaylistScope({})).toBe(0)
        expect(localStorage.getItem(chave)).toBe('{}')
    })

    it('restore: renomeia no próprio localStorage o que o applyBackup já gravou', () => {
        const antiga = playlistScopedKeyFor('neostream_profile', 'perfil1', 'pl_doArquivo')
        localStorage.setItem(antiga, JSON.stringify({ favorites: [{ id: '9' }] }))
        localStorage.setItem('neostream_theme', 'dark')

        const renomeadas = remapLocalStoragePlaylistScope({ pl_doArquivo: 'pl_daqui' })

        const nova = playlistScopedKeyFor('neostream_profile', 'perfil1', 'pl_daqui')
        expect(renomeadas).toBe(1)
        expect(localStorage.getItem(antiga)).toBeNull()
        expect(JSON.parse(localStorage.getItem(nova) ?? 'null').favorites).toEqual([{ id: '9' }])
        expect(localStorage.getItem('neostream_theme')).toBe('dark')
    })

    it('a chave reescrita vence a homônima que veio intacta (restore é autoritativo)', () => {
        const antiga = playlistScopedKeyFor('neostream_profile', 'perfil1', 'pl_A')
        const alvo = playlistScopedKeyFor('neostream_profile', 'perfil1', 'pl_B')
        const remapeado = remapPlaylistScopedKeys(
            { [alvo]: '{"favorites":[]}', [antiga]: '{"favorites":[{"id":"7"}]}' },
            { pl_A: 'pl_B' },
        )
        expect(Object.keys(remapeado)).toEqual([alvo])
        expect(JSON.parse(remapeado[alvo]).favorites).toEqual([{ id: '7' }])
    })

    // 🔒 A PONTE, antes das portas: o handler do main é o único caminho do
    // mapa até o renderer. Nenhum teste monta `ipcHandlers` e `tsc -b` não
    // enxerga electron/ (tsconfig.app só inclui src/) — tirar o `idMap` do
    // retorno deixava a suíte INTEIRA verde com as três portas recebendo
    // `undefined` e o remap virando um no-op silencioso.
    it('o handler do IPC devolve o idMap junto com o imported', () => {
        const handler = ler('electron/ipcHandlers.ts')
        const i = handler.indexOf("ipcMain.handle('backup:import-playlists'")
        expect(i).toBeGreaterThan(-1)

        const corpo = handler.slice(i, i + 600)
        expect(corpo.includes('importPlaylistsFromBackup(')).toBe(true) // estamos no bloco certo
        expect(/return\s*\{[^}]*\bidMap\b[^}]*\}/.test(corpo)).toBe(true)
    })

    // 🔒 O elo (4): as TRÊS portas do handler 'backup:import-playlists'.
    // App.tsx (sync), BackupSection.tsx (Configurações → Backup → Importar) e
    // Welcome.tsx (restaurar na instalação nova) erraram JUNTAS no D080, e o
    // compilador não as liga ao main (`tsc -b` só enxerga src/). Aqui a ordem
    // é o conserto inteiro: no sync o remap entra ANTES do merge (que funde
    // por chave), no restore DEPOIS da escrita que o applyBackup já fez no
    // localStorage. Apagar qualquer uma das três linhas deixava a suíte verde
    // com o defeito de pé — por isso este bloco lê fonte, e não comportamento.
    it('as três portas do import passam pelo remap do escopo, na ordem certa', () => {
        const fontes = (function varrer(dir: string): string[] {
            return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
                const p = path.join(dir, e.name)
                if (e.isDirectory()) return varrer(p)
                return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
            })
        })(path.join(RAIZ, 'src'))

        const ANCORA = "'backup:import-playlists'"
        const veredito: string[] = []
        let portas = 0
        for (const arquivo of fontes) {
            const fonte = fs.readFileSync(arquivo, 'utf-8').split('\r\n').join('\n')
            if (!fonte.includes(ANCORA)) continue
            portas++
            const rel = path.relative(RAIZ, arquivo).split('\\').join('/')
            const invoke = fonte.indexOf(ANCORA)
            const merge = fonte.indexOf('mergeSyncData(')

            if (merge !== -1) {
                // Porta do SYNC: o merge é por CHAVE, então a identidade tem de
                // chegar antes dele, e o dado remoto entra já remapeado. O mapa
                // tem de ser o que VEIO do import — `remapPlaylistScopedKeys(x, {})`
                // compila, não faz nada, e é o jeito silencioso de desfazer tudo.
                const chamada = /mergeSyncData\(\s*[A-Za-z_$][\w$]*\s*,\s*remapPlaylistScopedKeys\([^,]+,\s*([A-Za-z_$][\w$]*)\s*\)\s*\)/.exec(fonte)
                const mapa = chamada?.[1]
                veredito.push(`${rel} identidade-antes-do-merge: ${String(invoke < merge)}`)
                veredito.push(`${rel} merge-recebe-remap: ${String(mapa !== undefined)}`)
                veredito.push(`${rel} mapa-vem-do-import: ${String(mapa !== undefined && new RegExp(`${mapa}\\s*=[^;]*\\.idMap`).test(fonte))}`)
            } else {
                // Portas do RESTORE: o applyBackup já gravou com o id de LÁ; o
                // remap só pode rodar depois de o main devolver o id daqui.
                const remap = fonte.indexOf('remapLocalStoragePlaylistScope(')
                veredito.push(`${rel} restore-remapeia-depois-do-import: ${String(remap > invoke)}`)
            }
        }

        // Sem isto o guarda passaria de graça por não ter achado ninguém.
        expect(portas).toBeGreaterThanOrEqual(3)
        expect(veredito.filter(v => v.endsWith('false'))).toEqual([])
    })
})
