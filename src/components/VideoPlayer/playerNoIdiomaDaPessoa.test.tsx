import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import en from '../../locales/ui/en.json';
import es from '../../locales/ui/es.json';
import { languageService } from '../../services/languageService';
import { useSubtitleManager } from './useSubtitleManager';

/**
 * 🌐 #D007: o player tinha a seção `player` inteira no dicionário, mas as telas
 * mais vistas continuavam em português cravado — o "Preparando seu vídeo..." e
 * o "Carregando..." de toda abertura, as duas caixas de erro, os rótulos de
 * play/mudo/volume (que o leitor de tela lê), o menu de legendas forçadas, os
 * marcadores, o aviso do Trakt, o clipe A–B — e o "Cast to Device" em inglês
 * cravado, que o espanhol também via. O aviso de legenda em outro idioma vinha
 * pronto, em português, de dentro do `subtitleService`.
 *
 * Roda com o app em INGLÊS e em ESPANHOL: um idioma só não basta, porque vários
 * textos coincidem com o português num deles ("Volume" e "Picture-in-Picture"
 * em inglês; "Pausar", "Silenciar", "Marcadores" em espanhol). O `VideoPlayer`
 * e o `AsyncVideoPlayer` são os de verdade: só o hls.js sai de cena (o jsdom não
 * toca mídia) e a ponte do Electron é pendurada no `window` do jsdom, sem
 * trocá-lo. O que se confere é o que a pessoa vê e o que o leitor de tela lê —
 * texto, `title` e `aria-label`.
 */

vi.mock('../../hooks/useHls', () => ({ useHls: () => ({ current: null }) }));

import { VideoPlayer } from './VideoPlayer';
import AsyncVideoPlayer from '../AsyncVideoPlayer';

type Dicionario = Record<string, Record<string, string>>;
const DICIONARIOS: Record<'en' | 'es', Dicionario> = {
    en: en as unknown as Dicionario,
    es: es as unknown as Dicionario,
};

/** Os textos que estavam cravados no player (o defeito). */
const CRAVADOS = [
    'Preparando seu vídeo',
    'Carregando...',
    'Erro ao carregar vídeo',
    'Nao foi possivel carregar o video',
    'Erro ao carregar o video',
    'Verifique se as credenciais',
    'Erro de conexão com o servidor',
    'Fechar',
    'Pausar',
    'Reproduzir',
    'Ativar som',
    'Silenciar',
    'Legendas Forçadas',
    'Placas e diálogos estrangeiros',
    'Visto no Trakt',
    'Posição marcada',
    'Marcadores',
    'Nenhum marcador ainda',
    'Remover marcador',
    'Exportar clipe',
    'Cast to Device',
];

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let penduramosPonte = false;

/** Tudo o que chega à pessoa: texto na tela + title/aria-label/placeholder. */
function oQueAPessoaRecebe(): string {
    const atributos: string[] = [];
    container.querySelectorAll('*').forEach(el => {
        for (const nome of ['title', 'aria-label', 'placeholder']) {
            const v = el.getAttribute(nome);
            if (v) atributos.push(v);
        }
    });
    return `${container.textContent ?? ''}\n${atributos.join('\n')}`;
}

/**
 * Português cravado na tela. Um texto que o PRÓPRIO idioma usa de verdade
 * ("Pausar" e "Silenciar" também são espanhol) não conta como cravado.
 */
function cravadosNaTela(D: Dicionario): string[] {
    const legitimos = [...Object.values(D.player), ...Object.values(D.common)];
    const tudo = oQueAPessoaRecebe();
    return CRAVADOS
        .filter(pt => !legitimos.some(v => v.includes(pt)))
        .filter(pt => tudo.includes(pt));
}

function montar(props: { onClose?: () => void } = {}): void {
    act(() => {
        root.render(
            <VideoPlayer
                src="http://prov.tv/movie/1.mp4"
                title="Filme"
                contentType="movie"
                contentId="m-1"
                onClose={props.onClose}
            />
        );
    });
}

