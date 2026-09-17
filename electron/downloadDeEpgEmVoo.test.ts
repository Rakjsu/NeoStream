/**
 * 📺 O `epg:get-cached` visto como BAIXADOR: um download por arquivo.
 *
 * A primeira abertura do Guia com lista americana pedia o MESMO XMLTV até
 * quatro vezes: `fetchIndexedChannel` dispara um `epg:get-cached` por arquivo
 * faltante, por canal (`src/services/epgService.ts`), e o guia resolve quatro
 * canais ao mesmo tempo (`MAX_CONCURRENT_EPG`, `src/pages/EpgGuide.tsx`). Com
 * os 10 arquivos do grupo `usa` são 40 downloads e 40 gravações nos MESMOS 10
 * arquivos — inclusive por cima de quem estiver lendo.
 *
 * Aqui o handler sobe de verdade (`setupIpcHandlers()`, com `electron` e
 * `node-fetch` mockados), grava numa `userData` de mentira e é chamado pelo
 * canal, exatamente como o renderer chama. O que se conta são as requisições
 * que SAÍRAM para a rede e o que sobrou no disco — nada de olhar o fonte.
 *
 * ⚠️ Os pedidos ENTRAM escalonados de propósito (`entrarEmVoo`): o handler usa
 * `await import('electron')`, e neste vitest dois `import()` do mesmo módulo
 * mockado no MESMO tick devolvem namespace pela metade para o segundo (só o
 * primeiro recebe o mock). Escalonar a entrada não enfraquece o teste — é o
 * que o IPC faz de todo jeito, um invoke de cada vez — e o que importa é que
 * os quatro ficam EM VOO ao mesmo tempo, parados no portão da rede.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Resultado = { success: boolean; data?: string; fromCache?: boolean; error?: string }

const h = vi.hoisted(() => ({
    /** O XMLTV que a rede devolve — o corpo diz de qual url veio. */
    documento: (url: string) => `<?xml version="1.0"?><tv de="${url}">${'<programme/>'.repeat(40)}</tv>`,
    handlers: new Map<string, Handler>(),
    userData: '',
    /** URLs que SAÍRAM para a rede. */
    fetches: [] as string[],
    /** Segura toda resposta até o teste abrir (a corrida é o ponto). */
    portao: null as Promise<void> | null,
    /** Corta a próxima gravação de `.xml` em N bytes e estoura EIO. */
    cortarXmlEm: null as number | null,
    /** Operações que puseram algo no DESTINO final (`.xml`/`.meta.json`). */
    noDestino: 0,
    /** A partir da N-ésima delas, o disco morre (a queda no meio do par). */
    morrerNoDestinoApos: null as number | null,
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Handler) => { h.handlers.set(canal, fn) },
        on: () => undefined,
        removeHandler: () => undefined,
    },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: {},
    screen: {},
    shell: {},
    app: { getPath: () => h.userData, getVersion: () => '0.0.0', getName: () => 'neostream' },
}))

// Store de mentira em memória: o `setupIpcHandlers` roda a migração de
// playlists na primeira linha, e ela espera `auth`/`playlists` de verdade.
vi.mock('./store', () => {
    const dados = new Map<string, unknown>([['auth', {}], ['playlists', []]])
    return {
        default: {
            get: (chave: string) => dados.get(chave),
            set: (chave: string, valor: unknown) => { dados.set(chave, valor) },
            delete: (chave: string) => { dados.delete(chave) },
        },
    }
})
vi.mock('./logger', () => ({
    default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}))
vi.mock('./mpvPlayer', () => ({ esconderMpvParaDialogo: () => undefined }))
vi.mock('./providerEpg', () => ({
    ensureProviderEpgLoaded: () => undefined,
    getProviderUtcOffsetMinutes: () => 0,
    resetProviderEpgState: () => undefined,
    setupProviderEpgHandlers: () => undefined,
}))

vi.mock('node-fetch', () => ({
    default: async (url: string) => {
        h.fetches.push(url)
        if (h.portao) await h.portao
        const corpo = h.documento(url)
        return {
            ok: true,
            status: 200,
            url,
            headers: { get: () => null },
            body: (async function* () { yield Buffer.from(corpo, 'utf-8') })(),
        }
    },
}))

