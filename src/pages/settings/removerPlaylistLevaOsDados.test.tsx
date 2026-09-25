import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlaylistsSection } from './PlaylistsSection';
import { languageService } from '../../services/languageService';
import { playlistService } from '../../services/playlistService';
import { mergeSyncData } from '../../services/syncMerge';
import { remapPlaylistScopedKeys, semEscopoDasRecusadas } from '../../services/playlistIdRemap';
import fonteDoApp from '../../App.tsx?raw';

/**
 * 🗑️ D088 — apagar uma playlist tem de levar junto o estado do usuário
 * escopado nela (`<base>_<perfil>__pl_<id>`: favoritos, Minha Lista,
 * progresso, canais ocultos...). O `playlists:remove` limpa só o lado do main
 * (catálogo, documento M3U, EPG) e a tela só recarregava: as chaves ficavam no
 * disco pra sempre.
 *
 * E o SYNC é a segunda metade: a outra máquina continua listando a playlist
 * (com o id DE LÁ). O import recusa a apagada (ledger `removedPlaylists`), não
 * devolve par pra ela, e o `mergeSyncData` adotava `__pl_<idDeLá>` como dado
 * morto — que viajava de volta no arquivo desta máquina e, quando a outra
 * também apagava a playlist, ressuscitava lá com o id dela. Apagar nas duas
 * deixava o dado no disco das duas.
 *
 * Só o `window.ipcRenderer` é trocado (nada de trocar o window inteiro).
 */

const REMOVIDA = 'pl_k1a2b3_abc123';
// Tem a removida como PREFIXO: casar por `startsWith`/`includes` levaria esta.
const VIZINHA = 'pl_k1a2b3_abc1234';
// Tem a removida como SUFIXO sem o separador: casar só por `endsWith(id)` levaria esta.
const SUFIXADA = `x${REMOVIDA}`;

/** O estado de uma playlist do jeito que os serviços gravam (dois perfis). */
function estadoDa(playlistId: string, marca: number): Record<string, string> {
    return {
        [`neostream_profile_p1__pl_${playlistId}`]: JSON.stringify({ favorites: [{ id: marca, type: 'movie' }] }),
        [`neostream_profile_p2__pl_${playlistId}`]: JSON.stringify({ favorites: [{ id: marca + 1, type: 'series' }] }),
        [`movie_watch_progress_p1__pl_${playlistId}`]: JSON.stringify([{ movieId: String(marca), watchedAt: 1 }]),
        [`series_watch_progress_p1__pl_${playlistId}`]: JSON.stringify([{ seriesId: '5', seasonNumber: 1, episodeNumber: 1, watchedAt: 1 }]),
        [`neostream_hidden_channels_p1__pl_${playlistId}`]: JSON.stringify(['c1']),
        [`neostream_watchlater_p1__pl_${playlistId}`]: JSON.stringify([{ id: marca, type: 'movie' }]),
    };
}

/** Tudo que NÃO é da removida e tem de sobreviver intacto. */
function intactas(): Record<string, string> {
    return {
        ...estadoDa(VIZINHA, 70),
        [`neostream_profile_p1__pl_${SUFIXADA}`]: JSON.stringify({ favorites: [{ id: 80, type: 'movie' }] }),
        // balde da corrida de boot (`default`) não é de playlist nenhuma
        'neostream_profile_p1__pl_default': JSON.stringify({ favorites: [] }),
        // chaves sem escopo de playlist
        'neostream_profiles': JSON.stringify({ profiles: [], activeProfileId: 'p1' }),
        'neostream_theme': 'dark',
        'neostream_active_playlist_id': VIZINHA,
    };
}

function semear(): Record<string, string> {
    const sobreviventes = intactas();
    for (const [k, v] of Object.entries({ ...estadoDa(REMOVIDA, 1), ...sobreviventes })) localStorage.setItem(k, v);
    return sobreviventes;
}

function chavesDa(playlistId: string, storage: Record<string, string> | Storage = localStorage): string[] {
    const chaves = storage instanceof Storage
        ? Array.from({ length: storage.length }, (_, i) => storage.key(i) as string)
        : Object.keys(storage);
    return chaves.filter(k => k.endsWith(`__pl_${playlistId}`)).sort();
}

function snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) as string;
        out[k] = localStorage.getItem(k) as string;
    }
    return out;
}