function tecla(key: string, shiftKey = false): void {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    });
}

function porTitulo(titulo: string): HTMLElement | null {
    return Array.from(container.querySelectorAll<HTMLElement>('[title]')).find(el => el.getAttribute('title') === titulo) ?? null;
}

/** Espera a CONDIÇÃO (com teto), nunca um número fixo de voltas. */
async function esperar(condicao: () => boolean, tetoMs = 3000): Promise<void> {
    const fim = Date.now() + tetoMs;
    while (!condicao() && Date.now() < fim) {
        await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    }
    expect(condicao()).toBe(true);
}

// ── Ponte com o main: só o que o OpenSubtitles precisa; o resto responde vazio.
interface ItemDaBusca { fileId: number; language: string; release: string; forced: boolean }
let itensDaBusca: ItemDaBusca[] = [];

function instalarPonte(): void {
    const w = window as unknown as { ipcRenderer?: unknown };
    penduramosPonte = !w.ipcRenderer;
    const invoke = vi.fn(async (canal: string, payload?: { endpoint: string }) => {
        if (canal === 'opensubtitles:get-config') {
            return { success: true, apiKey: 'k', username: 'u', password: 'p' };
        }
        if (canal !== 'opensubtitles:request' || !payload) return undefined;
        if (payload.endpoint === '/login') return { success: true, data: { token: 'jwt' } };
        if (payload.endpoint.startsWith('/subtitles')) {
            return {
                success: true,
                data: {
                    data: itensDaBusca.map(i => ({
                        id: `s${i.fileId}`,
                        attributes: {
                            language: i.language,
                            release: i.release,
                            download_count: 10,
                            foreign_parts_only: i.forced,
                            files: [{ file_id: i.fileId, file_name: 'a.srt' }],
                        },
                    })),
                },
            };
        }
        if (payload.endpoint === '/download') {
            return { success: true, data: { link: 'https://dl.test/a.srt' } };
        }
        return { success: false };
    });
    w.ipcRenderer = { invoke, on: vi.fn(), off: vi.fn(), send: vi.fn() };
}

afterAll(() => {
    languageService.setLanguage('pt');
});

beforeEach(() => {
    localStorage.clear();
    // Legenda forçada automática fora do caminho, e legenda preferida em PT-BR.
    localStorage.setItem('playbackConfig', JSON.stringify({
        subtitleLanguage: 'pt-br',
        subtitleLanguageUserSet: true,
        forcedSubtitlesEnabled: false,
    }));
    itensDaBusca = [];
    instalarPonte();
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        text: async () => '1\n00:00:01,000 --> 00:00:03,000\nOi\n',
    })));
    URL.createObjectURL = vi.fn(() => 'blob:legenda');
    URL.revokeObjectURL = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (penduramosPonte) delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    localStorage.clear();
});

// ── Aviso de legenda: o texto é montado no idioma da pessoa, não no serviço.
type Api = ReturnType<typeof useSubtitleManager>;
let api: Api;

function Sonda({ tmdbId, receber }: { tmdbId: number; receber: (a: Api) => void }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    receber(useSubtitleManager({ title: 'Filme Aviso', tmdbId, videoRef }));
    return null;
}

async function montarSonda(tmdbId: number): Promise<void> {
    await act(async () => { root.render(<Sonda tmdbId={tmdbId} receber={(a) => { api = a; }} />); });
}

