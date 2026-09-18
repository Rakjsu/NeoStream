import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appNotificationService } from './episodeNotificationService';

/**
 * D156 — a checagem de novos episodios (o sino) tem que falar com o provedor
 * pelo handler do main (`series:get-info`), nao por um `fetch()` cru do
 * renderer montado com `auth:get-credentials`.
 *
 * O `fetch()` cru:
 *  - nao passava pela certificatePolicy do main (provedor com certificado
 *    invalido que o app aceita em todo o resto falhava so aqui);
 *  - so falava Xtream (montava `player_api.php`), entao em M3U/Stalker o sino
 *    ficava permanentemente mudo;
 *  - trazia usuario e senha para dentro do renderer sem necessidade.
 *
 * `series:get-info` ja existe (electron/ipcHandlers.ts) e resolve os tres:
 * axios + resolveProviderHttpsAgent no Xtream, e a mesma forma
 * `{episodes: {...}}` montada da lista em M3U/Stalker. E o mesmo handler que
 * o ContentDetailModal consome.
 *
 * Ancoras: (a) o fetch global NAO pode ser chamado; (b) o canal e o PAYLOAD
 * da chamada; (c) a contagem que vira notificacao tem que sair do payload do
 * handler; e (d) uma resposta "deu certo" SEM nenhuma temporada nao pode
 * sobrescrever o total conhecido — e exatamente o caso que o
 * ContentDetailModal ja trata como erro (`series_id` posicional da M3U
 * deslocado, Stalker sem temporadas, painel que responde erro em HTTP 200) e
 * que aqui fabricaria um "Nova Temporada" falso na rodada seguinte.
 */

const CHAVE_TOTAIS = 'series_episode_data_default';
const CHAVE_NOTIFICACOES = 'app_notifications_default';

type RespostaInvoke = { success: boolean; info?: unknown; credentials?: unknown; error?: string };

const episodio = (n: number) => ({ id: n, episode_num: n, title: `Ep ${n}` });

/** Forma que o main devolve para uma serie com 3 temporadas / 30 episodios. */
function infoDoMain(cover?: string) {
    return {
        // Sem `info.cover` e exatamente a forma de M3U/Stalker, onde o poster
        // vem do proprio item monitorado.
        ...(cover ? { info: { cover } } : {}),
        episodes: {
            '1': Array.from({ length: 10 }, (_, i) => episodio(i + 1)),
            '2': Array.from({ length: 10 }, (_, i) => episodio(i + 11)),
            '3': Array.from({ length: 10 }, (_, i) => episodio(i + 21))
        }
    };
}

/** Forma que o provedor Xtream devolveria pelo fetch cru: 1 temporada / 10 eps. */
function infoDoFetchCru() {
    return {
        info: { cover: 'http://provedor/capa-do-fetch.jpg' },
        episodes: {
            '1': Array.from({ length: 10 }, (_, i) => episodio(i + 1))
        }
    };
}

function semearTotais(dados: { seasons: number; episodes: number; poster?: string }) {
    localStorage.setItem(CHAVE_TOTAIS, JSON.stringify({
        '77': {
            seriesId: '77',
            seriesName: 'Serie X',
            poster: dados.poster ?? 'capa.jpg',
            lastKnownSeasons: dados.seasons,
            lastKnownEpisodes: dados.episodes,
            lastChecked: '2026-01-01T00:00:00.000Z'
        }
    }));
}

function totaisGuardados() {
    return JSON.parse(localStorage.getItem(CHAVE_TOTAIS)!)['77'];
}