function trocarIpc(handlers: Record<string, (payload?: unknown) => unknown>) {
    const invoke = vi.fn(async (canal: string, payload?: unknown) => {
        const h = handlers[canal];
        return h ? h(payload) : { success: false };
    });
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() };
    return invoke;
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    vi.restoreAllMocks();
});

describe('D088 — playlistService.remove leva o estado escopado na playlist', () => {
    it('com o main confirmando, some tudo da removida (todos os perfis) e mais nada', async () => {
        const sobreviventes = semear();
        trocarIpc({ 'playlists:remove': () => ({ success: true, loggedOut: false, newActiveId: null }) });

        const res = await playlistService.remove(REMOVIDA);

        expect(res.success).toBe(true);
        expect(chavesDa(REMOVIDA)).toEqual([]);
        expect(snapshot()).toEqual(sobreviventes);
    });

    it('remoção recusada pelo main não apaga nada', async () => {
        semear();
        const antes = snapshot();
        trocarIpc({ 'playlists:remove': () => ({ success: false, error: 'Playlist not found' }) });

        const res = await playlistService.remove(REMOVIDA);

        expect(res.success).toBe(false);
        expect(snapshot()).toEqual(antes);
    });

    it('IPC que rejeita também não apaga nada', async () => {
        semear();
        const antes = snapshot();
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
            invoke: () => Promise.reject(new Error('ipc morto')),
        };

        await expect(playlistService.remove(REMOVIDA)).rejects.toThrow('ipc morto');
        expect(snapshot()).toEqual(antes);
    });
});

