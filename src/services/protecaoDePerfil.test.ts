import { describe, it, expect } from 'vitest';
import { bloqueioParaApagar, chaveDoBloqueio, exigePinParaMexer } from './protecaoDePerfil';

const perfil = (over: Partial<Parameters<typeof exigePinParaMexer>[0]> = {}) => ({ id: 'p1', ...over });

describe('bloqueioParaApagar', () => {
    it('perfil comum, com outros na lista: pode apagar', () => {
        expect(bloqueioParaApagar({ perfil: perfil(), ativoId: 'p2', total: 3 })).toBeNull();
    });

    it('o perfil em uso não se apaga', () => {
        expect(bloqueioParaApagar({ perfil: perfil({ id: 'p1' }), ativoId: 'p1', total: 3 })).toBe('ativo');
    });

    it('o último perfil não se apaga', () => {
        expect(bloqueioParaApagar({ perfil: perfil(), ativoId: 'p2', total: 1 })).toBe('ultimo');
    });

    it('o perfil infantil não se apaga — hoje não há como recriá-lo', () => {
        expect(bloqueioParaApagar({ perfil: perfil({ isKids: true }), ativoId: 'p2', total: 4 })).toBe('kids');
    });

    it('sem perfil ativo conhecido, o resto das regras continua valendo', () => {
        // A tela de boot roda antes de haver ativo: ali "ativo" não se aplica.
        expect(bloqueioParaApagar({ perfil: perfil({ isKids: true }), ativoId: null, total: 2 })).toBe('kids');
        expect(bloqueioParaApagar({ perfil: perfil(), total: 1 })).toBe('ultimo');
    });

    it('"está em uso" vence "é o último" — é a explicação mais útil', () => {
        expect(bloqueioParaApagar({ perfil: perfil({ id: 'p1' }), ativoId: 'p1', total: 1 })).toBe('ativo');
    });
});

describe('chaveDoBloqueio', () => {
    it('cada bloqueio tem a sua mensagem', () => {
        expect(chaveDoBloqueio('ativo')).toBe('cannotDeleteActive');
        expect(chaveDoBloqueio('ultimo')).toBe('cannotDeleteLast');
        expect(chaveDoBloqueio('kids')).toBe('cannotDeleteKids');
    });
});

describe('exigePinParaMexer', () => {
    it('perfil com PIN exige o PIN — para apagar E para editar', () => {
        // Trocar nome e avatar de um perfil protegido é mexer no perfil de
        // outra pessoa do mesmo jeito, só que sem aviso depois.
        expect(exigePinParaMexer(perfil({ pin: 'abc123' }))).toBe(true);
    });

    it('perfil sem PIN não exige nada', () => {
        expect(exigePinParaMexer(perfil())).toBe(false);
        expect(exigePinParaMexer(perfil({ pin: '' }))).toBe(false);
    });
});
