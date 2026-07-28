import { describe, it, expect } from 'vitest';
import { resolveRemoteChannel } from './webRemoteTune';

const CANAIS = [
    { stream_id: 10, name: 'Globo FHD' },
    { stream_id: 20, name: 'SporTV' },
];

describe('resolveRemoteChannel (canal pedido pelo celular)', () => {
    it('casa pelo stream_id quando os dois lados usam a mesma conta', () => {
        expect(resolveRemoteChannel(CANAIS, '20')?.name).toBe('SporTV');
    });

    it('cai pro nome quando o id é de OUTRA conta (antes virava no-op)', () => {
        // Id inexistente aqui: sem o resgate por nome o comando não fazia nada.
        expect(resolveRemoteChannel(CANAIS, '99999', 'globo fhd')?.stream_id).toBe(10);
        expect(resolveRemoteChannel(CANAIS, '99999', '  SPORTV  ')?.stream_id).toBe(20);
    });

    it('id vence o nome (mesma conta não deve zapear pro homônimo)', () => {
        const comHomonimo = [...CANAIS, { stream_id: 30, name: 'Globo FHD' }];
        expect(resolveRemoteChannel(comHomonimo, '30', 'Globo FHD')?.stream_id).toBe(30);
    });

    it('sem id nem nome que casem, devolve undefined (o celular é avisado)', () => {
        expect(resolveRemoteChannel(CANAIS, '99999')).toBeUndefined();
        expect(resolveRemoteChannel(CANAIS, '99999', '')).toBeUndefined();
        expect(resolveRemoteChannel(CANAIS, '99999', 'Canal que não existe')).toBeUndefined();
        expect(resolveRemoteChannel([], '10', 'Globo FHD')).toBeUndefined();
    });
});
