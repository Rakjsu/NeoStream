import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSubtitleManager } from './useSubtitleManager';
import { autoFetchSubtitle, autoFetchForcedSubtitle } from '../../services/subtitleService';
import fonteDoPlayer from './VideoPlayer.tsx?raw';

/**
 * 💬 Desligar e religar o CC não pode custar um download do OpenSubtitles (D008).
 *
 * Cada `/download` conta na cota diária da conta do PRÓPRIO usuário (a chave e
 * o login são dele, Configurações → APIs), e a conta gratuita tem poucos por
 * dia. O botão CC, ao desligar, jogava fora a legenda já baixada
 * (`setSubtitleUrl(null)` + `setVttContent(null)`); ao religar caía em
 * `if (!subtitleUrl && title)` e refazia busca + `/download`. Quem liga e
 * desliga a legenda algumas vezes por filme queimava a cota do dia inteiro.
 *
 * Os casos montam o hook de verdade, com o `subtitleService` de verdade, e
 * contam o que sai pela ponte com o main — é isso que a conta do usuário paga.
 */

interface Trafego {
    buscas: string[];
    downloads: number[];
    /** file_id cujo `/download` deve falhar (uma vez). */
    falharDownloadDe: Set<number>;
    /** file_id cujo próximo `/download` fica preso até a promessa soltar — e então falha. */
    segurarEFalhar: Map<number, Promise<void>>;
}

let trafego: Trafego;
let blobs = 0;

/**
 * Toda busca devolve uma legenda completa e uma forçada. O file_id nasce do que
 * foi pedido — cada caso usa um tmdb próprio, então nenhum aproveita o que
 * outro já baixou (a memória do serviço vive o arquivo de teste inteiro).
 */
function arquivosDaBusca(endpoint: string): { completa: number; forcada: number } {
    const q = new URLSearchParams(endpoint.split('?')[1] ?? '');
    const base = Number(q.get('tmdb_id') ?? 0) * 1000 + Number(q.get('episode_number') ?? 0);
    return { completa: base, forcada: base + 500 };
}

/** O VTT que o serviço entrega para o arquivo baixado (o SRT falso convertido). */
function vtt(fileId: number): string {
    return `WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nConteudo de https://dl.test/${fileId}.srt\n`;
}

function instalarPonte(): void {
    trafego = { buscas: [], downloads: [], falharDownloadDe: new Set(), segurarEFalhar: new Map() };
    const invoke = vi.fn(async (canal: string, payload?: { endpoint: string; body?: { file_id?: number } }) => {
        if (canal === 'opensubtitles:get-config') {
            return { success: true, apiKey: 'k', username: 'u', password: 'p' };
        }
        if (canal === 'subtitle:open-file') {
            return {
                success: true,
                name: 'minha.srt',
                path: 'C:/legendas/minha.srt',
                content: '1\n00:00:01,000 --> 00:00:02,000\nLegenda do disco\n',
            };
        }
        if (canal !== 'opensubtitles:request' || !payload) return { success: false };
        if (payload.endpoint === '/login') return { success: true, data: { token: 'jwt' } };
        if (payload.endpoint.startsWith('/subtitles')) {
            trafego.buscas.push(payload.endpoint);
            const { completa, forcada } = arquivosDaBusca(payload.endpoint);
            const item = (fileId: number, soForcada: boolean) => ({
                id: `s${fileId}`,
                attributes: {
                    language: 'pt-BR',
                    release: 'Filme.Teste.1080p.WEB',
                    download_count: 10,
                    foreign_parts_only: soForcada,
                    files: [{ file_id: fileId, file_name: 'a.srt' }],
                },
            });
            return { success: true, data: { data: [item(completa, false), item(forcada, true)] } };
        }
        if (payload.endpoint === '/download') {
            const fileId = Number(payload.body?.file_id);
            trafego.downloads.push(fileId);
            const preso = trafego.segurarEFalhar.get(fileId);
            if (preso) {
                trafego.segurarEFalhar.delete(fileId);
                await preso;
                return { success: false, status: 503 };
            }
            if (trafego.falharDownloadDe.delete(fileId)) return { success: false, status: 503 };
            return { success: true, data: { link: `https://dl.test/${fileId}.srt` } };
        }
        return { success: false };
    });
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
}

type Api = ReturnType<typeof useSubtitleManager>;
let api: Api;

interface Conteudo {
    title: string;
    tmdbId: number;
    seasonNumber?: number;
    episodeNumber?: number;
}

