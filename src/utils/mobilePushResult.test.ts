import { describe, it, expect } from 'vitest';
import { mobilePushMessageKey } from './mobilePushResult';

describe('mobilePushMessageKey (aviso do "enviar pro celular")', () => {
    it('descarte silencioso do app não vira mais "entregue ✓"', () => {
        // Regressão: o botão dizia entregue só por ter escrito no socket, mesmo
        // quando o app descartava por tranca, parental ou canal inexistente.
        expect(mobilePushMessageKey({ delivered: 1, status: 'locked' })).toBe('phoneLocked');
        expect(mobilePushMessageKey({ delivered: 1, status: 'blocked' })).toBe('phoneBlocked');
        expect(mobilePushMessageKey({ delivered: 1, status: 'notFound' })).toBe('phoneNotFound');
    });

    it('confirmação de reprodução e ausência de celular', () => {
        expect(mobilePushMessageKey({ delivered: 1, status: 'played' })).toBe('sentToPhone');
        expect(mobilePushMessageKey({ delivered: 0, status: 'none' })).toBe('noPhoneConnected');
        expect(mobilePushMessageKey(null)).toBe('noPhoneConnected');
    });

    it('app legado (sem ACK) e app que não respondeu a tempo têm avisos próprios', () => {
        expect(mobilePushMessageKey({ delivered: 1, status: 'delivered' })).toBe('phoneSentNoAck');
        expect(mobilePushMessageKey({ delivered: 2, status: 'timeout' })).toBe('phoneNoAnswer');
    });

    it('resposta sem status (build antigo do main) mantém o texto de sempre', () => {
        expect(mobilePushMessageKey({ delivered: 1 })).toBe('sentToPhone');
    });
});
