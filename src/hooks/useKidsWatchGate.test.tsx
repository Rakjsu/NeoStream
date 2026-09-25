import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { isWatchBlockedNow } from '../services/watchGateService';
import { useChromecast, type ChromecastDevice } from './useChromecast';
import { useAirPlay, type AirPlayDevice } from './useAirPlay';
import { useDLNA, type DLNADevice } from './useDLNA';
import { mpvService } from '../services/mpvService';
import { MultiView } from '../components/MultiView';
import { PipWindow } from '../pages/PipWindow';

/**
 * ⏰ A trava de tempo de tela valia só pro player interno (D161).
 *
 * A regra — limite diário de tela e janela de horário do perfil infantil —
 * nasceu DENTRO do `VideoPlayer`. Só que o player interno não é o único jeito
 * de assistir:
 *
 *   - o PiP abre uma BrowserWindow própria que monta a `PipWindow` com
 *     `useHls` dela mesma;
 *   - o mosaico (`MultiView`) monta um `<video>` + hls.js por célula;
 *   - o MPV toca num PROCESSO à parte, fora do DOM (nenhum overlay o alcança);
 *   - o cast joga o stream direto no aparelho da sala.
 *
 * Nenhum dos quatro passava pela trava: a criança que estourou o limite só
 * precisava mandar o vídeo pro PiP, abrir o multi-view, ligar o MPV nas
 * Configurações ou mandar pra TV pra seguir assistindo a noite inteira.
 *
 * Estes casos montam as superfícies de VERDADE, com o perfil infantil fora da
 * janela de horário, e observam o que a criança observaria: o mosaico não
 * monta `<video>` nenhum, o vídeo do PiP volta pro pausado mesmo quando alguém
 * manda `play`, o `mpv:play` não sai e o `cast:play` não sai.
 */

const PERFIL_KIDS = {
    id: 'kid1',
    name: 'Bento',
    avatar: '🧒',
    isKids: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsed: '2026-01-01T00:00:00.000Z',
};

/** Janela de horário que com certeza NÃO contém a hora atual. */
function janelaFechadaAgora(): string {
    const h = new Date().getHours();
    return `${(h + 2) % 24}-${(h + 3) % 24}`;
}

/** Janela de horário que com certeza CONTÉM a hora atual. */
function janelaAbertaAgora(): string {
    const h = new Date().getHours();
    return `${h}-${(h + 1) % 24}`;
}

function ativarPerfilKids(): void {
    localStorage.setItem(
        'neostream_profiles',
        JSON.stringify({ profiles: [PERFIL_KIDS], activeProfileId: 'kid1' }),
    );
}

const CANAIS = [{ id: 7, name: 'Canal Sete' }];

/**
 * A trava, o parse do conteúdo do PiP e o `loadDevices` do mosaico entram por
 * `queueMicrotask`/promessa; estes turnos extras são o que deixam os efeitos
 * virarem render dentro do `act`.
 */
async function assentar(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}

let container: HTMLDivElement;
let root: Root;
let pauseSpy: ReturnType<typeof vi.spyOn>;
let playSpy: ReturnType<typeof vi.spyOn>;
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();

    // jsdom não implementa play()/pause() de <video>. O `play` falso dispara o
    // evento (é o gatilho da trava) e o `pause` falso é o que se observa.
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
    });
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    // Ponte do Electron: NÃO trocamos o `window` inteiro do jsdom — só
    // penduramos a ponte nele.
    invoke = vi.fn().mockResolvedValue({ success: true, url: 'http://prov.tv/live/7.mp4' });
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke,
        on: vi.fn(),
        off: vi.fn(),
        send: vi.fn(),
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
    localStorage.clear();
});