function Sonda({ receber, ...conteudo }: Conteudo & { receber: (a: Api) => void }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    receber(useSubtitleManager({ ...conteudo, videoRef }));
    return null;
}

let container: HTMLDivElement;
let root: Root;

/** Monta — ou, se já montado, só troca as props (o player nem sempre remonta). */
async function montar(conteudo: Conteudo): Promise<void> {
    await act(async () => { root.render(<Sonda {...conteudo} receber={(a) => { api = a; }} />); });
}

/** Clique no CC — o handler só resolve depois da busca/download terminar. */
async function clicarCC(): Promise<void> {
    await act(async () => { await api.handleSubtitleToggle(); });
}

/** Espera a CONDIÇÃO (com teto), nunca um número fixo de voltas. */
async function esperar(condicao: () => boolean, tetoMs = 3000): Promise<void> {
    const fim = Date.now() + tetoMs;
    while (!condicao() && Date.now() < fim) {
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
    expect(condicao()).toBe(true);
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Legenda forçada automática fora do caminho: estes casos são o botão CC.
    localStorage.setItem('playbackConfig', JSON.stringify({
        subtitleLanguage: 'pt-br',
        subtitleLanguageUserSet: true,
        forcedSubtitlesEnabled: false,
    }));
    instalarPonte();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
        ok: true,
        text: async () => `1\n00:00:01,000 --> 00:00:03,000\nConteudo de ${url}\n`,
    })));
    URL.createObjectURL = vi.fn(() => `blob:legenda-${++blobs}`);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('botão CC: desligar e religar (D008)', () => {
    it('religar mostra a MESMA legenda sem buscar nem baixar de novo', async () => {
        await montar({ title: 'Filme Teste', tmdbId: 11 });

        await clicarCC();
        expect(api.subtitlesEnabled).toBe(true);
        expect(api.vttContent).toBe(vtt(11000));
        expect(trafego.downloads).toEqual([11000]);
        const buscasAntes = trafego.buscas.length;

        for (let i = 0; i < 3; i++) {
            await clicarCC(); // desliga
            expect(api.subtitlesEnabled).toBe(false);
            await clicarCC(); // religa
            expect(api.subtitlesEnabled).toBe(true);
        }

        expect(api.vttContent).toBe(vtt(11000));
        expect(trafego.downloads).toEqual([11000]);
        expect(trafego.buscas.length).toBe(buscasAntes);
    });

    it('com o CC desligado a legenda fica carregada, mas não vai para a TV', async () => {
        await montar({ title: 'Filme Teste', tmdbId: 12 });
        await clicarCC();
        expect(api.legendaNaTela).toBe(vtt(12000));

        await clicarCC(); // desliga
        expect(api.subtitlesEnabled).toBe(false);
        // Carregada: é o que deixa o atalho "C" e o próximo CC só reexibirem.
        expect(api.vttContent).toBe(vtt(12000));
        // Mas quem desligou não quer a legenda na TV ao mandar o vídeo.
        expect(api.legendaNaTela).toBeNull();

        await clicarCC(); // religa
        expect(api.legendaNaTela).toBe(vtt(12000));
    });

    it('legenda aberta do disco sobrevive a desligar/religar — nada é baixado por cima', async () => {
        await montar({ title: 'Filme Teste', tmdbId: 13 });

        await act(async () => { await api.handleOpenSubtitleFile(); });
        expect(api.vttContent?.includes('Legenda do disco')).toBe(true);

        await clicarCC(); // desliga
        await clicarCC(); // religa

        expect(api.subtitlesEnabled).toBe(true);
        expect(api.vttContent?.includes('Legenda do disco')).toBe(true);
        expect(api.diskSubtitleName).toBe('minha.srt');
        expect(trafego.buscas).toEqual([]);
        expect(trafego.downloads).toEqual([]);
    });

    it('idioma escolhido no menu: desligar e religar não busca de novo', async () => {
        await montar({ title: 'Filme Teste', tmdbId: 17 });
        await act(async () => { await api.handleSubtitleLanguageSelect('pt-br'); });
        expect(api.vttContent).toBe(vtt(17000));
        const buscasAntes = trafego.buscas.length;

        await clicarCC(); // desliga
        await clicarCC(); // religa

        expect(api.subtitlesEnabled).toBe(true);
        expect(trafego.buscas.length).toBe(buscasAntes);
        expect(trafego.downloads).toEqual([17000]);
    });

    it('forçada automática escondida pelo atalho "C" continua carregada para voltar', async () => {
        localStorage.setItem('playbackConfig', JSON.stringify({
            subtitleLanguage: 'pt-br',
            subtitleLanguageUserSet: true,
            forcedSubtitlesEnabled: true,
        }));
        await montar({ title: 'Filme Teste', tmdbId: 18 });
        await esperar(() => api.isForcedSubtitle); // o hook agenda a forçada para ~1 s depois
        expect(api.vttContent).toBe(vtt(18500));

        act(() => { api.setSubtitlesEnabled(false); }); // é o que o atalho "C" faz
        expect(api.vttContent).toBe(vtt(18500));
        expect(api.legendaNaTela).toBeNull();
    });

    it('forçada ligada pelo menu e escondida pelo atalho "C" continua carregada para voltar', async () => {
        await montar({ title: 'Filme Teste', tmdbId: 20 });
        await act(async () => { await api.handleForcedSessionToggle(); });
        expect(api.isForcedSubtitle).toBe(true);

        act(() => { api.setSubtitlesEnabled(false); }); // o atalho "C"
        expect(api.vttContent).toBe(vtt(20500));
    });

    it('"Desligada" no menu continua esquecendo — e o CC seguinte não paga outro download', async () => {
        await montar({ title: 'Filme Teste', tmdbId: 14 });
        await clicarCC();
        const buscasAntes = trafego.buscas.length;

        act(() => { api.handleSubtitlesOff(); });
        expect(api.subtitlesEnabled).toBe(false);
        expect(api.vttContent).toBeNull();

        await clicarCC();
        expect(api.subtitlesEnabled).toBe(true);
        expect(api.vttContent).toBe(vtt(14000));
        expect(trafego.buscas.length).toBeGreaterThan(buscasAntes); // esqueceu de verdade
        expect(trafego.downloads).toEqual([14000]); // o arquivo já estava baixado
    });
});

