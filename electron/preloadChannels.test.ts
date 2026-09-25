import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔒 Guarda das whitelists do preload.
 *
 * O preload bloqueia qualquer canal fora das listas (`Blocked IPC channel`) —
 * e o throw acontece no ponto da chamada. Quando o canal esquecido é usado
 * num caminho quente (o `web-remote:progress` do #319 rodava dentro do
 * onTimeUpdate do <video>), o erro derruba a REPRODUÇÃO inteira.
 *
 * Este teste varre o renderer e cobra que todo canal usado esteja declarado.
 */

const ROOT = path.join(__dirname, '..')
const PRELOAD = path.join(ROOT, 'electron', 'preload.ts')

/** Nomes literais de uma lista `const <nome> = new Set([...])` do preload. */
function whitelist(source: string, listName: string): Set<string> {
    const match = new RegExp(`const ${listName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source)
    if (!match) throw new Error(`lista ${listName} não encontrada no preload`)
    return new Set([...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]))
}

/** Todos os .ts/.tsx do renderer (src/), menos os próprios testes. */
function rendererFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) rendererFiles(full, out)
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
}

/** Canais literais usados num método do ipcRenderer (ignora variáveis). */
function usedChannels(files: string[], method: 'send' | 'invoke' | 'on' | 'off'): Map<string, string> {
    const found = new Map<string, string>()
    // `\??\.` cobre `ipcRenderer?.send(...)`: o optional chaining é comum nos
    // serviços (que rodam também sob jsdom) e o padrão antigo, só com ponto,
    // deixava esses canais invisíveis pro guarda — foi assim que
    // `dvr:schedules-changed` e `app:accent` ficaram fora da whitelist com o
    // teste verde.
    const pattern = new RegExp(`ipcRenderer\\??\\.${method}\\(\\s*'([^']+)'`, 'g')
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf-8')
        for (const match of source.matchAll(pattern)) {
            if (!found.has(match[1])) found.set(match[1], path.relative(ROOT, file))
        }
    }
    return found
}

describe('whitelists do preload cobrem tudo que o renderer usa', () => {
    const preload = fs.readFileSync(PRELOAD, 'utf-8')
    const files = rendererFiles(path.join(ROOT, 'src'))
    const dynamicSend = [/^pip:nextEpisodeResponse:\d+$/]

    it('todo ipcRenderer.send(...) está em sendChannels', () => {
        const allowed = whitelist(preload, 'sendChannels')
        const missing = [...usedChannels(files, 'send')]
            .filter(([channel]) => !allowed.has(channel) && !dynamicSend.some(re => re.test(channel)))
            .map(([channel, file]) => `${channel} (${file})`)
        expect(missing).toEqual([])
    })

    it('todo ipcRenderer.invoke(...) está em invokeChannels', () => {
        const allowed = whitelist(preload, 'invokeChannels')
        const missing = [...usedChannels(files, 'invoke')]
            .filter(([channel]) => !allowed.has(channel))
            .map(([channel, file]) => `${channel} (${file})`)
        expect(missing).toEqual([])
    })

    it('todo ipcRenderer.on/off(...) está em receiveChannels', () => {
        const allowed = whitelist(preload, 'receiveChannels')
        const used = new Map([...usedChannels(files, 'on'), ...usedChannels(files, 'off')])
        const missing = [...used]
            .filter(([channel]) => !allowed.has(channel))
            .map(([channel, file]) => `${channel} (${file})`)
        expect(missing).toEqual([])
    })

    it('o canal do espelho de progresso (regressão do #319) está liberado', () => {
        expect(whitelist(preload, 'sendChannels').has('web-remote:progress')).toBe(true)
    })
})

/**
 * 🔒 O sentido INVERSO: canal declarado que ninguém usa.
 *
 * A whitelist só protege enquanto for a lista do que o app precisa. Cada canal
 * a mais é superfície aberta ao renderer de graça — foi assim que o `fetch-url`
 * ficou lá: uma ponte de fetch arbitrário, com o agente HTTPS do provedor, que
 * ainda registrava a URL respondida como "provedor aprovado", e que nenhuma
 * tela chamava.
 *
 * O guarda de cima (usado-mas-não-declarado) nunca ia apontar isso: para ele,
 * quanto mais canal declarado, melhor.
 */
describe('whitelists do preload não acumulam canal morto', () => {
    const preload = fs.readFileSync(PRELOAD, 'utf-8')

    /** Renderer + e2e: um canal pode ser exercitado só pelo teste de ponta. */
    function consumidorTextos(): string {
        const arquivos = rendererFiles(path.join(ROOT, 'src'))
        const e2eDir = path.join(ROOT, 'e2e')
        if (fs.existsSync(e2eDir)) arquivos.push(...rendererFiles(e2eDir))
        return arquivos.map(f => fs.readFileSync(f, 'utf-8')).join('\n')
    }

    /**
     * Canais que ficam declarados mesmo sem consumidor literal. Cada um precisa
     * de um motivo — a lista existe para a exceção ser deliberada, não para
     * virar depósito.
     */
    const COM_MOTIVO = new Map<string, string>([
        // Montado por número de episódio: `pip:nextEpisodeResponse:${id}`.
        // A forma dinâmica já está declarada em dynamicSendChannels.
    ])

    it.each(['invokeChannels', 'sendChannels', 'receiveChannels'])(
        'todo canal de %s tem consumidor', (lista) => {
            const texto = consumidorTextos()
            const mortos = [...whitelist(preload, lista)].filter(canal =>
                !COM_MOTIVO.has(canal)
                && !texto.includes(`'${canal}'`)
                && !texto.includes(`"${canal}"`)
                && !texto.includes(`\`${canal}\``))
            expect(mortos).toEqual([])
        })
})