// A queda no meio da gravação é o único ponto em que o `fs` de verdade não
// serve: o resto (mkdir, stat, rename, rm) é o do sistema, na pasta temporária.
vi.mock('fs/promises', async (importOriginal) => {
    const real = await importOriginal<typeof import('fs/promises')>()

    const erroDeDisco = (): NodeJS.ErrnoException => {
        const erro: NodeJS.ErrnoException = new Error('EIO: i/o error')
        erro.code = 'EIO'
        return erro
    }

    /**
     * Conta (e, quando pedido, mata) as operações que põem algo no DESTINO
     * final. É de propósito que a conta não olhe QUAL operação é: no código
     * de hoje o destino é escrito por dois `writeFile`, com a correção é
     * escrito por dois `rename` — o invariante testado ("o conteúdo entra
     * antes do carimbo") é o mesmo nos dois.
     */
    const contarDestino = (caminho: string): boolean => {
        if (!caminho.endsWith('.xml') && !caminho.endsWith('.meta.json')) return false
        h.noDestino++
        return h.morrerNoDestinoApos !== null && h.noDestino >= h.morrerNoDestinoApos
    }

    const writeFile = async (arquivo: unknown, dados: unknown, enc?: unknown) => {
        if (h.cortarXmlEm !== null && String(arquivo).includes('.xml')) {
            const corte = h.cortarXmlEm
            h.cortarXmlEm = null
            await real.writeFile(arquivo as string, String(dados).slice(0, corte), 'utf-8')
            throw erroDeDisco()
        }
        if (contarDestino(String(arquivo))) throw erroDeDisco()
        return real.writeFile(arquivo as string, dados as string, enc as undefined)
    }

    const rename = async (de: unknown, para: unknown) => {
        if (contarDestino(String(para))) throw erroDeDisco()
        return real.rename(de as string, para as string)
    }

    return { ...real, default: { ...real, writeFile, rename }, writeFile, rename }
})

function invocar(payload: unknown): Promise<Resultado> {
    const handler = h.handlers.get('epg:get-cached')
    if (!handler) throw new Error('o canal epg:get-cached não foi registrado')
    return handler(null, payload) as Promise<Resultado>
}

/**
 * Dispara um pedido e volta quando ele já andou o que tinha de andar: ou
 * bateu na rede (baixador) ou passou do mapa sem baixar (carona).
 *
 * A promessa vai EMBRULHADA de propósito: `await` numa promessa que resolve
 * para outra promessa encadeia as duas, e aí esta função só voltaria depois
 * de o pedido inteiro terminar — que é justamente o que não pode acontecer.
 */
async function entrarEmVoo(payload: unknown, limiteMs = 300): Promise<{ pedido: Promise<Resultado> }> {
    const antes = h.fetches.length
    const pedido = invocar(payload)
    const fim = Date.now() + limiteMs
    while (h.fetches.length === antes && Date.now() < fim) {
        await new Promise(resolve => { setTimeout(resolve, 5) })
    }
    return { pedido }
}

/** Abre o portão da rede; devolve o gatilho. */
function fecharPortao(): () => void {
    let abrir = (): void => undefined
    h.portao = new Promise<void>(resolve => { abrir = resolve })
    return abrir
}

const cacheDir = () => path.join(h.userData, 'epg_cache')