/**
 * Trocar de episódio nem sempre remonta o player: com a URL do próximo pronta
 * na hora (arquivo offline), o AsyncVideoPlayer liga e desliga o "carregando"
 * no mesmo lote do React e o VideoPlayer só recebe props novas. É o que o
 * `montar()` com outro episódio reproduz aqui.
 */
describe('a legenda escondida não atravessa para outro episódio', () => {
    it('CC desligado no episódio 1: no 2 ela some, e religar busca a do 2', async () => {
        await montar({ title: 'Serie Teste', tmdbId: 15, seasonNumber: 1, episodeNumber: 1 });
        await clicarCC();
        expect(api.vttContent).toBe(vtt(15001));
        const blobDoEpisodio1 = vi.mocked(URL.createObjectURL).mock.results.at(-1)?.value;
        await clicarCC(); // desliga

        await montar({ title: 'Serie Teste', tmdbId: 15, seasonNumber: 1, episodeNumber: 2 });
        // A do episódio 1 não pode ressuscitar pelo atalho "C" (que só alterna
        // a visibilidade quando há legenda carregada) nem ir para a TV.
        expect(api.vttContent).toBeNull();
        expect(api.legendaNaTela).toBeNull();

        await clicarCC(); // religa
        expect(api.subtitlesEnabled).toBe(true);
        expect(api.vttContent).toBe(vtt(15002));
        expect(trafego.downloads).toEqual([15001, 15002]);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(blobDoEpisodio1); // a do 1 foi solta
    });

    it('forçada ligada no 1 e trocada pela completa já no 2: desligar e religar não busca de novo', async () => {
        await montar({ title: 'Serie Teste', tmdbId: 19, seasonNumber: 1, episodeNumber: 1 });
        await act(async () => { await api.handleForcedSessionToggle(); }); // liga a forçada pelo menu
        expect(api.isForcedSubtitle).toBe(true);
        expect(api.vttContent).toBe(vtt(19501));

        await montar({ title: 'Serie Teste', tmdbId: 19, seasonNumber: 1, episodeNumber: 2 });
        await clicarCC(); // com a forçada na tela, o CC troca pela completa — do episódio 2
        expect(api.isForcedSubtitle).toBe(false);
        expect(api.vttContent).toBe(vtt(19002));
        const buscasAntes = trafego.buscas.length;

        await clicarCC(); // desliga
        await clicarCC(); // religa
        expect(api.vttContent).toBe(vtt(19002));
        expect(trafego.buscas.length).toBe(buscasAntes);
    });

    it('legenda do disco escondida no episódio 1 não segue com o nome para o 2', async () => {
        await montar({ title: 'Serie Teste', tmdbId: 16, seasonNumber: 1, episodeNumber: 1 });
        await act(async () => { await api.handleOpenSubtitleFile(); });
        await clicarCC(); // desliga

        await montar({ title: 'Serie Teste', tmdbId: 16, seasonNumber: 1, episodeNumber: 2 });
        await clicarCC(); // religa

        expect(api.vttContent).toBe(vtt(16002));
        expect(api.diskSubtitleName).toBeNull();
    });
});

