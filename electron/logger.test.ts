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

const fakeLog = vi.hoisted(() => ({
    initialize: () => undefined,
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
