/**
 * Os DOIS motores de video tem que receber a MESMA identidade de estatistica.
 *
 * O AsyncVideoPlayer escolhe entre o player interno e o MpvPlayerView. Se cada
 * um contasse o tempo com uma chave diferente (ou se um deles nao recebesse
 * chave nenhuma), o mesmo titulo viraria duas linhas na Retrospectiva e o
 * "mais assistido" repartiria o tempo entre as duas.
 *
 * Componente montado de verdade (react-dom/client + act), com os dois players
 * trocados por espioes de props.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const capturado: {
    interno: Record<string, unknown> | null;
    mpv: Record<string, unknown> | null;
} = { interno: null, mpv: null };

const playbackConfig = { mpvEnabled: false };

vi.mock('../services/playbackService', () => ({
    playbackService: { getConfig: () => ({ ...playbackConfig }) },
}));

vi.mock('./VideoPlayer/VideoPlayer', () => ({
    VideoPlayer: (props: Record<string, unknown>) => {
        capturado.interno = props;
        return null;
    },
}));

vi.mock('./MpvPlayerView', () => ({
    default: (props: Record<string, unknown>) => {
        capturado.mpv = props;
        return null;
    },
}));

import AsyncVideoPlayer from './AsyncVideoPlayer';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function montar(props: Record<string, unknown>) {
    await act(async () => {
        root.render(
            <AsyncVideoPlayer
                buildStreamUrl={async () => 'http://exemplo/stream.ts'}
                onClose={() => { }}
                {...props}
                movie={props.movie as { stream_id?: number | string; id?: number | string; name?: string }}
            />
        );
    });
    // O buildStreamUrl roda dentro de um queueMicrotask; um segundo giro do
    // loop garante que o player ja saiu da tela de "carregando".
    await act(async () => { await Promise.resolve(); });
}

const CENARIOS: Array<{
    nome: string;
    props: Record<string, unknown>;
    id: string;
    tipo: string;
}> = [
        {
            nome: 'filme, sem contentId da tela (Filmes)',
            props: { movie: { stream_id: 777, name: 'Filme Teste' } },
            id: '777',
            tipo: 'movie',
        },
        {
            nome: 'canal ao vivo, contentId da tela (TV ao vivo)',
            props: {
                movie: { stream_id: 9001, name: 'Canal Teste' },
                contentId: '9001',
                contentType: 'live',
            },
            id: '9001',
            tipo: 'live',
        },
        {
            nome: 'episodio de serie (Series)',
            props: {
                movie: { id: 4242, name: 'S01E03' },
                seriesId: '55',
                seasonNumber: 1,
                episodeNumber: 3,
            },
            id: '55',
            tipo: 'series',
        },
    ];

describe('AsyncVideoPlayer — mesma identidade de estatistica nos dois motores', () => {
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        capturado.interno = null;
        capturado.mpv = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        playbackConfig.mpvEnabled = false;
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it.each(CENARIOS)('$nome', async ({ props, id, tipo }) => {
        playbackConfig.mpvEnabled = false;
        await montar(props);
        expect(capturado.interno, 'o player interno deveria ter sido montado').not.toBeNull();
        const interno = capturado.interno!;

        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        playbackConfig.mpvEnabled = true;
        await montar(props);
        expect(capturado.mpv, 'o MpvPlayerView deveria ter sido montado').not.toBeNull();
        const mpv = capturado.mpv!;

        expect(mpv.contentId).toBe(id);
        expect(mpv.contentType).toBe(tipo);
        expect(interno.contentId).toBe(id);
        expect(interno.contentType).toBe(tipo);
        // O invariante propriamente dito: um motor nao pode contar com chave
        // diferente do outro.
        expect(mpv.contentId).toBe(interno.contentId);
        expect(mpv.contentType).toBe(interno.contentType);
    });
});
