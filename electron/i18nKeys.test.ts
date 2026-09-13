import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔤 Guarda estrutural do dicionário de i18n.
 *
 * Os três JSON têm um consumidor só (`src/services/languageService.ts`) e são
 * lidos sempre como `t(secao, chave)` — nunca iterados. Por isso nada nunca
 * cobrou os dois lados do contrato, e os dois lados apodreceram em silêncio:
 *
 * - **Chave sem consumidor**: 111 chaves órfãs acumularam (333 entradas nos
 *   três idiomas). A seção `dashboard` inteira sobreviveu a uma refatoração de
 *   rotas sem nunca ter sido lida por ninguém.
 * - **Consumidor sem chave**: pior, e invisível. Quando a chave falta, o `t()`
 *   devolve a CHAVE CRUA (com um `console.warn` que ninguém lê) — a tela
 *   mostra a palavra `title` onde devia estar um título.
 * - **Idiomas fora de sincronia**: apagar em pt e esquecer em es não quebra
 *   nada até alguém trocar de idioma.
 *
 * Por que este arquivo mora em `electron/` e não ao lado do languageService:
 * `tsconfig.app.json` compila `src/` com `"types": ["vite/client"]`, e sob esse
 * tsconfig `node:fs`/`node:path` não existem. `electron/` não é type-checado
 * por nenhum tsconfig (o vite-plugin-electron o empacota direto), que é o
 * mesmo motivo de o `preloadChannels.test.ts` — o guarda irmão, que varre o
 * renderer do mesmo jeito — viver aqui. O `vitest.config.ts` inclui os dois.
 */

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const LOCALES = path.join(SRC, 'locales', 'ui')

type Dicionario = Record<string, Record<string, string>>

const carrega = (idioma: string): Dicionario =>
    JSON.parse(fs.readFileSync(path.join(LOCALES, `${idioma}.json`), 'utf-8')) as Dicionario

const pt = carrega('pt')

/** Todo .ts/.tsx do renderer, menos os próprios testes e a pasta de dicionários. */
function arquivosDoRenderer(dir: string, saida: string[] = []): string[] {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name)
        if (entrada.isDirectory()) {
            if (entrada.name !== 'locales') arquivosDoRenderer(completo, saida)
        } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
            saida.push(completo)
        }
    }
    return saida
}

/**
 * Chaves montadas em tempo de execução — o scanner não as enxerga, e cada uma
 * precisa do mecanismo escrito aqui. Sem o comentário, a exceção vira um buraco
 * que ninguém sabe explicar (foi assim que o `dynamicSend` do
 * preloadChannels.test.ts continuou legível).
 */
const CHAVES_DINAMICAS: Record<string, RegExp[]> = {
    // AppearanceSection.tsx: t('appearance', `rail_${railKey}`) sobre
    // HOME_RAIL_KEYS (homeRailsService.ts), e t('appearance', bg.nameKey /
    // preset.nameKey) sobre as listas do themeService.ts.
    appearance: [/^rail_/, /^color[A-Z]/, /^background(Default|Amoled)$/],
    // WrappedOverlay.tsx: t('wrapped', `persona_${persona}`) (wrappedHelpers.ts).
    wrapped: [/^persona_/],
    // ApiKeysSection.tsx: `osStep${n}` e `step${n}` do passo a passo.
    apiKeys: [/^(os)?[Ss]tep\d$/],
    // ContentDetailModal.tsx e LiveTV.tsx: t('common', mobilePushMessageKey(r))
    // — o mapa de respostas do celular vive em utils/mobilePushResult.ts.
    common: [/^(sentToPhone|noPhoneConnected|phone(SentNoAck|NoAnswer|Locked|Blocked|NotFound))$/],
    // DvrNotifyBridge.tsx: wrapper de 1 argumento sobre a seção.
    notifications: [/^dvrFinished/],
    // weeklySummary.ts: wrapper de 1 argumento sobre a seção.
    stats: [/^weekly/],
}

