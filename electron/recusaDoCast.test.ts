import { describe, it, expect } from 'vitest'
import { motivoDeRecusaDoCast } from './castProtocol'

/**
 * 📺 A TV recusa o vídeo e o app precisa saber.
 *
 * O `handleMessage` do castClient só olhava `MEDIA_STATUS`: `LOAD_FAILED`,
 * `LOAD_CANCELLED` e `INVALID_REQUEST` eram descartados sem uma linha de log.
 * Com uma mídia que o Chromecast não decodifica, o modal fechava dizendo
 * sucesso, a pílula "Transmitindo na TV" aparecia — e não saía mais, porque o
 * fim natural da sessão exige `idleReason: 'FINISHED'` e um LOAD recusado
 * devolve `'ERROR'`. Só reiniciar o app tirava a barra.
 */
describe('motivoDeRecusaDoCast', () => {
    it('LOAD_FAILED é recusa, com o motivo que a TV deu', () => {
        expect(motivoDeRecusaDoCast({ type: 'LOAD_FAILED', reason: 'MEDIA_UNKNOWN' }))
            .toBe('LOAD_FAILED (MEDIA_UNKNOWN)')
    })

    it('usa o código detalhado quando não há motivo em texto', () => {
        expect(motivoDeRecusaDoCast({ type: 'LOAD_FAILED', detailedErrorCode: 104 }))
            .toBe('LOAD_FAILED (código 104)')
    })

    it('sem detalhe nenhum, o tipo já basta', () => {
        expect(motivoDeRecusaDoCast({ type: 'LOAD_CANCELLED' })).toBe('LOAD_CANCELLED')
        expect(motivoDeRecusaDoCast({ type: 'INVALID_REQUEST' })).toBe('INVALID_REQUEST')
    })

    it('IDLE com idleReason ERROR também é recusa — é como ela chega em status', () => {
        expect(motivoDeRecusaDoCast({
            type: 'MEDIA_STATUS',
            status: [{ playerState: 'IDLE', idleReason: 'ERROR' }],
        })).toBe('IDLE (ERROR)')
    })

    it('o fim normal da reprodução NÃO é recusa', () => {
        // FINISHED é o caminho que já fecha a sessão sozinho; confundir os dois
        // faria o fim de um filme parecer erro da TV.
        expect(motivoDeRecusaDoCast({
            type: 'MEDIA_STATUS',
            status: [{ playerState: 'IDLE', idleReason: 'FINISHED' }],
        })).toBeNull()
    })

    it('status normal de reprodução não é recusa', () => {
        expect(motivoDeRecusaDoCast({
            type: 'MEDIA_STATUS',
            status: [{ playerState: 'PLAYING', currentTime: 12 }],
        })).toBeNull()
        expect(motivoDeRecusaDoCast({
            type: 'MEDIA_STATUS',
            status: [{ playerState: 'BUFFERING' }],
        })).toBeNull()
    })

    it('payload de outro tipo ou lixo não vira recusa', () => {
        expect(motivoDeRecusaDoCast({ type: 'RECEIVER_STATUS' })).toBeNull()
        expect(motivoDeRecusaDoCast({ type: 'MEDIA_STATUS' })).toBeNull()
        expect(motivoDeRecusaDoCast({ type: 'MEDIA_STATUS', status: 'nada' })).toBeNull()
        expect(motivoDeRecusaDoCast(null)).toBeNull()
        expect(motivoDeRecusaDoCast('LOAD_FAILED')).toBeNull()
    })
})