describe('D088 — na TELA: Configurações → Playlists → Remover', () => {
    let container: HTMLDivElement;
    let root: Root;

    async function esperar(condicao: () => boolean, descricao: string, prazoMs = 3000): Promise<void> {
        const fim = Date.now() + prazoMs;
        while (!condicao()) {
            if (Date.now() > fim) throw new Error(`a condição nunca aconteceu: ${descricao}`);
            await act(async () => { await new Promise(r => setTimeout(r, 5)); });
        }
    }

    const rotulo = (chave: string) => languageService.t('playlists', chave);

    function botaoDaRemovida(): HTMLButtonElement | undefined {
        return Array.from(container.querySelectorAll('button'))
            .find(b => b.classList.contains('playlists-btn-danger')) as HTMLButtonElement | undefined;
    }

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('confirmar a remoção de uma playlist que não é a ativa apaga o estado dela', async () => {
        const sobreviventes = semear();
        let lista = [{ id: REMOVIDA, name: 'Casa', url: 'http://a.tv', username: 'u', active: false, type: 'xtream' }];
        const invoke = trocarIpc({
            'playlists:list': () => ({ success: true, playlists: lista }),
            'playlists:remove': () => {
                lista = [];
                return { success: true, loggedOut: false, newActiveId: null };
            },
        });

        await act(async () => { root.render(<PlaylistsSection />); });
        await esperar(() => botaoDaRemovida() !== undefined, 'a playlist aparecer na lista');

        const botao = botaoDaRemovida() as HTMLButtonElement;
        expect(botao.textContent).toBe(rotulo('remove'));
        await act(async () => { botao.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(botaoDaRemovida()?.textContent).toBe(rotulo('confirmRemove'));
        expect(chavesDa(REMOVIDA).length).toBe(6); // o 1º clique só pede confirmação
        await act(async () => { (botaoDaRemovida() as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });

        await esperar(() => botaoDaRemovida() === undefined, 'a lista recarregar sem a playlist');
        expect(invoke.mock.calls.filter(([c]) => c === 'playlists:remove')).toEqual([['playlists:remove', { id: REMOVIDA }]]);
        expect(chavesDa(REMOVIDA)).toEqual([]);
        expect(snapshot()).toEqual(sobreviventes);
    });
});

describe('D088 — o sync não devolve o escopo da playlist apagada', () => {
    const ID_LA = 'pl_remota_zz9';

    it('tira do arquivo o escopo de playlist listada no arquivo e recusada aqui', () => {
        const doArquivo = { ...estadoDa(ID_LA, 1), ...estadoDa('pl_outra_la', 20), neostream_theme: 'dark' };

        const limpo = semEscopoDasRecusadas(
            doArquivo,
            [{ id: ID_LA }, { id: 'pl_outra_la' }],
            { pl_outra_la: 'pl_outra_aqui' }, // a outra tem par; a de lá (apagada aqui) não
        );

        expect(chavesDa(ID_LA, limpo)).toEqual([]);
        expect(limpo).toEqual({ ...estadoDa('pl_outra_la', 20), neostream_theme: 'dark' });
    });

    it('sem resposta do import (idMap ausente) não tira nada — recusa e falha não se distinguem', () => {
        const doArquivo = { ...estadoDa(ID_LA, 1), neostream_theme: 'dark' };
        expect(semEscopoDasRecusadas(doArquivo, [{ id: ID_LA }], undefined)).toEqual(doArquivo);
    });

    it('chave de playlist que o arquivo NÃO lista, e entrada sem id, passam intactas', () => {
        const doArquivo = { ...estadoDa('pl_nao_listada', 1), ...estadoDa(`x${ID_LA}`, 5) };
        expect(semEscopoDasRecusadas(doArquivo, [{ id: ID_LA }, {}], {})).toEqual(doArquivo);
    });

    it('apagar nas duas máquinas não deixa o dado no disco de nenhuma (sem ping-pong)', async () => {
        // A e B têm a MESMA playlist, cada uma com o seu id.
        const A = { ...estadoDa(REMOVIDA, 1) };
        const B = { ...estadoDa(ID_LA, 1) };

        /** Um ciclo do sync em `aqui`, lendo o arquivo de `la` (mesma ordem do App.tsx). */
        function ciclo(
            aqui: Record<string, string>,
            la: Record<string, string>,
            playlistsDeLa: { id?: string }[],
            idMap: Record<string, string>,
        ) {
            const doArquivo = semEscopoDasRecusadas(la, playlistsDeLa, idMap);
            const { changed } = mergeSyncData(aqui, remapPlaylistScopedKeys(doArquivo, idMap));
            Object.assign(aqui, changed);
        }

        // 1) A apaga a playlist (o main confirma) e roda a faxina no próprio storage.
        for (const [k, v] of Object.entries(A)) localStorage.setItem(k, v);
        trocarIpc({ 'playlists:remove': () => ({ success: true, loggedOut: false, newActiveId: null }) });
        await playlistService.remove(REMOVIDA);
        const depoisDeApagar = snapshot();
        for (const k of Object.keys(A)) delete A[k];
        Object.assign(A, depoisDeApagar);

        // 2) Ciclo em A: B ainda lista a playlist; o import recusa (ledger) → sem par.
        ciclo(A, B, [{ id: ID_LA }], {});
        // 3) B também apaga a playlist.
        for (const k of chavesDa(ID_LA, B)) delete B[k];
        // 4) Ciclo em B lendo o arquivo de A (que já não lista a playlist).
        ciclo(B, A, [], {});

        expect(chavesDa(REMOVIDA, A)).toEqual([]);
        expect(chavesDa(ID_LA, A)).toEqual([]); // A não adotou o escopo de lá...
        expect(chavesDa(ID_LA, B)).toEqual([]); // ...e por isso B não o recebe de volta
    });

    // 🔒 A PORTA: o handler do sync no App.tsx é código de módulo que nenhum
    // teste monta (molde de electron/identidadeDaPlaylistNoBackup.test.ts).
    // Tirar a faxina, trocar a ordem ou passar o `idMap` já com `?? {}` (que
    // faria uma falha do import apagar o escopo de TODA playlist do arquivo)
    // deixaria o resto da suíte verde.
    it('o sync do App.tsx passa o arquivo pela faxina, com a resposta crua do import, antes do remap', () => {
        // Os fontes são CRLF; normalizar antes de procurar.
        const fonte = fonteDoApp.split('\r\n').join('\n');
        const faxina = /(\w+)\s*=\s*semEscopoDasRecusadas\(\s*parsed\.data\s*,\s*playlists\s*,\s*res\?\.idMap\s*\)/.exec(fonte);
        expect(faxina, 'a faxina sumiu do sync ou mudou de argumentos').not.toBeNull();
        const variavel = (faxina as RegExpExecArray)[1];
        const merge = new RegExp(`mergeSyncData\\(\\s*\\w+\\s*,\\s*remapPlaylistScopedKeys\\(\\s*${variavel}\\s*,\\s*idMap\\s*\\)\\s*\\)`).exec(fonte);
        expect(merge, 'o merge não recebe o arquivo já sem o escopo das recusadas').not.toBeNull();
        expect((faxina as RegExpExecArray).index).toBeLessThan((merge as RegExpExecArray).index);
        expect(new RegExp(`let\\s+${variavel}\\s*=\\s*parsed\\.data\\s*;`).test(fonte)).toBe(true);
    });
});