describe('isWatchBlockedNow: a decisão saiu de dentro do VideoPlayer', () => {
    it('perfil kids fora da janela de horário está bloqueado', () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaFechadaAgora());
        expect(isWatchBlockedNow()).toBe(true);
    });

    it('perfil kids DENTRO da janela não está bloqueado', () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaAbertaAgora());
        expect(isWatchBlockedNow()).toBe(false);
    });

    it('limite diário estourado bloqueia, mesmo sem janela de horário', () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_daily_limit_min', '60');
        const hoje = new Date();
        const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
        localStorage.setItem('usage_stats_kid1', JSON.stringify({
            totalWatchTimeSeconds: 3600,
            totalWatchTimeThisMonth: 3600,
            sessionsThisMonth: [],
            contentBreakdown: { movies: 0, series: 0, live: 0 },
            watchStreak: 1,
            longestStreak: 1,
            dailyStats: [{ date: dia, totalSeconds: 3600, movies: 1, series: 0, live: 0 }],
            lastWatchDate: dia,
        }));
        expect(isWatchBlockedNow()).toBe(true);
    });

    it('limite diário NÃO estourado (59 de 60 min) libera', () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_daily_limit_min', '60');
        const hoje = new Date();
        const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
        localStorage.setItem('usage_stats_kid1', JSON.stringify({
            totalWatchTimeSeconds: 3540,
            totalWatchTimeThisMonth: 3540,
            sessionsThisMonth: [],
            contentBreakdown: { movies: 0, series: 0, live: 0 },
            watchStreak: 1,
            longestStreak: 1,
            dailyStats: [{ date: dia, totalSeconds: 3540, movies: 1, series: 0, live: 0 }],
            lastWatchDate: dia,
        }));
        expect(isWatchBlockedNow()).toBe(false);
    });

    it('perfil ADULTO com limite proprio estourado tambem e bloqueado', () => {
        // O buraco nao e so do perfil infantil: `effectiveDailyLimitMinutes`
        // devolve o limite ESPECIFICO do perfil antes de olhar o `isKids`.
        // O adulto que se impôs um limite escapava pelo PiP/mosaico/MPV/cast
        // exatamente como a criança.
        localStorage.setItem(
            'neostream_profiles',
            JSON.stringify({
                profiles: [{ ...PERFIL_KIDS, id: 'adulto1', name: 'Eu', isKids: false }],
                activeProfileId: 'adulto1',
            }),
        );
        localStorage.setItem('neostream_profile_daily_limit_min_adulto1', '30');
        const hoje = new Date();
        const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
        localStorage.setItem('usage_stats_adulto1', JSON.stringify({
            totalWatchTimeSeconds: 3600,
            totalWatchTimeThisMonth: 3600,
            sessionsThisMonth: [],
            contentBreakdown: { movies: 0, series: 0, live: 0 },
            watchStreak: 1,
            longestStreak: 1,
            dailyStats: [{ date: dia, totalSeconds: 3600, movies: 1, series: 0, live: 0 }],
            lastWatchDate: dia,
        }));
        expect(isWatchBlockedNow()).toBe(true);
    });

    it('sem perfil ativo não bloqueia nada', () => {
        localStorage.setItem('neostream_kids_allowed_hours', janelaFechadaAgora());
        expect(isWatchBlockedNow()).toBe(false);
    });
});

describe('MultiView: o mosaico também respeita a trava', () => {
    async function montarMosaico(): Promise<void> {
        await act(async () => {
            root.render(
                <MultiView channels={CANAIS} initialChannelId={7} onClose={() => undefined} />,
            );
        });
        await assentar();
    }

    it('perfil kids fora do horário NÃO monta nenhum <video>', async () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaFechadaAgora());

        await montarMosaico();

        expect(container.querySelectorAll('video').length).toBe(0);
        expect(container.querySelector('[data-testid="multiview-kids-gate"]')).not.toBeNull();
    });

    it('dentro do horário o mosaico monta o <video> da célula normalmente', async () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaAbertaAgora());

        await montarMosaico();

        expect(container.querySelectorAll('video').length).toBe(1);
        expect(container.querySelector('[data-testid="multiview-kids-gate"]')).toBeNull();
    });
});

describe('PipWindow: a janela de PiP também respeita a trava', () => {
    const CONTEUDO = encodeURIComponent(JSON.stringify({
        src: 'http://prov.tv/movie/u/p/42.mp4',
        title: 'Filme de teste',
        contentId: '42',
        contentType: 'movie',
    }));

    async function montarPip(): Promise<void> {
        await act(async () => {
            root.render(
                <MemoryRouter initialEntries={[`/pip?data=${CONTEUDO}`]}>
                    <PipWindow />
                </MemoryRouter>,
            );
        });
        await assentar();
    }

    it('perfil kids fora do horário: o vídeo é pausado e o play seguinte não pega', async () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaFechadaAgora());

        await montarPip();

        const video = container.querySelector('video');
        expect(video).not.toBeNull();

        pauseSpy.mockClear();
        // Alguém manda tocar (o auto-play do PiP, o botão de play): a trava tem
        // que empurrar de volta pro pausado. É ISTO que hoje não acontece.
        await act(async () => { await video!.play(); });
        expect(pauseSpy).toHaveBeenCalled();

        expect(container.querySelector('[data-testid="pip-kids-gate"]')).not.toBeNull();
    });

    it('dentro do horário o PiP não mostra a trava nem pausa o vídeo', async () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaAbertaAgora());

        await montarPip();

        const video = container.querySelector('video');
        expect(video).not.toBeNull();

        pauseSpy.mockClear();
        await act(async () => { await video!.play(); });
        expect(pauseSpy).not.toHaveBeenCalled();

        expect(container.querySelector('[data-testid="pip-kids-gate"]')).toBeNull();
    });
});

