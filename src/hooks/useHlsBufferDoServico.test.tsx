import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * D010 — o `useHls` chamava `playbackService.getBufferSeconds()` para
 * "pré-aquecer" uma medição de banda que não existe mais (o falso teste de
 * velocidade saiu no #409). A chamada virou uma Promise descartada com um
 * `.catch` vazio, enquanto o hook refazia por conta própria a mesma regra
 * ("inteligente → medida em cache ou 15 s; fixo → o número configurado").
 *
 * Com a correção a regra mora num lugar só: `getBufferSeconds()` é síncrono e
 * é DELE que o hook tira o buffer que entrega ao hls.js. É isso que se observa
 * aqui, montando o hook de verdade e lendo a configuração que o hls.js recebeu.
 */

const construcoes = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('hls.js', () => {
    class HlsFalso {
        static isSupported() { return true; }
        static Events = { FRAG_BUFFERED: 'hlsFragBuffered', MANIFEST_PARSED: 'hlsManifestParsed', ERROR: 'hlsError' };
        static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
        bandwidthEstimate = Number.NaN;
        abrEwmaDefaultEstimate = 5_000_000;
        constructor(config: Record<string, unknown>) { construcoes.push(config); }
        on() { /* nenhum evento dispara neste teste */ }
        loadSource() { /* sem rede */ }
        attachMedia() { /* sem mídia */ }
        startLoad() { /* idem */ }
        recoverMediaError() { /* idem */ }
        destroy() { /* idem */ }
    }
    return { default: HlsFalso };
});

import { useHls } from './useHls';
import { playbackService } from '../services/playbackService';

const FONTE_HLS = 'http://prov.tv/live/u/p/1.m3u8';

function Player({ video }: { video: HTMLVideoElement }) {
    const videoRef = useRef<HTMLVideoElement | null>(video);
    useHls({ src: FONTE_HLS, videoRef, onStreamError: () => undefined });
    return null;
}

describe('useHls: o buffer vem de uma fonte só (D010)', () => {
    let container: HTMLDivElement;
    let root: Root;
    // O playbackService é singleton e NÃO tem como apagar uma medida:
    // reportMeasuredBandwidth(NaN) é recusado de propósito. Quem zera é o TTL
    // de 5 min — cada caso começa 10 min depois do anterior, então a medida
    // que um caso deixou já venceu quando o próximo monta o player.
    let relogio = Date.UTC(2030, 0, 1);

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        relogio += 10 * 60_000;
        vi.setSystemTime(relogio);
        localStorage.clear();
        construcoes.length = 0;
        playbackService.setConfig({ bufferSize: 'intelligent' });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        // Passa do watchdog de 10 s e da janela de 1 s da trava por elemento.
        act(() => { vi.advanceTimersByTime(11_000); });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function montar(): Record<string, unknown> {
        act(() => { root.render(<Player video={document.createElement('video')} />); });
        expect(construcoes).toHaveLength(1);
        return construcoes[0];
    }

    it('o buffer entregue ao hls.js é o que o playbackService.getBufferSeconds() decide', () => {
        // Se o hook voltar a refazer a regra por conta própria (ou a tratar o
        // retorno como Promise), o valor abaixo deixa de chegar ao hls.js.
        vi.spyOn(playbackService, 'getBufferSeconds').mockReturnValue(7);

        const config = montar();

        expect(config.maxBufferLength).toBe(7);
        expect(config.backBufferLength).toBe(14);
        expect(config.maxMaxBufferLength).toBe(140);
    });

    it('buffer inteligente sem medida: 15 s', () => {
        expect(montar().maxBufferLength).toBe(15);
    });

    it('buffer inteligente com banda medida: segue a medida', () => {
        playbackService.reportMeasuredBandwidth(60);
        expect(montar().maxBufferLength).toBe(5);
    });

    it('buffer fixo ignora a medida', () => {
        playbackService.setConfig({ bufferSize: '30' });
        playbackService.reportMeasuredBandwidth(60);
        expect(montar().maxBufferLength).toBe(30);
    });
});