/**
 * 🔒 O TERCEIRO sentido: handler registrado no main sem porta no preload.
 *
 * Os dois guardas de cima cruzam a whitelist com o RENDERER; nenhum olha o
 * main. Um `ipcMain.handle('x')` cujo canal não está em `invokeChannels` é
 * inalcançável (o preload recusa com `Blocked IPC channel`) e passava pelos
 * dois de olho fechado — foi assim que o `download:get-files` (#D067), os
 * dois de EPG (#D038), o `ping`, o `timeshift:status` e o `pip:getState` /
 * `pip:getClickThrough` sobreviveram sem nenhuma tela conseguir chamá-los.
 *
 * Mesmo cuidado do `usedChannels`: o nome pode vir entre aspas simples,
 * duplas ou crase, e `ipcMain?.handle` também conta — padrão estreito foi o
 * que deixou o `dvr:schedules-changed` invisível.
 */
describe('todo handler do main tem porta no preload', () => {
    const preload = fs.readFileSync(PRELOAD, 'utf-8')

    /** Todos os .ts do main (electron/), menos os testes. */
    function arquivosDoMain(dir: string, out: string[] = []): string[] {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) arquivosDoMain(full, out)
            else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full)
        }
        return out
    }

    /** `canal -> arquivo:linha` de cada registro literal de um tipo de ouvinte do main. */
    function registrados(metodos: string): Map<string, string> {
        const achados = new Map<string, string>()
        const padrao = new RegExp(`ipcMain\\??\\.(?:${metodos})\\(\\s*(['"\`])([^'"\`]+)\\1`, 'g')
        for (const arquivo of arquivosDoMain(path.join(ROOT, 'electron'))) {
            const fonte = fs.readFileSync(arquivo, 'utf-8')
            for (const achado of fonte.matchAll(padrao)) {
                const linha = fonte.slice(0, achado.index).split('\n').length
                if (!achados.has(achado[2])) achados.set(achado[2], `${path.relative(ROOT, arquivo)}:${linha}`)
            }
        }
        return achados
    }

    /**
     * Handlers que ficam registrados SEM porta no preload. Cada um precisa de
     * um motivo escrito — mesma regra do `COM_MOTIVO` de cima: a exceção é
     * deliberada, não depósito. Vazia hoje.
     */
    const SEM_PONTE = new Map<string, string>([
        // ['canal:exemplo', 'por que o main registra sem o renderer alcançar'],
    ])

    it('a varredura enxerga os handlers do main (sanidade do padrão)', () => {
        const handlers = registrados('handle|handleOnce')
        // Um de cada arquivo grande: se o padrão quebrar, este teste grita
        // antes de o guarda de baixo passar verde por não achar nada.
        expect(handlers.has('pip:close-and-get')).toBe(true)
        expect(handlers.has('timeshift:start')).toBe(true)
        expect(handlers.has('download:get-storage-info')).toBe(true)
        expect(handlers.size).toBeGreaterThan(100)
        expect(registrados('on|once').has('pip:state')).toBe(true)
    })

    it('todo ipcMain.handle/handleOnce(...) está em invokeChannels', () => {
        const permitidos = whitelist(preload, 'invokeChannels')
        const inalcancaveis = [...registrados('handle|handleOnce')]
            .filter(([canal]) => !permitidos.has(canal) && !SEM_PONTE.has(canal))
            .map(([canal, onde]) => `${canal} (${onde})`)
        expect(inalcancaveis).toEqual([])
    })

    it('todo ipcMain.on/once(...) literal está em sendChannels', () => {
        const permitidos = whitelist(preload, 'sendChannels')
        const surdos = [...registrados('on|once')]
            .filter(([canal]) => !permitidos.has(canal) && !SEM_PONTE.has(canal))
            .map(([canal, onde]) => `${canal} (${onde})`)
        expect(surdos).toEqual([])
    })

    it('nenhum ipcMain.handle(...) registra canal de nome montado (o guarda ficaria cego)', () => {
        const montados: string[] = []
        for (const arquivo of arquivosDoMain(path.join(ROOT, 'electron'))) {
            const fonte = fs.readFileSync(arquivo, 'utf-8')
            for (const achado of fonte.matchAll(/ipcMain\??\.(?:handle|handleOnce)\(\s*([^\s,)]+)/g)) {
                const arg = achado[1]
                if (!/^['"`]/.test(arg) || arg.includes('${')) {
                    montados.push(`${path.relative(ROOT, arquivo)}: ${arg}`)
                }
            }
        }
        expect(montados).toEqual([])
    })

    it('toda exceção do SEM_PONTE ainda é um handler registrado e sem porta', () => {
        const handlers = registrados('handle|handleOnce|on|once')
        const permitidos = new Set([
            ...whitelist(preload, 'invokeChannels'),
            ...whitelist(preload, 'sendChannels'),
        ])
        const vencidas = [...SEM_PONTE.keys()]
            .filter(canal => !handlers.has(canal) || permitidos.has(canal))
        expect(vencidas).toEqual([])
    })
})