describe.each([
    { lang: 'en' as const, base: 7100 },
    { lang: 'es' as const, base: 7200 },
])('player com o app em $lang (#D007)', ({ lang, base }) => {
    const D = DICIONARIOS[lang];

    beforeAll(async () => {
        languageService.setLanguage(lang);
        // O dicionário chega por import dinâmico: espera ele estar lá.
        await esperar(() => languageService.t('player', 'fullscreen') === D.player.fullscreen);
    });

    it('abrindo: o "carregando", os rótulos de play/mudo/volume e os botões do rodapé saem no idioma escolhido', () => {
        montar();

        expect(container.querySelector('.loading-text')?.textContent).toBe(D.common.loading);

        const play = container.querySelector('.controls-left .control-btn');
        expect(play?.getAttribute('aria-label')).toBe(D.player.play);
        expect(play?.getAttribute('title')).toBe(D.player.play);

        // Volume salvo = 1 (padrão): o botão oferece SILENCIAR.
        const mudo = container.querySelector('.volume-btn');
        expect(mudo?.getAttribute('aria-label')).toBe(D.player.mute);
        expect(mudo?.getAttribute('title')).toBe(D.player.mute);

        // A barra de volume só aparece com o mouse sobre o controle de volume.
        const controleDeVolume = container.querySelector('.volume-control')!;
        act(() => {
            controleDeVolume.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
        });
        expect(container.querySelector('.volume-slider')?.getAttribute('aria-label')).toBe(D.player.volume);
        expect(porTitulo(D.player.castToDevice)).not.toBeNull();
        expect(porTitulo(D.player.pictureInPicture)).not.toBeNull();

        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('volume salvo em zero: o botão oferece ATIVAR O SOM no idioma escolhido', () => {
        localStorage.setItem('playerVolume', '0');
        montar();

        const mudo = container.querySelector('.volume-btn');
        expect(mudo?.getAttribute('aria-label')).toBe(D.player.unmute);
        expect(mudo?.getAttribute('title')).toBe(D.player.unmute);
        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('vídeo que falha: a caixa de erro e o botão de fechar saem no idioma escolhido', () => {
        montar({ onClose: () => { } });
        const video = container.querySelector('video')!;
        act(() => { video.dispatchEvent(new Event('error')); });

        const caixa = container.querySelector('.video-player-error');
        expect(caixa).not.toBeNull();
        expect(caixa!.textContent!.includes(D.player.errorTitle)).toBe(true);
        expect(caixa!.textContent!.includes(D.player.errorHint)).toBe(true);
        expect(caixa!.querySelector('button')?.textContent).toBe(D.player.close);

        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('menu de legendas forçadas (botão F) sai no idioma escolhido', () => {
        montar();
        const botaoF = porTitulo(D.player.forcedSubtitles);
        expect(botaoF).not.toBeNull();
        act(() => { botaoF!.click(); });

        const recebido = oQueAPessoaRecebe();
        expect(recebido.includes(D.player.forcedSubtitlesHint)).toBe(true);
        // O rótulo do item do menu (não só o title do botão F).
        const rotulos = Array.from(container.querySelectorAll('div'))
            .filter(d => d.children.length === 0 && d.textContent?.trim() === D.player.forcedSubtitles);
        expect(rotulos.length).toBe(1);

        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('aviso do Trakt, marcadores (X / Shift+X) e o clipe A–B saem no idioma escolhido', () => {
        montar();

        act(() => { window.dispatchEvent(new Event('trakt:synced')); });
        expect(oQueAPessoaRecebe().includes(D.player.traktWatched)).toBe(true);

        tecla('X', true); // painel vazio
        expect(oQueAPessoaRecebe().includes(`🔖 ${D.player.bookmarks} ${D.player.bookmarksHint}`)).toBe(true);
        expect(oQueAPessoaRecebe().includes(D.player.bookmarksEmpty)).toBe(true);

        tecla('x'); // marca a posição
        expect(oQueAPessoaRecebe().includes(D.player.bookmarkAdded)).toBe(true);
        expect(porTitulo(D.player.removeBookmark)).not.toBeNull();

        // A–B: ponto A no 0s, ponto B no 5s.
        const video = container.querySelector('video')!;
        tecla('b');
        Object.defineProperty(video, 'currentTime', { value: 5, configurable: true, writable: true });
        tecla('b');
        expect(porTitulo(D.player.exportClip)).not.toBeNull();

        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('abrindo filme/série: o "preparando seu vídeo" sai no idioma escolhido', async () => {
        await act(async () => {
            root.render(
                <AsyncVideoPlayer
                    movie={{ stream_id: base, name: 'Filme' }}
                    buildStreamUrl={() => new Promise<string>(() => { })}
                    onClose={() => { }}
                />
            );
        });
        await esperar(() => container.querySelector('.loading-text') !== null);
        expect(container.querySelector('.loading-text')?.textContent).toBe(D.player.preparingVideo);
        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('link do stream vazio: o cartão de erro diz "URL inválida" no idioma escolhido', async () => {
        await act(async () => {
            root.render(
                <AsyncVideoPlayer
                    movie={{ stream_id: base + 1, name: 'Filme' }}
                    buildStreamUrl={async () => ''}
                    onClose={() => { }}
                />
            );
        });
        await esperar(() => container.querySelector('.error-message') !== null);
        expect(container.querySelector('.error-message')?.textContent).toBe(D.player.streamInvalidUrl);
        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('link do stream que falha: o cartão de erro diz "tente de novo" no idioma escolhido', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        await act(async () => {
            root.render(
                <AsyncVideoPlayer
                    movie={{ stream_id: base + 2, name: 'Filme' }}
                    buildStreamUrl={async () => { throw new Error('portal fora'); }}
                    onClose={() => { }}
                />
            );
        });
        await esperar(() => container.querySelector('.error-message') !== null);
        expect(container.querySelector('.error-message')?.textContent).toBe(D.player.streamLoadFailed);
        expect(cravadosNaTela(D)).toEqual([]);
    });

    it('sem legenda no idioma preferido: o aviso de "usando outro idioma" sai no idioma escolhido', async () => {
        itensDaBusca = [{ fileId: base + 1, language: 'en', release: 'Filme.1080p.WEB', forced: false }];
        await montarSonda(base + 1);

        await act(async () => { await api.handleSubtitleToggle(); });

        expect(api.subtitlesEnabled).toBe(true);
        expect(api.subtitleWarning).toBe(
            D.player.subtitleFallbackLanguage.replace('{wanted}', 'PT-BR').replace('{got}', 'EN'),
        );
    });

    it('CC com a forçada na tela troca pra completa em outro idioma: o aviso sai no idioma escolhido', async () => {
        itensDaBusca = [
            { fileId: base + 3, language: 'pt-br', release: 'Filme.1080p.WEB', forced: true },
            { fileId: base + 4, language: 'en', release: 'Filme.1080p.WEB', forced: false },
        ];
        await montarSonda(base + 3);

        // Liga a forçada da sessão: ela entra na tela.
        await act(async () => { await api.handleForcedSessionToggle(); });
        expect(api.subtitlesEnabled).toBe(true);
        expect(api.subtitleWarning).toBeNull();

        // CC com a forçada na tela = trocar pela completa; só há em inglês.
        await act(async () => { await api.handleSubtitleToggle(); });
        expect(api.subtitleWarning).toBe(
            D.player.subtitleFallbackLanguage.replace('{wanted}', 'PT-BR').replace('{got}', 'EN'),
        );
    });

    it('legenda forçada só de edição especial: o aviso sai no idioma escolhido', async () => {
        itensDaBusca = [{ fileId: base + 2, language: 'pt-br', release: 'Filme.Extended.Cut.1080p', forced: true }];
        await montarSonda(base + 2);

        // forcedSubtitlesEnabled:false no config → a sessão começa desligada; ligar busca a forçada.
        await act(async () => { await api.handleForcedSessionToggle(); });

        expect(api.subtitleWarning).toBe(D.player.subtitleSpecialEditionsOnly);
    });
});
