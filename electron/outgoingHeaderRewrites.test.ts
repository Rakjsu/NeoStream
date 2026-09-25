/**
 * D103 — "PC controla PC" nunca conectava: o renderer empacotado (file://)
 * abre o WebSocket com `Origin: file://`, e o guarda do outro NeoStream
 * (localRequestVerdict) recusa isso com 403. A saída é o upgrade sair SEM
 * Origin — mas pelo listener ÚNICO da sessão, porque o Electron guarda um só
 * onBeforeSendHeaders por sessão e um segundo apagaria o fix do trailer.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Session } from 'electron'
import { localRequestVerdict } from './localServerGuard'
import { EMBEDDER_ORIGIN } from './youtubeEmbedFix'
import {
    OUTGOING_HEADER_URL_FILTER,
    rewriteOutgoingHeaders,
    setupOutgoingHeaderRewrites,
    withoutOwnOrigin,
} from './outgoingHeaderRewrites'

type Headers = Record<string, string>
type Listener = (details: { url: string; requestHeaders: Headers }, callback: (response: { requestHeaders?: Headers }) => void) => void

/**
 * Sessão falsa com a MESMA semântica do Electron: registrar de novo
 * substitui o listener anterior (medido num Electron 44 real — um segundo
 * onBeforeSendHeaders fez o primeiro parar de rodar).
 */
function fakeSession() {
    let current: { urls: string[]; listener: Listener } | null = null
    let registrations = 0
    const session = {
        webRequest: {
            onBeforeSendHeaders(filter: { urls: string[] }, listener: Listener) {
                registrations += 1
                current = { urls: filter.urls, listener }
            },
        },
    } as unknown as Session
    /** Simula uma requisição de saída: devolve os cabeçalhos que vão pro fio. */
    const send = (url: string, requestHeaders: Headers): Headers => {
        if (!current) return requestHeaders
        let out: Headers = requestHeaders
        current.listener({ url, requestHeaders }, (response) => {
            out = response.requestHeaders ?? requestHeaders
        })
        return out
    }
    return { session, send, filter: () => current?.urls ?? [], registrations: () => registrations }
}

function originOf(headers: Headers): string | undefined {
    const key = Object.keys(headers).find(k => k.toLowerCase() === 'origin')
    return key === undefined ? undefined : headers[key]
}

const PEER_HOST = '192.168.0.10:8974'
const PEER_URL = `ws://${PEER_HOST}/?pin=1234`

