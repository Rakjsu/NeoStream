import { describe, it, expect } from 'vitest'
import {
    encodeCastMessage,
    decodeCastMessage,
    frameCastMessage,
    extractFrames,
    connectPayload,
    loadMediaPayload,
    queueLoadPayload,
    queueSkipPayload,
    queueJumpPayload,
    extractQueueItems,
    extractCurrentItemId,
    getMediaStatusPayload,
    setVolumePayload,
    extractMediaTimes,
    mediaCommandPayload,
    extractTransportId,
    extractSessionId,
    extractMediaSessionId,
    NS_CONNECTION,
    NS_MEDIA,
} from './castProtocol'

const SAMPLE = {
    sourceId: 'sender-neostream',
    destinationId: 'receiver-0',
    namespace: NS_CONNECTION,
    payloadUtf8: connectPayload(),
}

describe('protobuf do CastMessage', () => {
    it('encode → decode faz o round-trip completo', () => {
        const decoded = decodeCastMessage(encodeCastMessage(SAMPLE))
        expect(decoded).toEqual(SAMPLE)
    })

    it('payloads unicode sobrevivem (título com acento e emoji)', () => {
        const message = {
            ...SAMPLE,
            namespace: NS_MEDIA,
            payloadUtf8: loadMediaPayload(1, { url: 'http://x/s.m3u8', title: 'Sessão 📺 Ação', contentType: 'application/x-mpegurl', live: true }),
        }
        const decoded = decodeCastMessage(encodeCastMessage(message))
        expect(JSON.parse(decoded.payloadUtf8).media.metadata.title).toBe('Sessão 📺 Ação')
    })
})

describe('framing', () => {
    it('frame tem prefixo de 4 bytes BE com o tamanho do corpo', () => {
        const framed = frameCastMessage(SAMPLE)
        const bodyLength = new DataView(framed.buffer).getUint32(0, false)
        expect(bodyLength).toBe(framed.length - 4)
    })

    it('extractFrames separa múltiplos frames e devolve o resto parcial', () => {
        const one = frameCastMessage(SAMPLE)
        const two = frameCastMessage({ ...SAMPLE, payloadUtf8: '{"type":"PING"}' })
        const partial = two.subarray(0, 6)

        const glued = new Uint8Array(one.length + two.length + partial.length)
        glued.set(one, 0)
        glued.set(two, one.length)
        glued.set(partial, one.length + two.length)

        const { messages, rest } = extractFrames(glued)
        expect(messages).toHaveLength(2)
        expect(JSON.parse(messages[1].payloadUtf8).type).toBe('PING')
        expect(rest.length).toBe(partial.length)
    })

    it('buffer só com frame incompleto não devolve mensagens', () => {
        const framed = frameCastMessage(SAMPLE)
        const { messages, rest } = extractFrames(framed.subarray(0, framed.length - 3))
        expect(messages).toHaveLength(0)
        expect(rest.length).toBe(framed.length - 3)
    })
})

describe('payloads e extração de status', () => {
    it('mediaCommandPayload monta PLAY/PAUSE com a sessão', () => {
        expect(JSON.parse(mediaCommandPayload(7, 'PAUSE', 3))).toEqual({ type: 'PAUSE', requestId: 7, mediaSessionId: 3 })
    })

    it('extrai transportId/sessionId do RECEIVER_STATUS e mediaSessionId do MEDIA_STATUS', () => {
        const receiverStatus = {
            type: 'RECEIVER_STATUS',
            status: { applications: [{ appId: 'CC1AD845', transportId: 'transport-7', sessionId: 'sess-1' }] },
        }
        expect(extractTransportId(receiverStatus)).toBe('transport-7')
        expect(extractSessionId(receiverStatus)).toBe('sess-1')
        expect(extractMediaSessionId({ type: 'MEDIA_STATUS', status: [{ mediaSessionId: 42 }] })).toBe(42)
    })

    it('shapes inesperados viram null', () => {
        expect(extractTransportId({})).toBeNull()
        expect(extractSessionId(null)).toBeNull()
        expect(extractMediaSessionId({ status: 'x' })).toBeNull()
    })
})