describe('D156 — o sino consulta o provedor pelo main, nao por fetch cru', () => {
    let chamadasInvoke: Array<[string, unknown]>;
    let canaisInvocados: string[];
    let fetchSpy: ReturnType<typeof vi.fn>;

    const monitorar = (series: Array<{ id: string; name: string; poster: string }>) => {
        const svc = appNotificationService as unknown as {
            getSeriesToMonitor: () => Promise<Array<{ id: string; name: string; poster: string }>>;
        };
        vi.spyOn(svc, 'getSeriesToMonitor').mockResolvedValue(series);
    };

    /** Pendura a ponte IPC no window do jsdom (sem trocar o window inteiro). */
    const pendurarIpc = (resposta: (canal: string, payload: unknown) => Promise<RespostaInvoke>) => {
        const invoke = vi.fn(async (canal: string, payload?: unknown) => {
            chamadasInvoke.push([canal, payload]);
            canaisInvocados.push(canal);
            return resposta(canal, payload);
        });
        (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
        return invoke;
    };

    beforeEach(() => {
        localStorage.clear();
        chamadasInvoke = [];
        canaisInvocados = [];

        // Um fetch cru do renderer e o defeito: se ele for chamado, o teste
        // acusa. Ele responde o que o provedor Xtream responderia, para o
        // caminho antigo nao quebrar por acidente — quem reprova e a
        // assercao, nao um erro de rede.
        fetchSpy = vi.fn(async () => ({
            ok: true,
            json: async () => infoDoFetchCru()
        }));
        vi.stubGlobal('fetch', fetchSpy);

        pendurarIpc(async (canal) => {
            if (canal === 'series:get-info') return { success: true, info: infoDoMain() };
            if (canal === 'auth:get-credentials') {
                return {
                    success: true,
                    credentials: { url: 'http://provedor', username: 'u', password: 'p' }
                };
            }
            return { success: false, error: `canal inesperado: ${canal}` };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
        localStorage.clear();
    });

    it('nao dispara nenhum fetch do renderer — a consulta vai por series:get-info', async () => {
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa.jpg' }]);

        await appNotificationService.checkForNewEpisodes();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(canaisInvocados).toContain('series:get-info');
    });

    it('chama series:get-info com o seriesId da serie monitorada no payload', async () => {
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa.jpg' }]);

        await appNotificationService.checkForNewEpisodes();

        // O handler le `{ seriesId }`: outra chave (ou outro id) faz o main
        // consultar `undefined` e devolver sempre zero temporada.
        const chamada = chamadasInvoke.find(([canal]) => canal === 'series:get-info');
        expect(chamada?.[1]).toEqual({ seriesId: '77' });
    });

    it('nao pede as credenciais ao main (usuario e senha nao entram no renderer)', async () => {
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa.jpg' }]);

        await appNotificationService.checkForNewEpisodes();

        expect(canaisInvocados).not.toContain('auth:get-credentials');
    });

    it('a contagem da notificacao sai do payload do main, nao do fetch', async () => {
        // Baseline: 1 temporada / 10 episodios ja conhecidos.
        semearTotais({ seasons: 1, episodes: 10 });
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa.jpg' }]);

        const novas = await appNotificationService.checkForNewEpisodes();

        // O main diz 3 temporadas / 30 episodios; o fetch cru diria 1 / 10
        // (= baseline, nada novo). Se a notificacao existe e fala em 2 novas
        // temporadas, a fonte foi o handler.
        expect(novas).toHaveLength(1);
        expect(novas[0].type).toBe('new_season');
        expect(novas[0].meta?.newSeasons).toBe(2);
        expect(novas[0].meta?.newEpisodes).toBe(20);

        // E o total guardado tambem e o do main.
        expect(totaisGuardados().lastKnownSeasons).toBe(3);
        expect(totaisGuardados().lastKnownEpisodes).toBe(30);
    });

    it('usa a capa do payload do main quando ele manda info.cover (Xtream)', async () => {
        pendurarIpc(async (canal) => canal === 'series:get-info'
            ? { success: true, info: infoDoMain('http://provedor/capa-do-main.jpg') }
            : { success: false, error: 'canal inesperado' });
        semearTotais({ seasons: 3, episodes: 25 });
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa-local.jpg' }]);

        const novas = await appNotificationService.checkForNewEpisodes();

        expect(novas).toHaveLength(1);
        expect(novas[0].poster).toBe('http://provedor/capa-do-main.jpg');
    });

    it('poster do payload sem info.cover (M3U/Stalker) cai no poster monitorado', async () => {
        semearTotais({ seasons: 3, episodes: 25 });
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa-local.jpg' }]);

        const novas = await appNotificationService.checkForNewEpisodes();

        expect(novas).toHaveLength(1);
        expect(novas[0].type).toBe('new_episodes');
        // Nao pode vir a capa que so o fetch cru conhecia.
        expect(novas[0].poster).toBe('capa-local.jpg');
    });

    it('handler que responde erro nao gera notificacao, nao apaga o total nem quebra a rodada', async () => {
        // `success: false` manda ignorar o resto da resposta. Vem com `info`
        // junto de proposito: um painel que responde erro em HTTP 200, ou uma
        // resposta de erro que carrega payload velho, nao pode virar
        // "episodio novo". E o `success` que decide, nao a presenca do `info`.
        const erroNoConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
        pendurarIpc(async () => ({ success: false, error: 'Not authenticated', info: infoDoMain() }));
        semearTotais({ seasons: 1, episodes: 10 });
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa.jpg' }]);

        const novas = await appNotificationService.checkForNewEpisodes();

        expect(novas).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(localStorage.getItem(CHAVE_NOTIFICACOES)).toBeNull();
        // O total conhecido continua de pe: zerar aqui fabricaria "3 novas
        // temporadas" na rodada seguinte.
        expect(totaisGuardados().lastKnownSeasons).toBe(1);
        expect(totaisGuardados().lastKnownEpisodes).toBe(10);
        // E a saida tem que ser pela guarda, nao por excecao engolida pelo
        // catch — senao um "nao autenticado" comum vira log de erro.
        expect(erroNoConsole).not.toHaveBeenCalled();
    });

    it('resposta "deu certo" com ZERO temporada nao zera o total nem fabrica temporada nova depois', async () => {
        // O caso que o ContentDetailModal ja trata como erro: `series_id`
        // posicional da M3U deslocado, Stalker sem temporadas, ou painel que
        // responde erro em HTTP 200. O payload chega `{ episodes: {} }`.
        let rodada = 0;
        pendurarIpc(async (canal) => {
            if (canal !== 'series:get-info') return { success: false, error: 'canal inesperado' };
            rodada += 1;
            return rodada === 1
                ? { success: true, info: { episodes: {} } }
                : { success: true, info: infoDoMain() };
        });
        semearTotais({ seasons: 3, episodes: 30 });
        monitorar([{ id: '77', name: 'Serie X', poster: 'capa.jpg' }]);

        const vazia = await appNotificationService.checkForNewEpisodes();

        expect(vazia).toEqual([]);
        // Sem guarda, o total viraria 0/0 aqui.
        expect(totaisGuardados().lastKnownSeasons).toBe(3);
        expect(totaisGuardados().lastKnownEpisodes).toBe(30);

        // Rodada seguinte, provedor normal de novo: nada mudou de verdade,
        // entao o sino tem que ficar calado.
        const depois = await appNotificationService.checkForNewEpisodes();

        expect(depois).toEqual([]);
        expect(localStorage.getItem(CHAVE_NOTIFICACOES)).toBeNull();
    });
});