/**
 * Pares `t('secao', ...)` achados no código, em duas leituras de propósito
 * diferente:
 *
 * - `frouxa`: TODO literal do 2º argumento conta. Serve ao caso 1 (chave
 *   órfã), onde errar para mais é seguro — no máximo deixa de acusar uma
 *   chave morta; errar para menos APAGARIA uma chave viva.
 * - `estrita`: só quando o 2º argumento é um literal sozinho. Serve ao caso 2
 *   (chave inventada), onde errar para mais acusa inocente: em
 *   `t('player', bg === 'dark' ? 'subBgDark' : 'subBgNone')` os literais
 *   `'dark'` e `'none'` são valores de COMPARAÇÃO, não chaves.
 *
 * O preço da estrita é não cobrir chave que só aparece dentro de ternário — a
 * frouxa cobre essas pelo outro lado.
 */
/**
 * Tira as linhas de comentario antes de varrer.
 *
 * Sem isto, um `t('secao','chave')` escrito num JSDoc para EXPLICAR o formato
 * conta como uso de verdade — e foi o que aconteceu: o comentario do proprio
 * `languageService.t` acusou uma chave inventada chamada `secao.chave`.
 *
 * Corta so por linha (`//`, `*`, `/*`), nunca no meio: procurar `//` dentro da
 * linha apagaria metade de toda URL `http://` que aparece em string.
 */
function semComentarios(fonte: string): string {
    return fonte
        .split('\n')
        .filter(linha => !/^\s*(\/\/|\*|\/\*)/.test(linha))
        .join('\n')
}

function chavesUsadas(): { frouxa: Map<string, Set<string>>; estrita: Map<string, Set<string>> } {
    const frouxa = new Map<string, Set<string>>()
    const estrita = new Map<string, Set<string>>()
    const chamada = /\bt\(\s*'([A-Za-z0-9_]+)'\s*,([^)]*)\)/g
    const balde = (mapa: Map<string, Set<string>>, secao: string) => {
        const alvo = mapa.get(secao) ?? new Set<string>()
        mapa.set(secao, alvo)
        return alvo
    }
    for (const arquivo of arquivosDoRenderer(SRC)) {
        const fonte = semComentarios(fs.readFileSync(arquivo, 'utf-8'))
        for (const achado of fonte.matchAll(chamada)) {
            const secao = achado[1]
            const resto = achado[2]
            const todas = balde(frouxa, secao)
            for (const literal of resto.matchAll(/'([A-Za-z0-9_]+)'/g)) todas.add(literal[1])
            const sozinho = /^\s*'([A-Za-z0-9_]+)'\s*$/.exec(resto)
            if (sozinho) balde(estrita, secao).add(sozinho[1])
        }
    }
    return { frouxa, estrita }
}

const { frouxa: usadas, estrita: usadasLiterais } = chavesUsadas()

describe('dicionário de i18n', () => {
    it('toda chave do pt.json tem consumidor', () => {
        const orfas: string[] = []
        for (const [secao, chaves] of Object.entries(pt)) {
            const vivas = usadas.get(secao) ?? new Set<string>()
            const dinamicas = CHAVES_DINAMICAS[secao] ?? []
            for (const chave of Object.keys(chaves)) {
                if (vivas.has(chave)) continue
                if (dinamicas.some(padrao => padrao.test(chave))) continue
                orfas.push(`${secao}.${chave}`)
            }
        }
        // Quando isto falhar: ou a chave morreu de verdade (apague nos TRÊS
        // idiomas), ou ela é montada em runtime e falta uma linha comentada em
        // CHAVES_DINAMICAS dizendo qual arquivo a monta.
        expect(orfas).toEqual([])
    })

    it('toda chave usada no código existe no pt.json', () => {
        const inventadas: string[] = []
        for (const [secao, chaves] of usadasLiterais) {
            for (const chave of chaves) {
                if (pt[secao]?.[chave] === undefined) inventadas.push(`${secao}.${chave}`)
            }
        }
        // Este é o lado invisível: sem a chave, o t() devolve o NOME DELA e a
        // tela mostra `title` onde devia haver um título. Só um console.warn
        // avisa, e ninguém lê console em produção.
        expect(inventadas).toEqual([])
    })

    it.each(['en', 'es'])('%s tem exatamente as chaves do pt', (idioma) => {
        const achatar = (d: Dicionario) =>
            Object.entries(d).flatMap(([secao, chaves]) => Object.keys(chaves).map(k => `${secao}.${k}`)).sort()
        expect(achatar(carrega(idioma))).toEqual(achatar(pt))
    })
})