describe('MPV: o processo externo não recebe o play', () => {
    it('bloqueado, mpvService.play recusa e o canal mpv:play nem sai', async () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaFechadaAgora());

        const resultado = await mpvService.play('http://prov.tv/movie/u/p/42.mp4', 'Filme');

        expect(resultado.success).toBe(false);
        expect(invoke.mock.calls.some(c => c[0] === 'mpv:play')).toBe(false);
    });

    it('liberado, o mpv:play sai normalmente', async () => {
        ativarPerfilKids();
        localStorage.setItem('neostream_kids_allowed_hours', janelaAbertaAgora());
        invoke.mockResolvedValue({ success: true });

        const resultado = await mpvService.play('http://prov.tv/movie/u/p/42.mp4', 'Filme');

        expect(resultado.success).toBe(true);
        expect(invoke.mock.calls.some(c => c[0] === 'mpv:play')).toBe(true);
    });
});

describe('Cast: o aparelho da sala não recebe o play', () => {
    const CHROMECAST: ChromecastDevice = {
        id: 'cc1', name: 'TV da sala', type: 'chromecast',
        host: '192.168.0.10', model: 'Chromecast', available: true,
    };
    const AIRPLAY: AirPlayDevice = {
        id: 'ap1', name: 'Apple TV', type: 'airplay',
        host: '192.168.0.11', port: 7000, model: 'AppleTV', available: true,
    };
    const DLNA: DLNADevice = {
        id: 'dl1', name: 'Smart TV', type: 'dlna',
        host: '192.168.0.12', source: 'discovered', online: true,
    };

    type Saida = { castar?: () => Promise<boolean | undefined> };

    /** Expõe o `castToDevice` de cada hook de cast montado de verdade. */
    function PonteDeCast({ alvo, saida }: { alvo: 'chromecast' | 'airplay' | 'dlna'; saida: Saida }) {
        const chromecast = useChromecast('http://prov.tv/movie/u/p/42.mp4', 'Filme');
        const airplay = useAirPlay('http://prov.tv/movie/u/p/42.mp4', 'Filme');
        const dlna = useDLNA('http://prov.tv/movie/u/p/42.mp4', 'Filme');
        const ref = useRef(saida);
        ref.current.castar = alvo === 'chromecast'
            ? () => chromecast.castToDevice(CHROMECAST)
            : alvo === 'airplay'
                ? () => airplay.castToDevice(AIRPLAY)
                : () => dlna.castToDevice(DLNA);
        return null;
    }

    async function montarPonte(alvo: 'chromecast' | 'airplay' | 'dlna'): Promise<Saida> {
        const saida: Saida = {};
        await act(async () => { root.render(<PonteDeCast alvo={alvo} saida={saida} />); });
        await assentar();
        return saida;
    }

    // Os três transportes têm o MESMO contrato (`castToDevice` -> boolean) e a
    // mesma porta de saída por IPC; a trava tem que valer nos três.
    const TRANSPORTES = [
        ['chromecast', 'cast:play'],
        ['airplay', 'airplay:cast'],
        ['dlna', 'dlna:cast'],
    ] as const;

    for (const [alvo, canal] of TRANSPORTES) {
        it(`${alvo}: bloqueado, o ${canal} nem sai`, async () => {
            ativarPerfilKids();
            localStorage.setItem('neostream_kids_allowed_hours', janelaFechadaAgora());

            const saida = await montarPonte(alvo);
            invoke.mockClear();
            let ok: boolean | undefined = true;
            await act(async () => { ok = await saida.castar!(); });

            expect(ok).toBe(false);
            expect(invoke.mock.calls.some(c => c[0] === canal)).toBe(false);
        });

        it(`${alvo}: liberado, o ${canal} sai normalmente`, async () => {
            ativarPerfilKids();
            localStorage.setItem('neostream_kids_allowed_hours', janelaAbertaAgora());

            const saida = await montarPonte(alvo);
            invoke.mockClear();
            invoke.mockResolvedValue({ success: true });
            let ok: boolean | undefined = false;
            await act(async () => { ok = await saida.castar!(); });

            expect(ok).toBe(true);
            expect(invoke.mock.calls.some(c => c[0] === canal)).toBe(true);
        });
    }
});
