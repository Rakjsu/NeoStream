/**
 * O aviso da busca de legenda do MPV ("Buscando legendas...", "💬 English",
 * "nenhuma legenda encontrada") tem que nascer DENTRO da faixa de controles.
 *
 * Geometria do motor externo (electron/mpvProtocol.ts):
 *   - y 0..36 da janela: CustomTitleBar, com minimizar/maximizar/fechar à
 *     direita (MPV_TITLEBAR_HEIGHT);
 *   - y 36..(altura-96): a janela NATIVA do mpv, `--ontop` — nenhum z-index do
 *     DOM passa por cima dela;
 *   - os 96 px de baixo: a faixa `.mpv-view-controls` (MPV_CONTROLS_HEIGHT).
 *
 * O bug (D015): o aviso tinha `position: absolute; top: -34px; right: 16px`,
 * mas a faixa não é posicionada, então o contentor era o `.mpv-view-backdrop`
 * (`position: fixed; inset: 36px 0 0 0`). Resultado: a caixinha ia parar a
 * 2 px do topo da janela, dentro da barra de título, por cima dos botões da
 * janela. E só pôr `position: relative` na faixa não resolve: aí os -34 px
 * caem na área da janela do mpv e o aviso fica escondido atrás do vídeo.
 *
 * O jsdom não calcula layout, mas calcula a cascata: dá pra achar o bloco que
 * contém o aviso (o ancestral posicionado mais próximo) e o deslocamento
 * declarado, que é exatamente o que decide onde ele é desenhado.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../services/mpvService', () => ({
    mpvService: {
        play: vi.fn(async () => ({ success: true })),
        stop: vi.fn(async () => undefined),
        getStatus: vi.fn(async () => ({
            running: true,
            timePos: 10,
            duration: 3600,
            paused: false,
            eofReached: false,
            volume: 100,
            fullscreen: false,
            tracks: [],
            audioTrackId: null,
            subtitleTrackId: null,
        })),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        seek: vi.fn(async () => undefined),
        setVolume: vi.fn(async () => undefined),
        setFullscreen: vi.fn(async () => undefined),
        setAspect: vi.fn(async () => undefined),
        setAudioTrack: vi.fn(async () => undefined),
        setSubtitleTrack: vi.fn(async () => undefined),
        addSubtitle: vi.fn(async () => true),
        addSubtitleFile: vi.fn(async () => true),
        adjustSubtitleDelay: vi.fn(async () => undefined),
    },
}));

/** Controla a busca: pendente (aviso "Buscando...") ou sem resultado. */
let buscaPendente = true;
vi.mock('../services/subtitleService', async (importOriginal) => {
    const original = await importOriginal<typeof import('../services/subtitleService')>();
    return {
        ...original,
        autoFetchSubtitle: vi.fn(() => (buscaPendente ? new Promise(() => { }) : Promise.resolve(null))),
        motivoDeNaoTerLegenda: vi.fn(async () => 'nada-encontrado' as const),
    };
});

import MpvPlayerView from './MpvPlayerView';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function avancar(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

/** Avança o relógio até a condição valer (com teto), em vez de contar voltas. */
async function esperarAte(condicao: () => boolean, tetoMs = 10_000) {
    for (let passou = 0; !condicao() && passou < tetoMs; passou += 50) {
        await avancar(50);
    }
    expect(condicao()).toBe(true);
}

async function montarFilme() {
    await act(async () => {
        root.render(
            <MpvPlayerView
                streamUrl="http://exemplo/movie/42.mkv"
                title="Filme Teste"
                isLive={false}
                movieId="42"
                movieName="Filme Teste"
                contentId="42"
                contentType="movie"
                onClose={() => { }}
                onFallback={() => { }}
            />
        );
    });
}

function clicar(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    act(() => {
        (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

/** Abre o painel de legendas e escolhe um idioma — o caminho do usuário. */
async function buscarLegendaEmIngles() {
    const botoes = Array.from(container.querySelectorAll('button'));
    clicar(botoes.find(b => b.textContent?.includes('🔍💬')));
    const opcoes = Array.from(container.querySelectorAll('.mpv-view-subsearch-option'));
    const ingles = opcoes.find(o => o.textContent === 'English');
    expect(ingles).toBeTruthy();
    await act(async () => {
        (ingles as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

const aviso = () => container.querySelector('.mpv-view-subsearch-msg') as HTMLElement | null;

/** Deslocamento declarado em px; 'auto'/vazio = não desloca. */
function deslocamento(valor: string): number {
    const n = parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
}

describe('aviso da busca de legenda no MPV', () => {
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        buscaPendente = true;
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('é desenhado dentro da faixa de controles, nunca na barra de título nem atrás da janela do mpv', async () => {
        await montarFilme();
        await buscarLegendaEmIngles();
        await esperarAte(() => aviso() !== null);

        const msg = aviso()!;
        const faixa = container.querySelector('.mpv-view-controls') as HTMLElement;
        expect(faixa.contains(msg)).toBe(true);
        expect(msg.textContent?.trim()).not.toBe('');

        // Visível de fato: nem ele nem nenhum ancestral some com o texto.
        for (let el: HTMLElement | null = msg; el && el !== container; el = el.parentElement) {
            const s = getComputedStyle(el);
            expect(s.display).not.toBe('none');
            expect(s.visibility).not.toBe('hidden');
            expect(s.opacity).not.toBe('0');
        }

        const estilo = getComputedStyle(msg);
        expect(estilo.position).not.toBe('fixed');
        // Nem margem negativa nem translate tiram a caixinha da faixa por baixo
        // do pano (subir = janela --ontop do mpv).
        expect(deslocamento(estilo.marginTop)).toBeGreaterThanOrEqual(0);
        expect(['', 'none']).toContain(estilo.transform);

        if (estilo.position === 'absolute') {
            // Ancestral posicionado mais próximo = quem dá a origem do top/right.
            let bloco = msg.parentElement;
            while (bloco && getComputedStyle(bloco).position === 'static') bloco = bloco.parentElement;
            // Se o contentor for o backdrop (ou algo acima da faixa), o aviso
            // se ancora na tela inteira e sobe para a barra de título.
            expect(bloco !== null && faixa.contains(bloco)).toBe(true);
        }

        if (estilo.position !== 'static') {
            // Deslocar para cima (top negativo) ou empurrar para fora por baixo
            // tira o aviso da faixa: acima dela é a janela --ontop do mpv.
            expect(deslocamento(estilo.top)).toBeGreaterThanOrEqual(0);
            expect(deslocamento(estilo.bottom)).toBeGreaterThanOrEqual(0);
        }
    });

    it('ocupa o lugar do título por 4 s e o título volta; o texto inteiro fica no tooltip', async () => {
        buscaPendente = false;
        await montarFilme();
        await buscarLegendaEmIngles();
        await esperarAte(() => aviso() !== null);

        // A mensagem pode ser cortada com reticências: o texto inteiro vive no title.
        const msg = aviso()!;
        expect(msg.getAttribute('title')).toBe(msg.textContent);

        // Enquanto o aviso ocupa a faixa, o título segue acessível (tooltip).
        const titulo = container.querySelector('.mpv-view-title') as HTMLElement;
        expect(titulo.getAttribute('title')).toBe('Filme Teste');

        await esperarAte(() => aviso() === null, 6_000);
        expect(container.querySelector('.mpv-view-title')?.textContent).toBe('Filme Teste');
    });
});
