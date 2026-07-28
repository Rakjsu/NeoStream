import { describe, it, expect } from 'vitest'
import {
    appendTransferEntry,
    episodeMetaFromTitle,
    MAX_PENDING_TRANSFERS,
    MAX_TRANSFER_BYTES,
    parseTransferManifest,
    parseTransferQuery,
    removeTransferEntries,
    sanitizeTransferName,
    transferEntryId,
    transferSizeVerdict,
    TRANSFER_DISK_HEADROOM_BYTES,
    uniqueTransferName,
    type ReceivedTransfer,
} from './transferReceiver'

describe('transferReceiver (item 12 — download do celular pro PC)', () => {
    it('sanitizeTransferName derruba caminho e caracteres proibidos', () => {
        expect(sanitizeTransferName('../../evil/passwd.mp4')).toBe('passwd.mp4')
        expect(sanitizeTransferName('C:\\Users\\x\\filme.mp4')).toBe('filme.mp4')
        expect(sanitizeTransferName('a<b>c:d.mp4')).toBe('a_b_c_d.mp4')
        expect(sanitizeTransferName('nome.mp4...')).toBe('nome.mp4')
    })

    it('parseTransferQuery aceita a query completa', () => {
        const parsed = parseTransferQuery('/transfer?pin=1234&kind=movie&name=Filme%20X.mp4&title=Filme%20X')
        expect(parsed).toEqual({
            pin: '1234', kind: 'movie', name: 'Filme X.mp4', title: 'Filme X',
            sourceId: '', seriesName: '', season: 0, episode: 0,
        })
    })

    it('título ausente cai pro nome sem extensão', () => {
        const parsed = parseTransferQuery('/transfer?pin=1&kind=episode&name=Ep1.mkv')
        expect(parsed?.title).toBe('Ep1')
        expect(parsed?.kind).toBe('episode')
    })

    it('rejeita kind desconhecido, nome vazio e nome sem extensão', () => {
        expect(parseTransferQuery('/transfer?pin=1&kind=live&name=a.mp4')).toBeNull()
        expect(parseTransferQuery('/transfer?pin=1&kind=movie&name=')).toBeNull()
        expect(parseTransferQuery('/transfer?pin=1&kind=movie&name=semextensao')).toBeNull()
    })

    it('path traversal no nome vira só o basename', () => {
        const parsed = parseTransferQuery('/transfer?pin=1&kind=movie&name=..%2F..%2Fetc%2Fx.mp4')
        expect(parsed?.name).toBe('x.mp4')
    })

    // 🛡️ Endurecimento do saneamento (mesma função do traversal).
    it('nome com caractere de controle, NUL ou espaço no fim não escapa', () => {
        expect(sanitizeTransferName('fi\u0000l\u001fme.mp4')).toBe('filme.mp4')
        // Windows descarta espaço/ponto finais ao abrir: "x.mp4 " e "x.mp4"
        // apontariam pro MESMO arquivo apesar de nomes "diferentes".
        expect(sanitizeTransferName('filme.mp4 ')).toBe('filme.mp4')
        expect(sanitizeTransferName('filme.mp4 . . ')).toBe('filme.mp4')
    })

    it('nome de device do Windows é desarmado (CON.mp4 escreveria no console)', () => {
        expect(sanitizeTransferName('CON.mp4')).toBe('_CON.mp4')
        expect(sanitizeTransferName('lpt1.mkv')).toBe('_lpt1.mkv')
        expect(sanitizeTransferName('console.mp4')).toBe('console.mp4')
    })

    // 📺 Episódio sumia da página de Downloads do PC: a grade esconde
    // type==='episode' e o agrupamento exige seriesName.
    it('episódio traz série/temporada/episódio da query', () => {
        const parsed = parseTransferQuery(
            '/transfer?pin=1&kind=episode&name=Ep.mkv&title=Dark%20%C2%B7%20T1E3&seriesName=Dark&season=1&episode=3',
        )
        expect(parsed).toMatchObject({ seriesName: 'Dark', season: 1, episode: 3 })
    })

    it('sem os campos novos, o título "Série · T1E3" do app antigo é o resgate', () => {
        const parsed = parseTransferQuery('/transfer?pin=1&kind=episode&name=Ep.mkv&title=Dark%20%C2%B7%20T1E3')
        expect(parsed).toMatchObject({ seriesName: 'Dark', season: 1, episode: 3 })
    })

    it('filme nunca ganha seriesName (senão vira grupo de série no PC)', () => {
        const parsed = parseTransferQuery('/transfer?pin=1&kind=movie&name=A.mp4&title=Filme%20%C2%B7%20S01E02')
        expect(parsed).toMatchObject({ seriesName: '', season: 0, episode: 0 })
    })

    it('episodeMetaFromTitle entende T1E2 e S01E02', () => {
        expect(episodeMetaFromTitle('Dark · S01E03 — Passado')).toMatchObject({ seriesName: 'Dark', season: 1, episode: 3 })
        expect(episodeMetaFromTitle('Loki · T2E5')).toMatchObject({ seriesName: 'Loki', season: 2, episode: 5 })
        expect(episodeMetaFromTitle('Só um título')).toMatchObject({ seriesName: 'Só um título', season: 0, episode: 0 })
    })

    it('id do item vem na query quando o app manda', () => {
        const parsed = parseTransferQuery('/transfer?pin=1&kind=movie&name=A.mp4&id=movie%3A55')
        expect(parsed?.sourceId).toBe('movie:55')
    })
})