describe('fase 2: status, volume e legendas', () => {
    it('LOAD com legenda inclui a track TEXT ativa', () => {
        const payload = JSON.parse(loadMediaPayload(3, {
            url: 'http://x/f.mp4', title: 'Filme', contentType: 'video/mp4', live: false,
            subtitleUrl: 'http://192.168.0.2:1234/cast-sub/t.vtt', subtitleLanguage: 'pt',
        }));
        expect(payload.activeTrackIds).toEqual([1]);
        expect(payload.media.tracks[0]).toMatchObject({ trackId: 1, type: 'TEXT', trackContentType: 'text/vtt' });
    });

    it('LOAD sem legenda não carrega tracks', () => {
        const payload = JSON.parse(loadMediaPayload(3, { url: 'http://x/f.mp4', title: 'F', contentType: 'video/mp4', live: true }));
        expect(payload.media.tracks).toBeUndefined();
        expect(payload.activeTrackIds).toBeUndefined();
    });

    it('setVolumePayload limita 0..1 e getMediaStatusPayload leva a sessão', () => {
        expect(JSON.parse(setVolumePayload(1, 1.7)).volume.level).toBe(1);
        expect(JSON.parse(setVolumePayload(1, -2)).volume.level).toBe(0);
        expect(JSON.parse(getMediaStatusPayload(2, 9)).mediaSessionId).toBe(9);
    });

    it('extractMediaTimes lê currentTime/duration do MEDIA_STATUS', () => {
        const times = extractMediaTimes({ status: [{ currentTime: 42.5, media: { duration: 3600 } }] });
        expect(times).toEqual({ currentTime: 42.5, duration: 3600 });
        expect(extractMediaTimes({ status: [] })).toBeNull();
    });
});

describe('fila de cast (QUEUE_LOAD)', () => {
    it('queueLoadPayload monta os itens com autoplay e metadata', () => {
        const payload = JSON.parse(queueLoadPayload(5, [
            { url: 'http://x/a.mp4', title: 'A', contentType: 'video/mp4' },
            { url: 'http://x/b.m3u8', title: 'B', contentType: 'application/x-mpegurl' },
        ], 1));
        expect(payload.type).toBe('QUEUE_LOAD');
        expect(payload.startIndex).toBe(1);
        expect(payload.items).toHaveLength(2);
        expect(payload.items[0]).toMatchObject({ autoplay: true });
        expect(payload.items[1].media).toMatchObject({ contentId: 'http://x/b.m3u8', streamType: 'BUFFERED' });
        expect(payload.items[0].media.metadata.title).toBe('A');
    });

    it('queueSkipPayload gera QUEUE_NEXT/QUEUE_PREV com a sessão', () => {
        expect(JSON.parse(queueSkipPayload(3, 7, 'next'))).toEqual({ type: 'QUEUE_NEXT', requestId: 3, mediaSessionId: 7 });
        expect(JSON.parse(queueSkipPayload(3, 7, 'prev')).type).toBe('QUEUE_PREV');
    });

    it('queueJumpPayload pula pro itemId com QUEUE_UPDATE', () => {
        expect(JSON.parse(queueJumpPayload(4, 7, 12)))
            .toEqual({ type: 'QUEUE_UPDATE', requestId: 4, mediaSessionId: 7, currentItemId: 12 });
    });

    it('extractQueueItems e extractCurrentItemId leem a fila do MEDIA_STATUS', () => {
        const status = {
            status: [{
                currentItemId: 2,
                items: [
                    { itemId: 1, media: { metadata: { title: 'Ep 1' } } },
                    { itemId: 2, media: { metadata: { title: 'Ep 2' } } },
                    { itemId: 3 }, // sem metadata → título vazio
                ],
            }],
        };
        expect(extractQueueItems(status)).toEqual([
            { itemId: 1, title: 'Ep 1' },
            { itemId: 2, title: 'Ep 2' },
            { itemId: 3, title: '' },
        ]);
        expect(extractCurrentItemId(status)).toBe(2);
        expect(extractQueueItems({ status: [{}] })).toEqual([]);
        expect(extractCurrentItemId({})).toBeNull();
    });
});
