import { describe, expect, it } from 'vitest';
import { toMobileTargets } from './mobileTargets';

// 🔒 Regressão (auditoria R3, lacuna 3): o "enviar pro celular" ia pra TODOS os
// celulares pareados. Pra endereçar, a UI precisa dos aparelhos separados e
// distinguíveis — a página do navegador nunca é alvo.
describe('toMobileTargets', () => {
    it('ignora a página do navegador e prefere o id do APARELHO', () => {
        expect(toMobileTargets([
            { id: 'conn-1', ip: '192.168.0.5', name: null, role: 'browser' },
            { id: 'conn-2', ip: '192.168.0.9', name: 'Galaxy do pai', role: 'mobile', deviceId: 'dev-pai' },
        ])).toEqual([{ id: 'dev-pai', label: 'Galaxy do pai' }]);
    });

    it('dois aparelhos com o mesmo nome ganham o IP no rótulo', () => {
        expect(toMobileTargets([
            { id: 'conn-1', ip: '192.168.0.9', name: 'NeoStream Mobile', role: 'mobile', deviceId: 'dev-a' },
            { id: 'conn-2', ip: '192.168.0.7', name: 'NeoStream Mobile', role: 'mobile', deviceId: 'dev-b' },
        ])).toEqual([
            { id: 'dev-a', label: 'NeoStream Mobile · 192.168.0.9' },
            { id: 'dev-b', label: 'NeoStream Mobile · 192.168.0.7' },
        ]);
    });

    it('app antigo (sem deviceId nem nome) ainda é endereçável pela conexão', () => {
        expect(toMobileTargets([{ id: 'conn-3', ip: '192.168.0.4', role: 'mobile' }]))
            .toEqual([{ id: 'conn-3', label: 'celular' }]);
    });

    it('sem celular pareado a lista é vazia', () => {
        expect(toMobileTargets([{ id: 'conn-1', ip: '::1', name: null, role: 'browser' }])).toEqual([]);
    });
});
