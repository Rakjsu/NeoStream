/**
 * #D036 — o renderer tem que MANDAR o nome do canal para o EPG do provedor.
 *
 * O main so consegue achar o canal pelo `<display-name>` do XMLTV do
 * provedor se o pedido `epg:provider-channel` levar o nome. Antes, o pedido
 * levava so o tvg-id e o stream_id — e um canal sem os dois nem chegava a
 * perguntar.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { epgService } from './epgService';

interface Pedido {
    canal: string;
    carga: Record<string, unknown>;
}

describe('EPG do provedor: o pedido leva o nome do canal', () => {
    let pedidos: Pedido[] = [];

    beforeEach(() => {
        pedidos = [];
        localStorage.removeItem('neostream_external_epg_url');
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
            invoke: (canal: string, carga: Record<string, unknown>) => {
                pedidos.push({ canal, carga });
                if (canal !== 'epg:provider-channel') return Promise.resolve({ success: false });
                const agora = Date.now();
                return Promise.resolve({
                    success: true,
                    source: 'xmltv',
                    programs: [{
                        id: 'p1',
                        start: new Date(agora - 60_000).toISOString(),
                        end: new Date(agora + 3_600_000).toISOString(),
                        title: 'Jornal do Um',
                        channel_id: 'um.prov',
                    }],
                });
            },
        };
    });

    afterEach(() => {
        delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    });

    it('canal sem tvg-id manda o nome junto com o stream_id', async () => {
        const programas = await epgService.fetchChannelEPG('', 'Canal Um [FHD]', 7);

        const pedido = pedidos.find(p => p.canal === 'epg:provider-channel');
        expect(pedido?.carga).toMatchObject({ channelId: '', channelName: 'Canal Um [FHD]', streamId: 7 });
        expect(programas.map(p => p.title)).toEqual(['Jornal do Um']);
    });

    it('canal so com nome (sem tvg-id e sem stream_id) tambem pergunta ao provedor', async () => {
        const programas = await epgService.fetchChannelEPG('', 'Canal Um');

        const pedido = pedidos.find(p => p.canal === 'epg:provider-channel');
        expect(pedido?.carga).toMatchObject({ channelId: '', channelName: 'Canal Um' });
        expect(programas.map(p => p.title)).toEqual(['Jornal do Um']);
    });

    it('com tvg-id o nome vai junto, para o main cair nele se o id nao existir', async () => {
        await epgService.fetchChannelEPG('id.da.playlist', 'Canal Um', 7);

        const pedido = pedidos.find(p => p.canal === 'epg:provider-channel');
        expect(pedido?.carga).toMatchObject({ channelId: 'id.da.playlist', channelName: 'Canal Um', streamId: 7 });
    });

    it('sem tvg-id, sem stream_id e sem nome nao ha pedido nenhum', async () => {
        expect(await epgService.fetchFromProvider('')).toEqual([]);
        expect(pedidos).toEqual([]);
    });
});
