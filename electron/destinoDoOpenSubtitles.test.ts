import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { resolverUrlOpenSubtitles, OPENSUBTITLES_BASE_URL } from './openSubtitlesEndpoint'

/**
 * 🧱 O `opensubtitles:request` está na allowlist do preload, então qualquer
 * código do renderer pode chamá-lo — e ele montava o destino com
 * `endpoint.startsWith('http') ? endpoint : baseUrl + endpoint`.
 *
 * Quem mandasse uma URL absoluta ganhava um fetch do main com a `Api-Key` do
 * usuário (e o `Authorization: Bearer`, quando o corpo trazia `authToken`)
 * para o host que escolhesse. Nenhum chamador jamais usou esse ramo.
 *
 * Endurecimento contra renderer comprometido, a mesma classe que o #405
 * fechou ao apagar o `fetch-url` e que o `epgCacheGuard` fechou para o EPG.
 */
describe('resolverUrlOpenSubtitles', () => {
    it.each([
        'https://evil.example.com/coleta',
        'http://127.0.0.1:8974/setup',
        '//evil.example.com/coleta',
        'https://api.opensubtitles.com/api/v1/login',
    ])('nega URL absoluta: %s', (endpoint) => {
        expect(resolverUrlOpenSubtitles(endpoint)).toBeNull()
    })

    it.each([
        '/infos/user',
        '/login/../../qualquer-coisa',
        '/loginX',
        '/subtitles/../infos/user',
        '/download#/login',
        '',
        '/',
    ])('nega caminho fora da lista, inclusive travessia: %j', (endpoint) => {
        expect(resolverUrlOpenSubtitles(endpoint)).toBeNull()
    })

    it('nega o que nem string é', () => {
        expect(resolverUrlOpenSubtitles(undefined)).toBeNull()
        expect(resolverUrlOpenSubtitles(null)).toBeNull()
        expect(resolverUrlOpenSubtitles(42)).toBeNull()
        expect(resolverUrlOpenSubtitles({ toString: () => '/login' })).toBeNull()
    })

    it('aceita os três caminhos reais e preserva a query string da busca', () => {
        // Os mesmos que `subtitleService.ts` e `ApiKeysSection.tsx` mandam
        // hoje — um deles fora da lista mataria a legenda em silêncio.
        expect(resolverUrlOpenSubtitles('/login'))
            .toBe(`${OPENSUBTITLES_BASE_URL}/login`)
        expect(resolverUrlOpenSubtitles('/download'))
            .toBe(`${OPENSUBTITLES_BASE_URL}/download`)
        expect(resolverUrlOpenSubtitles('/subtitles?query=matrix&languages=pt-br'))
            .toBe(`${OPENSUBTITLES_BASE_URL}/subtitles?query=matrix&languages=pt-br`)
    })

    it('o host continua sendo o da API, seja qual for o caminho aceito', () => {
        for (const endpoint of ['/login', '/subtitles?query=a', '/download']) {
            expect(new URL(resolverUrlOpenSubtitles(endpoint) as string).host)
                .toBe('api.opensubtitles.com')
        }
    })
})

/**
 * A ponta do RENDERER. Um guarda que olha só o main passaria pelo motivo
 * errado: a lista pode ficar completa hoje e desatualizada amanhã, e o
 * compilador não liga um literal de `src/` à constante de `electron/`.
 */
describe('todo endpoint que o renderer pede é aceito pela regra do main', () => {
    const RAIZ = path.join(__dirname, '..', 'src')

    function arquivosDeFonte(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
            const alvo = path.join(dir, entrada.name)
            if (entrada.isDirectory()) return arquivosDeFonte(alvo)
            if (!/\.tsx?$/.test(entrada.name)) return []
            if (/\.(test|spec)\.tsx?$/.test(entrada.name)) return []
            return [alvo]
        })
    }

    // 1) `openSubtitlesRequest('/login', …)` — o wrapper do subtitleService.
    // 2) `invoke('opensubtitles:request', { endpoint: '/login', … })` — direto.
    const PADROES = [
        /openSubtitlesRequest\(\s*[`'"]([^`'"]+)[`'"]/g,
        /invoke\(\s*['"]opensubtitles:request['"]\s*,\s*\{\s*endpoint:\s*[`'"]([^`'"]+)[`'"]/g,
    ]

    const pedidos = new Set<string>()
    for (const arquivo of arquivosDeFonte(RAIZ)) {
        const fonte = fs.readFileSync(arquivo, 'utf-8')
        for (const padrao of PADROES) {
            for (const achado of fonte.matchAll(padrao)) {
                // `/subtitles?${searchParams.toString()}` → a interpolação não
                // é escolha de destino, só parâmetro; vira um valor qualquer.
                pedidos.add(achado[1].replace(/\$\{[^}]*\}/g, 'x=1'))
            }
        }
    }

    it('a varredura achou mesmo os pedidos do renderer', () => {
        // Trava contra regex apodrecida: sem isto, o teste abaixo passaria
        // vazio e diria "tudo aceito" sem ter lido nada.
        expect(pedidos.size).toBeGreaterThanOrEqual(3)
        for (const prefixo of ['/login', '/subtitles', '/download']) {
            expect([...pedidos].some((p) => p.startsWith(prefixo))).toBe(true)
        }
    })

    it('e a regra do main aceita todos eles', () => {
        const recusados = [...pedidos].filter((p) => resolverUrlOpenSubtitles(p) === null)
        expect(recusados).toEqual([])
    })
})

/**
 * A ponta do MAIN. A regra existir não obriga o handler a usá-la, e o
 * `ipcHandlers.ts` não pode ser importado aqui (ele puxa `electron`, `axios`,
 * `store`…, e o vitest.config.ts só admite módulos puros em `electron/`).
 * Por isso, varredura do fonte — como `epgCacheGuard.test.ts` já faz.
 *
 * Nunca `toContain` sobre este arquivo: são ~1770 linhas, e numa falha o
 * vitest despejaria o arquivo inteiro no log.
 */
describe('o main usa a regra — e o ramo antigo não voltou', () => {
    const FONTE = fs.readFileSync(path.join(__dirname, 'ipcHandlers.ts'), 'utf-8')

    it('não há mais URL absoluta escolhida pelo renderer', () => {
        expect(FONTE.includes("endpoint.startsWith('http')")).toBe(false)
        // E o host saiu de dentro do handler: quem montar a URL na mão de
        // novo teria que reintroduzir o literal aqui.
        expect(FONTE.includes("'https://api.opensubtitles.com/api/v1'")).toBe(false)
    })

    it('o handler resolve a URL pelo guarda e recusa quando ele diz não', () => {
        expect(/const url = resolverUrlOpenSubtitles\(endpoint\)\s*\r?\n\s*if \(!url\) \{/.test(FONTE)).toBe(true)
        expect(FONTE.includes("from './openSubtitlesEndpoint'")).toBe(true)
    })

    it('e a recusa acontece antes de qualquer credencial entrar em cena', () => {
        const inicioDoHandler = FONTE.indexOf("ipcMain.handle('opensubtitles:request'")
        expect(inicioDoHandler).toBeGreaterThan(-1)
        const guarda = FONTE.indexOf('resolverUrlOpenSubtitles(endpoint)', inicioDoHandler)
        const credencial = FONTE.indexOf('getOpenSubtitlesConfig()', inicioDoHandler)
        expect(guarda).toBeGreaterThan(-1)
        expect(credencial).toBeGreaterThan(guarda)
    })
})
