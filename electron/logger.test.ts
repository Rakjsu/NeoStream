/**
 * Garante que a redação está plugada NO TRANSPORTE de arquivo do electron-log.
 *
 * O ponto do teste não é o regex (isso é logRedaction.test.ts) e sim o
 * encanamento: se alguém tirar o transform, qualquer log.* volta a gravar a
 * senha do provedor em disco sem que nenhuma chamada de log mude.
 */
import { describe, it, expect, vi } from 'vitest'
import util from 'node:util'

type FileTransform = (options: { data: unknown }) => unknown

const linhasDeErro = vi.hoisted(() => [] as string[])
const capturaLigada = vi.hoisted(() => [] as unknown[])

const fakeLog = vi.hoisted(() => ({
    initialize: () => undefined,
    error: (...args: unknown[]) => { linhasDeErro.push(args.map(String).join(' ')) },
    errorHandler: { startCatching: (opcoes: unknown) => { capturaLigada.push(opcoes) } },
    transports: {
        // O electron-log real chega aqui com [removeStyles, format,
        // concatFirstStringElements, toString]; o que importa pro teste é que a
        // cadeia termina numa string formatada.
        file: { level: 'silly', format: '', transforms: [] as Array<(options: { data: unknown }) => unknown> },
        console: { level: 'silly', format: '' },
    },
}))

vi.mock('electron-log/main', () => ({ default: fakeLog }))

import './logger'

/** Roda a cadeia de transforms como o transporte de arquivo faria. */
function runFileTransforms(formatted: string): string {
    const transforms = fakeLog.transports.file.transforms as FileTransform[]
    return String(transforms.reduce<unknown>((data, transform) => transform({ data }), formatted))
}

describe('logger — transporte de arquivo', () => {
    it('acrescenta um transform de redação ao fim da cadeia', () => {
        expect(fakeLog.transports.file.transforms).toHaveLength(1)
    })

    it('redige a senha do provedor serializada pelo util.inspect', () => {
        // Exatamente o que `log.info('[XtreamClient] Response data:', data)`
        // produzia no main.log.
        const linha = util.formatWithOptions({ depth: 5 }, '[XtreamClient] Response data:', {
            user_info: { username: 'joao123', password: 's3nh4Secreta', auth: 1 },
        })
        const out = runFileTransforms(linha)

        expect(out).not.toContain('s3nh4Secreta')
        expect(out).not.toContain('joao123')
        expect(out).toContain('auth: 1')
    })

    it('redige a credencial no caminho da URL vinda do stderr do ffmpeg', () => {
        const out = runFileTransforms('[Transcode t1] http://prov:8080/live/joao/s3nh4/1.ts: Server returned 403')

        expect(out).not.toContain('s3nh4')
        expect(out).toContain('Server returned 403')
    })
})

/**
 * 🧯 A rede de segurança do processo principal.
 *
 * Sem ela, um throw assíncrono fora de um `.on('error')` derrubava o app pelo
 * diálogo nativo do Chromium e não deixava UMA linha no arquivo que a pessoa
 * exporta em Diagnósticos. O teste olha o encanamento, não o texto: se alguém
 * tirar o `startCatching` ou o listener, o app volta a morrer mudo.
 */
describe('logger — rede de segurança do processo principal', () => {
    const tudo = () => linhasDeErro.join(' | ')

    it('liga a captura de exceção sem o diálogo nativo', () => {
        expect(capturaLigada).toHaveLength(1)
        const opcoes = capturaLigada[0] as { showDialog?: boolean; onError?: unknown }
        expect(opcoes.showDialog).toBe(false)
        expect(typeof opcoes.onError).toBe('function')
    })

    it('a exceção capturada vira linha de log', () => {
        linhasDeErro.length = 0
        const { onError } = capturaLigada[0] as { onError: (e: { error: unknown }) => void }
        onError({ error: new Error('EPIPE: broken pipe') })
        expect(tudo()).toContain('uncaughtException')
        expect(tudo()).toContain('EPIPE: broken pipe')
    })

    it('promessa rejeitada sem catch também é registrada', () => {
        linhasDeErro.length = 0
        const ouvintes = process.listeners('unhandledRejection')
        expect(ouvintes.length).toBeGreaterThan(0)
        const ultimo = ouvintes[ouvintes.length - 1] as (motivo: unknown, p?: unknown) => void
        ultimo(new Error('provedor recusou'), Promise.resolve())
        expect(tudo()).toContain('unhandledRejection')
        expect(tudo()).toContain('provedor recusou')
    })
})