describe('uniqueTransferName (reenvio não pode sobrescrever outra entrada)', () => {
    it('nome livre passa direto', () => {
        expect(uniqueTransferName('Avatar.mp4', () => false)).toBe('Avatar.mp4')
    })

    it('nome ocupado ganha sufixo em vez de truncar o arquivo existente', () => {
        const taken = new Set(['Avatar.mp4', 'Avatar (2).mp4'])
        expect(uniqueTransferName('Avatar.mp4', c => taken.has(c))).toBe('Avatar (3).mp4')
    })

    it('nome sem extensão também ganha sufixo', () => {
        const taken = new Set(['arquivo'])
        expect(uniqueTransferName('arquivo', c => taken.has(c))).toBe('arquivo (2)')
    })
})

describe('transferSizeVerdict (corpo ilimitado enchia o disco)', () => {
    const GB = 1024 ** 3

    it('sem Content-Length segue o fluxo antigo', () => {
        expect(transferSizeVerdict(null, 1 * GB)).toBe('ok')
        expect(transferSizeVerdict('', 1 * GB)).toBe('ok')
    })

    it('cabe no disco → ok', () => {
        expect(transferSizeVerdict(String(2 * GB), 10 * GB)).toBe('ok')
    })

    it('maior que o espaço livre → no-space (507)', () => {
        expect(transferSizeVerdict(String(20 * GB), 5 * GB)).toBe('no-space')
    })

    it('folga mínima do disco também barra', () => {
        const free = 4 * GB
        expect(transferSizeVerdict(String(free - TRANSFER_DISK_HEADROOM_BYTES + 1), free)).toBe('no-space')
    })

    it('acima do teto absoluto → too-large (413)', () => {
        expect(transferSizeVerdict(String(MAX_TRANSFER_BYTES + 1), null)).toBe('too-large')
    })

    it('Content-Length inválido → invalid (400)', () => {
        expect(transferSizeVerdict('abc', 10 * GB)).toBe('invalid')
        expect(transferSizeVerdict('-1', 10 * GB)).toBe('invalid')
    })

    it('espaço livre desconhecido não bloqueia envio dentro do teto', () => {
        expect(transferSizeVerdict(String(2 * GB), null)).toBe('ok')
    })
})

describe('manifest de recebidos (200 antes de registrar deixava arquivo órfão)', () => {
    const entry = (id: string, filePath: string): ReceivedTransfer => ({
        id, kind: 'movie', title: 'X', seriesName: '', season: 0, episode: 0,
        filePath, size: 10, receivedAt: 1,
    })

    it('id é estável por arquivo — registrar 2× o mesmo recebimento é no-op', () => {
        expect(transferEntryId('C:\\x\\Avatar.mp4')).toBe(transferEntryId('C:\\x\\Avatar.mp4'))
        expect(transferEntryId('/a/Avatar.mp4')).not.toBe(transferEntryId('/a/Avatar (2).mp4'))
    })

    it('nomes que viram o mesmo slug não colidem (uma entrada engoliria a outra)', () => {
        expect(transferEntryId('/a/Avatar (2).mp4')).not.toBe(transferEntryId('/a/Avatar-2.mp4'))
        expect(transferEntryId('/a/x.mp4')).not.toBe(transferEntryId('/b/x.mp4'))
    })

    it('append substitui pelo id e mantém o teto de pendências', () => {
        let list = appendTransferEntry([], entry('a', '/a.mp4'))
        list = appendTransferEntry(list, entry('a', '/a.mp4'))
        expect(list).toHaveLength(1)
        for (let n = 0; n < MAX_PENDING_TRANSFERS + 10; n++) list = appendTransferEntry(list, entry(`e${n}`, `/e${n}.mp4`))
        expect(list).toHaveLength(MAX_PENDING_TRANSFERS)
    })

    it('remove só os ids confirmados pelo renderer', () => {
        const list = [entry('a', '/a.mp4'), entry('b', '/b.mp4')]
        expect(removeTransferEntries(list, ['a']).map(e => e.id)).toEqual(['b'])
    })

    it('manifest corrompido não derruba a reconciliação', () => {
        expect(parseTransferManifest('{lixo')).toEqual([])
        expect(parseTransferManifest('null')).toEqual([])
        expect(parseTransferManifest('[{"id":"","filePath":"/a"}]')).toEqual([])
    })

    it('round-trip preserva série/temporada/episódio do recebido', () => {
        const ep: ReceivedTransfer = {
            id: 'x', kind: 'episode', title: 'Dark · T1E3', seriesName: 'Dark',
            season: 1, episode: 3, filePath: '/a/ep.mkv', size: 99, receivedAt: 5,
        }
        expect(parseTransferManifest(JSON.stringify([ep]))).toEqual([ep])
    })
})
