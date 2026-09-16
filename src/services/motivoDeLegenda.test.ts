import { describe, it, expect } from 'vitest';
import { classificarFalhaDeLegenda, chaveDaMensagem } from './motivoDeLegenda';

describe('classificarFalhaDeLegenda', () => {
    it('sem credencial vence qualquer status — é o que a pessoa resolve sozinha', () => {
        expect(classificarFalhaDeLegenda({ temCredencial: false })).toBe('sem-credencial');
        expect(classificarFalhaDeLegenda({ temCredencial: false, status: 500 })).toBe('sem-credencial');
        expect(classificarFalhaDeLegenda({ temCredencial: false, status: null })).toBe('sem-credencial');
    });

    it('406 e 429 são a cota diária do OpenSubtitles', () => {
        expect(classificarFalhaDeLegenda({ temCredencial: true, status: 406 })).toBe('cota');
        expect(classificarFalhaDeLegenda({ temCredencial: true, status: 429 })).toBe('cota');
    });

    it('outro erro da API é problema do provedor', () => {
        expect(classificarFalhaDeLegenda({ temCredencial: true, status: 401 })).toBe('provedor');
        expect(classificarFalhaDeLegenda({ temCredencial: true, status: 503 })).toBe('provedor');
    });

    it('com credencial e sem falha registrada, o título é que não tem legenda', () => {
        expect(classificarFalhaDeLegenda({ temCredencial: true })).toBe('nada-encontrado');
        expect(classificarFalhaDeLegenda({ temCredencial: true, status: null })).toBe('nada-encontrado');
        // 2xx/3xx não é falha: a busca foi e voltou vazia.
        expect(classificarFalhaDeLegenda({ temCredencial: true, status: 200 })).toBe('nada-encontrado');
    });
});

describe('chaveDaMensagem', () => {
    it('cada motivo tem a sua frase', () => {
        expect(chaveDaMensagem('sem-credencial')).toBe('subtitleNoKey');
        expect(chaveDaMensagem('cota')).toBe('subtitleQuota');
        expect(chaveDaMensagem('provedor')).toBe('subtitleProviderDown');
    });

    it('"nada encontrado" continua com a frase de sempre', () => {
        expect(chaveDaMensagem('nada-encontrado')).toBe('noSubtitlesFound');
    });
});
