import { describe, it, expect, vi, beforeEach } from 'vitest';
import { srtToVtt, searchSubtitles } from './subtitleService';

describe('srtToVtt', () => {
    it('prefixa WEBVTT e troca vírgula por ponto nos timestamps', () => {
        const srt = '1\n00:00:01,500 --> 00:00:04,000\nOlá mundo\n';
        const vtt = srtToVtt(srt);
        expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
        expect(vtt).toContain('00:00:01.500 --> 00:00:04.000');
        expect(vtt).toContain('Olá mundo');
    });

    it('normaliza CRLF e não toca vírgulas do texto', () => {
        const srt = '1\r\n00:01:00,000 --> 00:01:02,000\r\nSim, claro\r\n';
        const vtt = srtToVtt(srt);
        expect(vtt).not.toContain('\r');
        expect(vtt).toContain('00:01:00.000 --> 00:01:02.000');
        expect(vtt).toContain('Sim, claro');
    });
});

// ---- searchSubtitles: OpenSubtitles via IPC mockado ------------------------

type IpcHandler = (payload: { endpoint: string; method: string; body?: unknown }) => unknown;

function mockOpenSubtitlesIpc(onRequest: IpcHandler) {
    const invoke = vi.fn((channel: string, payload: { endpoint: string; method: string; body?: unknown }) => {
        if (channel !== 'opensubtitles:request') return Promise.resolve({ success: false });
        if (payload.endpoint === '/login') {
            return Promise.resolve({ success: true, data: { token: 'jwt-abc' } });
        }
        return Promise.resolve(onRequest(payload));
    });
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
    return invoke;
}

function sub(id: string, over: Record<string, unknown> = {}, fileId = 100) {
    return {
        id,
        attributes: {
            language: 'pt-BR',
            release: `Release ${id}`,
            download_count: 10,
            url: `http://o/${id}`,
            files: [{ file_id: fileId, file_name: `${id}.srt` }],
            hearing_impaired: false,
            foreign_parts_only: false,
            ...over,
        },
    };
}

describe('searchSubtitles', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('monta a query, autentica e mapeia os resultados', async () => {
        const invoke = mockOpenSubtitlesIpc(() => ({
            success: true,
            data: { data: [sub('s1')] },
        }));
        const results = await searchSubtitles({ query: 'Filme', languages: 'pt-br', season: 1, episode: 2 });
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ id: 's1', language: 'pt-BR', fileId: 100 });
        const searchCall = invoke.mock.calls.find(c => String((c[1] as { endpoint: string }).endpoint).startsWith('/subtitles'));
        const endpoint = (searchCall![1] as { endpoint: string }).endpoint;
        expect(endpoint).toContain('query=Filme');
        expect(endpoint).toContain('languages=pt-br');
        expect(endpoint).toContain('season_number=1');
        expect(endpoint).toContain('episode_number=2');
    });

    it('descarta itens sem file_id (não dá pra baixar)', async () => {
        mockOpenSubtitlesIpc(() => ({
            success: true,
            data: { data: [sub('ok'), sub('sem-arquivo', { files: [] })] },
        }));
        const results = await searchSubtitles({ query: 'X' });
        expect(results.map(r => r.id)).toEqual(['ok']);
    });

    it('prefere legendas completas (sem HI / sem forced) quando existem', async () => {
        mockOpenSubtitlesIpc(() => ({
            success: true,
            data: {
                data: [
                    sub('hi', { hearing_impaired: true }),
                    sub('full'),
                    sub('forced', { foreign_parts_only: true }),
                ],
            },
        }));
        const results = await searchSubtitles({ query: 'X' });
        expect(results.map(r => r.id)).toEqual(['full']);
    });

    it('forcedOnly devolve apenas as "foreign parts only"', async () => {
        mockOpenSubtitlesIpc(() => ({
            success: true,
            data: { data: [sub('full'), sub('forced', { foreign_parts_only: true })] },
        }));
        const results = await searchSubtitles({ query: 'X', forcedOnly: true });
        expect(results.map(r => r.id)).toEqual(['forced']);
    });

    it('falha da API → lista vazia (nunca lança)', async () => {
        mockOpenSubtitlesIpc(() => ({ success: false, status: 502 }));
        expect(await searchSubtitles({ query: 'X' })).toEqual([]);
    });
});