describe('D103: o WebSocket do PC controla PC passa no guarda do outro PC', () => {
    it('renderer empacotado (Origin file://): hoje 403, com o listener passa', () => {
        const handshake = { Host: PEER_HOST, Origin: 'file://' }
        // É exatamente o que o outro NeoStream recebia: recusado.
        expect(localRequestVerdict(handshake.Host, handshake.Origin, 8974)).toBe('bad-origin')

        const { session, send } = fakeSession()
        setupOutgoingHeaderRewrites(session)
        const wire = send(PEER_URL, handshake)
        expect(originOf(wire)).toBeUndefined()
        expect(wire.Host).toBe(PEER_HOST)
        expect(localRequestVerdict(wire.Host, originOf(wire), 8974)).toBe('ok')
    })

    it('o nome do cabeçalho não importa (origin minúsculo também sai)', () => {
        const { session, send } = fakeSession()
        setupOutgoingHeaderRewrites(session)
        const wire = send(PEER_URL, { Host: PEER_HOST, origin: 'file://' })
        expect(originOf(wire)).toBeUndefined()
    })

    it('em dev (renderer do Vite) a origem do servidor de dev também sai', () => {
        const { session, send } = fakeSession()
        setupOutgoingHeaderRewrites(session, 'http://localhost:5173/')
        const wire = send(PEER_URL, { Host: PEER_HOST, Origin: 'http://localhost:5173' })
        expect(originOf(wire)).toBeUndefined()
        expect(localRequestVerdict(PEER_HOST, originOf(wire), 8974)).toBe('ok')
    })

    it('em dev, outra origem de localhost (outra porta) NÃO é confundida com o app', () => {
        const { session, send } = fakeSession()
        setupOutgoingHeaderRewrites(session, 'http://localhost:5173/')
        const wire = send(PEER_URL, { Host: PEER_HOST, Origin: 'http://localhost:9999' })
        expect(originOf(wire)).toBe('http://localhost:9999')
    })

    it('origem opaca "null" (iframe sandbox / data:) NÃO é lavada: o outro PC segue recusando', () => {
        const { session, send } = fakeSession()
        setupOutgoingHeaderRewrites(session)
        const wire = send(PEER_URL, { Host: PEER_HOST, Origin: 'null' })
        expect(originOf(wire)).toBe('null')
        expect(localRequestVerdict(PEER_HOST, originOf(wire), 8974)).toBe('bad-origin')
    })

    it('origem de TERCEIRO (página abrindo ws://) não é apagada', () => {
        const { session, send } = fakeSession()
        setupOutgoingHeaderRewrites(session)
        const wire = send(PEER_URL, { Host: PEER_HOST, Origin: 'https://www.youtube.com' })
        expect(originOf(wire)).toBe('https://www.youtube.com')
        expect(localRequestVerdict(PEER_HOST, originOf(wire), 8974)).toBe('bad-origin')
    })

    it('o guarda de Host segue valendo: domínio no Host continua barrado', () => {
        const { session, send } = fakeSession()
        setupOutgoingHeaderRewrites(session)
        const wire = send('ws://evil.com:8974/?pin=1234', { Host: 'evil.com:8974', Origin: 'file://' })
        expect(localRequestVerdict(wire.Host, originOf(wire), 8974)).toBe('bad-host')
    })

    it('wss:// e http(s) não são tocados', () => {
        expect(rewriteOutgoingHeaders(`wss://${PEER_HOST}/?pin=1`, { Origin: 'file://' })).toEqual({ Origin: 'file://' })
        expect(rewriteOutgoingHeaders(`http://${PEER_HOST}/`, { Origin: 'file://' })).toEqual({ Origin: 'file://' })
        expect(rewriteOutgoingHeaders('not a url', { Origin: 'file://' })).toEqual({ Origin: 'file://' })
    })

    it('withoutOwnOrigin não muta a entrada', () => {
        const input = { Origin: 'file://', 'User-Agent': 'x' }
        const out = withoutOwnOrigin(input)
        expect(input.Origin).toBe('file://')
        expect(out).toEqual({ 'User-Agent': 'x' })
    })
})

describe('D103: um listener só por sessão (o trailer do YouTube não pode cair)', () => {
    it('o MESMO listener cobre o embed do YouTube e o ws://', () => {
        const { session, send, filter, registrations } = fakeSession()
        setupOutgoingHeaderRewrites(session)
        expect(registrations()).toBe(1)
        expect(filter()).toEqual(OUTGOING_HEADER_URL_FILTER)
        expect(filter()).toContain('*://*.youtube.com/embed/*')
        expect(filter()).toContain('*://*.youtube-nocookie.com/embed/*')
        expect(filter()).toContain('ws://*/*')

        const embed = send('https://www.youtube.com/embed/abc123', { Referer: 'file:///C:/app/index.html' })
        expect(embed.Referer).toBe(`${EMBEDDER_ORIGIN}/`)
        const ws = send(PEER_URL, { Host: PEER_HOST, Origin: 'file://' })
        expect(originOf(ws)).toBeUndefined()
    })

    it('main.ts instala o listener único; ninguém mais registra onBeforeSendHeaders', () => {
        const electronDir = __dirname
        const main = fs.readFileSync(path.join(electronDir, 'main.ts'), 'utf8')
        expect(main.includes('setupOutgoingHeaderRewrites(win.webContents.session, VITE_DEV_SERVER_URL)')).toBe(true)
        expect(main.includes('setupYouTubeEmbedFix(')).toBe(false)

        // Um segundo registro em qualquer arquivo do main substituiria este
        // listener em silêncio (e derrubaria o trailer ou o PC controla PC).
        const quemRegistra = fs.readdirSync(electronDir)
            .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
            .filter(name => fs.readFileSync(path.join(electronDir, name), 'utf8').includes('onBeforeSendHeaders('))
        expect(quemRegistra).toEqual(['outgoingHeaderRewrites.ts'])
    })

    it('a tela avisa o caso que continua sem conserto (HTTPS ligado no outro PC)', () => {
        const tela = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'settings', 'NetworkSection.tsx'), 'utf8')
        expect(tela.includes('se o controle está ativado no outro PC (com o HTTPS desligado lá).')).toBe(true)
    })
})