describe('subtitleService: o mesmo arquivo não é baixado duas vezes', () => {
    it('duas buscas que escolhem o mesmo arquivo gastam UM download', async () => {
        const params = { title: 'Filme Teste', tmdbId: 21 };
        const a = await autoFetchSubtitle(params);
        const b = await autoFetchSubtitle(params);

        expect(trafego.downloads).toEqual([21000]);
        expect(a?.vttContent).toBe(vtt(21000));
        expect(b?.vttContent).toBe(a?.vttContent);
        // Cada chamador recebe o próprio blob: um revogar não quebra o outro.
        expect(a?.url).not.toBe(b?.url);
    });

    it('a legenda forçada também é baixada uma vez só', async () => {
        const params = { title: 'Filme Teste', tmdbId: 22 };
        const a = await autoFetchForcedSubtitle(params);
        const b = await autoFetchForcedSubtitle(params);

        expect(trafego.downloads).toEqual([22500]);
        expect(a?.vttContent).toBe(vtt(22500));
        expect(b?.vttContent).toBe(a?.vttContent);
    });

    it('pedidos simultâneos do mesmo arquivo também gastam um só', async () => {
        const params = { title: 'Filme Teste', tmdbId: 23 };
        const [a, b] = await Promise.all([autoFetchSubtitle(params), autoFetchSubtitle(params)]);

        expect(trafego.downloads).toEqual([23000]);
        expect(a?.vttContent).toBe(vtt(23000));
        expect(b?.vttContent).toBe(a?.vttContent);
    });

    it('download que falhou não fica memorizado — a próxima tentativa baixa', async () => {
        const params = { title: 'Filme Teste', tmdbId: 24 };
        trafego.falharDownloadDe.add(24000);

        expect(await autoFetchSubtitle(params)).toBeNull();
        const segunda = await autoFetchSubtitle(params);

        expect(segunda?.vttContent).toBe(vtt(24000));
        expect(trafego.downloads).toEqual([24000, 24000]);
    });

    it('falha de um pedido já descartado pelo limite não apaga o pedido novo do mesmo arquivo', async () => {
        let soltar!: () => void;
        trafego.segurarEFalhar.set(26000, new Promise<void>((r) => { soltar = r; }));
        const antigo = autoFetchSubtitle({ title: 'Filme Teste', tmdbId: 26 });
        await esperar(() => trafego.downloads.includes(26000));

        // 30 outros arquivos empurram o pedido preso para fora da memória...
        for (let n = 1; n <= 30; n++) await autoFetchSubtitle({ title: 'Serie Teste', tmdbId: 27, season: 1, episode: n });
        // ...e um pedido novo do mesmo arquivo baixa e fica guardado.
        expect((await autoFetchSubtitle({ title: 'Filme Teste', tmdbId: 26 }))?.vttContent).toBe(vtt(26000));

        soltar();
        expect(await antigo).toBeNull(); // o preso falha só agora

        await autoFetchSubtitle({ title: 'Filme Teste', tmdbId: 26 });
        expect(trafego.downloads.filter((id) => id === 26000).length).toBe(2);
    });

    it('guarda no máximo 30 e descarta a usada há mais tempo', async () => {
        const episodio = (n: number) => autoFetchSubtitle({ title: 'Serie Teste', tmdbId: 25, season: 1, episode: n });
        for (let n = 1; n <= 30; n++) await episodio(n);
        expect(trafego.downloads.length).toBe(30);

        await episodio(1); // usada de novo: vira a mais recente
        await episodio(31); // a 31ª empurra para fora a mais antiga — agora o episódio 2
        expect(trafego.downloads.length).toBe(31);

        await episodio(1);
        expect(trafego.downloads.length).toBe(31);
        await episodio(2);
        expect(trafego.downloads.at(-1)).toBe(25002);
    });
});

describe('ponta: o VideoPlayer', () => {
    it('manda para a TV só a legenda que está na tela', () => {
        const inicio = fonteDoPlayer.indexOf('<CastDeviceSelector');
        expect(inicio).toBeGreaterThan(-1);
        const bloco = fonteDoPlayer.slice(inicio, fonteDoPlayer.indexOf('/>', inicio));
        expect(bloco.includes('subtitleVtt={legendaNaTela}')).toBe(true);
    });
});
