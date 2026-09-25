import { describe, it, expect, vi, beforeAll } from 'vitest';
import { STALKER_SENTINEL } from './stalkerProtocol';
import { ehPortalStalker, urlDoCanalAoVivoSemPortal, SENTINELA_STALKER, type CredenciaisDoProvedor } from '../src/services/urlDoCanalAoVivo';

/**
 * (#D175) A regra de URL da TV ao vivo saiu de dentro do `buildLiveStreamUrl`
 * pra ser dividida com a sonda "🩺 Verificar favoritos". O player continua
 * com o MESMO comportamento de antes; estes casos travam essa regra. Mora em
 * electron/ porque confere a sentinela do renderer contra a do main — e o
 * `auth:get-credentials` DE VERDADE: é pela resposta dele que o renderer
 * decide que a lista é um portal Stalker e não gasta create_link na sonda.
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Handler) => { h.handlers.set(canal, fn); },
        on: () => undefined,
        removeHandler: () => undefined,
    },
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null, fromWebContents: () => null },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    screen: {},
    shell: {},
    session: {},
    app: {
        getPath: () => '',
        getVersion: () => '0.0.0',
        getName: () => 'neostream',
        on: () => undefined,
        whenReady: () => new Promise(() => undefined),
        isReady: () => true,
    },
}));
vi.mock('./store', () => {
    const dados = new Map<string, unknown>([['auth', {}], ['playlists', []], ['settings', {}]]);
    return {
        default: {
            get: (chave: string) => dados.get(chave),
            set: (chave: string, valor: unknown) => { dados.set(chave, valor); },
            delete: (chave: string) => { dados.delete(chave); },
        },
    };
});
vi.mock('./logger', () => ({
    default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}));
vi.mock('./mpvPlayer', () => ({ esconderMpvParaDialogo: () => undefined }));
vi.mock('./providerEpg', () => ({
    ensureProviderEpgLoaded: () => undefined,
    getProviderUtcOffsetMinutes: () => 0,
    resetProviderEpgState: () => undefined,
    setupProviderEpgHandlers: () => undefined,
}));
vi.mock('./catalogCache', () => ({
    cachedCatalogFetch: async (_id: string, _kind: string, fetcher: () => Promise<unknown>) =>
        ({ data: await fetcher(), fromCache: false }),
    invalidatePlaylistCache: () => undefined,
}));

import { setupIpcHandlers } from './ipcHandlers';
import { saveAndActivatePlaylist } from './playlistManager';

const XTREAM = { url: 'http://prov.example', username: 'u', password: 'p' };
const M3U = { url: 'http://lista.example/tv.m3u', username: 'm3u', password: 'm3u' };
const STALKER = { url: 'http://portal.example/c/', username: 'AA:BB:CC:DD:EE:FF', password: STALKER_SENTINEL };

describe('urlDoCanalAoVivoSemPortal (#D175)', () => {
    it('Xtream: forma clássica /live/usuário/senha/id.m3u8, mesmo com direct_source preenchido', () => {
        expect(urlDoCanalAoVivoSemPortal(XTREAM, { stream_id: 7, direct_source: '' })).toBe('http://prov.example/live/u/p/7.m3u8');
        expect(urlDoCanalAoVivoSemPortal(XTREAM, { stream_id: 7, direct_source: 'http://outro/7.ts' })).toBe('http://prov.example/live/u/p/7.m3u8');
    });

    it('M3U: a URL de reprodução vem no próprio canal; sem http no canal, cai na forma clássica (como antes)', () => {
        expect(urlDoCanalAoVivoSemPortal(M3U, { stream_id: 3, direct_source: 'https://cdn.example/3.m3u8' })).toBe('https://cdn.example/3.m3u8');
        expect(urlDoCanalAoVivoSemPortal(M3U, { stream_id: 3, direct_source: 'rtmp://cdn.example/3' })).toBe('http://lista.example/tv.m3u/live/m3u/m3u/3.m3u8');
    });

    it('Stalker com cmd: null — a URL só nasce de um create_link no portal', () => {
        expect(urlDoCanalAoVivoSemPortal(STALKER, { stream_id: 1, direct_source: 'ffrt http://localhost/ch/1' })).toBeNull();
    });

    it('Stalker SEM cmd: a forma clássica, como o player sempre fez', () => {
        expect(urlDoCanalAoVivoSemPortal(STALKER, { stream_id: 1, direct_source: '' }))
            .toBe(`http://portal.example/c//live/AA:BB:CC:DD:EE:FF/${STALKER_SENTINEL}/1.m3u8`);
    });

    it('a sentinela do renderer é a mesma do main (electron/stalkerProtocol.ts)', () => {
        expect(SENTINELA_STALKER).toBe(STALKER_SENTINEL);
        expect(ehPortalStalker(STALKER)).toBe(true);
        expect(ehPortalStalker(XTREAM)).toBe(false);
        expect(ehPortalStalker(M3U)).toBe(false);
    });
});

describe('auth:get-credentials entrega ao renderer o que ele precisa pra reconhecer o portal Stalker (#D175)', () => {
    beforeAll(() => { setupIpcHandlers(); });

    async function credenciais(): Promise<CredenciaisDoProvedor> {
        const fn = h.handlers.get('auth:get-credentials');
        if (!fn) throw new Error('canal auth:get-credentials não registrado');
        const r = await fn({}) as { success: boolean; credentials?: CredenciaisDoProvedor };
        expect(r.success).toBe(true);
        if (!r.credentials) throw new Error('auth:get-credentials sem credentials');
        return r.credentials;
    }

    it('playlist Stalker ativa: o renderer a vê como portal (sonda não gasta create_link)', async () => {
        // Mesmo registro que o `playlists:add-stalker` grava (MAC + sentinela).
        saveAndActivatePlaylist({ name: 'Portal', url: STALKER.url, username: STALKER.username, password: STALKER_SENTINEL, type: 'stalker' });
        expect(ehPortalStalker(await credenciais())).toBe(true);
    });

    it('playlist Xtream ativa: não é portal, e a URL da sonda é a do player', async () => {
        saveAndActivatePlaylist({ name: 'Xtream', url: XTREAM.url, username: XTREAM.username, password: XTREAM.password, type: 'xtream' });
        const c = await credenciais();
        expect(ehPortalStalker(c)).toBe(false);
        expect(urlDoCanalAoVivoSemPortal(c, { stream_id: 9 })).toBe('http://prov.example/live/u/p/9.m3u8');
    });
});