describe('download de EPG em voo', () => {
    beforeEach(async () => {
        h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-epg-'))
        h.fetches = []
        h.portao = null
        h.cortarXmlEm = null
        h.noDestino = 0
        h.morrerNoDestinoApos = null
        h.handlers.clear()
        vi.resetModules()
        const { setupIpcHandlers } = await import('./ipcHandlers')
        setupIpcHandlers()
    })

    afterEach(() => {
        // maxRetries: o `limpezaDeTempNosTestes` cobra, e aqui o motivo é
        // concreto — o XMLTV acabou de ser escrito e renomeado.
        fs.rmSync(h.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('quatro pedidos simultaneos do mesmo arquivo viram UM download', async () => {
        const url = 'http://exemplo.invalido/unitedstates1.xml'
        const abrir = fecharPortao()

        // Os quatro ficam EM VOO ao mesmo tempo: nenhum termina antes de o
        // último entrar, porque a rede está presa no portão.
        const pedidos: Promise<Resultado>[] = []
        for (let i = 0; i < 4; i++) {
            pedidos.push((await entrarEmVoo({ url, cacheKey: 'usa1', forceRefresh: false })).pedido)
        }
        abrir()
        const respostas = await Promise.all(pedidos)

        expect(h.fetches.length, 'o mesmo XMLTV foi baixado mais de uma vez').toBe(1)
        // Dedupe que devolvesse vazio para os caronas seria pior que o defeito.
        for (const resposta of respostas) {
            expect(resposta.success).toBe(true)
            expect(resposta.data === h.documento(url), 'um dos caronas ficou sem o documento').toBe(true)
        }

        // E a entrada em voo foi SOLTA: o pedido seguinte responde do disco.
        const depois = await invocar({ url, cacheKey: 'usa1', forceRefresh: false })
        expect(depois.fromCache, 'o pedido seguinte pegou carona numa promessa já resolvida').toBe(true)
        expect(h.fetches.length).toBe(1)
    })

    it('pedidos simultaneos com URLs diferentes nao pegam carona um no outro', async () => {
        // Mesmo cacheKey, urls diferentes: é o `user-external` quando a pessoa
        // troca a URL do XMLTV nas Configurações com o guia carregando. O
        // cache é invalidado pela url (`epgFileStatus`), então são downloads
        // DIFERENTES — deduplicar só pelo cacheKey serviria o arquivo errado.
        const urlA = 'http://exemplo.invalido/antiga.xml'
        const urlB = 'http://exemplo.invalido/nova.xml'
        const abrir = fecharPortao()

        const a = await entrarEmVoo({ url: urlA, cacheKey: 'user-external', forceRefresh: false })
        const b = await entrarEmVoo({ url: urlB, cacheKey: 'user-external', forceRefresh: false })
        abrir()
        const [ra, rb] = await Promise.all([a.pedido, b.pedido])

        expect(ra.data === h.documento(urlA), 'o pedido da 1ª URL não recebeu o documento dela').toBe(true)
        expect(rb.data === h.documento(urlB), 'o pedido da 2ª URL recebeu o documento da 1ª').toBe(true)
        expect(h.fetches.length).toBe(2)
    })

    it('gravacao que morre no meio nao deixa o cache pela metade', async () => {
        // `forceRefresh` é alcançável: `epg:get-cached` está na allowlist do
        // preload (a mesma superfície que `epgCacheGuard.test.ts` defende), e
        // é o único caminho em que o download acontece com um cache VÁLIDO no
        // disco — exatamente quando quebrar o arquivo dói.
        const url = 'http://exemplo.invalido/unitedstates1.xml'
        fs.mkdirSync(cacheDir(), { recursive: true })
        const bom = '<?xml version="1.0"?><tv><programme id="bom"/></tv>'
        fs.writeFileSync(path.join(cacheDir(), 'usa1.xml'), bom, 'utf-8')
        fs.writeFileSync(
            path.join(cacheDir(), 'usa1.meta.json'),
            JSON.stringify({ timestamp: Date.now(), url, size: bom.length }),
            'utf-8',
        )

        h.cortarXmlEm = 40
        const resposta = await invocar({ url, cacheKey: 'usa1', forceRefresh: true })

        expect(resposta.success, 'a gravação falhou e o handler mentiu que deu certo').toBe(false)
        const noDisco = fs.readFileSync(path.join(cacheDir(), 'usa1.xml'), 'utf-8')
        expect(noDisco === bom, 'o cache bom foi substituído por um XMLTV truncado').toBe(true)
        expect(
            fs.readdirSync(cacheDir()).filter(nome => nome.endsWith('.tmp')),
            'sobrou temporário na pasta de cache do EPG',
        ).toEqual([])
    })

    it('queda entre os dois arquivos rebaixa o cache, nunca carimba o velho como novo', async () => {
        // O conteúdo entra ANTES do carimbo. Se morrer entre um e outro, o
        // que sobra é guia novo com meta velho — e aí `epgFileStatus` devolve
        // `faltando`, que custa um download. Na ordem inversa sobraria meta
        // NOVO apontando para o XML velho: o app serviria a grade vencida
        // como fresca pelas próximas 24 h, sem nada no log.
        const url = 'http://exemplo.invalido/unitedstates1.xml'
        fs.mkdirSync(cacheDir(), { recursive: true })
        const velho = '<?xml version="1.0"?><tv><programme id="de-ontem"/></tv>'
        fs.writeFileSync(path.join(cacheDir(), 'usa1.xml'), velho, 'utf-8')
        fs.writeFileSync(
            path.join(cacheDir(), 'usa1.meta.json'),
            JSON.stringify({ timestamp: Date.now() - 25 * 60 * 60 * 1000, url, size: velho.length }),
            'utf-8',
        )

        // Morre na SEGUNDA coisa que toca o destino (o carimbo, se a ordem
        // estiver certa) — é a queda de energia no pior instante.
        h.morrerNoDestinoApos = 2
        await invocar({ url, cacheKey: 'usa1', forceRefresh: false })

        const programas = h.handlers.get('epg:channel-programs')
        if (!programas) throw new Error('o canal epg:channel-programs não foi registrado')
        const grade = await programas(null, {
            grupo: 'usa',
            arquivos: [{ url, cacheKey: 'usa1' }],
            channelName: 'Qualquer',
        }) as { faltando?: string[] }

        expect(
            grade.faltando ?? [],
            'o cache ficou VÁLIDO depois de uma gravação pela metade — o app vai servir o guia velho como novo',
        ).toContain('usa1')
        // E o que sobrou no lugar do guia é o documento NOVO, não o de ontem:
        // sem isto, "nunca gravar nada" também passaria no teste.
        const noDisco = fs.readFileSync(path.join(cacheDir(), 'usa1.xml'), 'utf-8')
        expect(noDisco === h.documento(url), 'o conteúdo novo não chegou ao destino antes do carimbo').toBe(true)
    })
})
