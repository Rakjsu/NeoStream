import { describe, it, expect } from 'vitest';
import { modoAoTrocarPin, pedeePinAtual, precisaProvarPin, depoisDeVerificar } from './pinParental';

describe('modoAoTrocarPin', () => {
    it('com PIN salvo, o botão "Alterar PIN" abre CONFERINDO o atual', () => {
        // O furo: antes ele abria direto na definição e gravava por cima.
        expect(modoAoTrocarPin(true)).toBe('trocar');
    });

    it('sem PIN salvo não há o que conferir — é a primeira definição', () => {
        expect(modoAoTrocarPin(false)).toBe('set');
    });
});

describe('pedeePinAtual', () => {
    it('conferir para desligar e conferir para trocar mostram a mesma tela', () => {
        expect(pedeePinAtual('verify')).toBe(true);
        expect(pedeePinAtual('trocar')).toBe(true);
    });

    it('definir não pede PIN atual', () => {
        expect(pedeePinAtual('set')).toBe(false);
    });

    it('destravar a seção também confere o PIN atual', () => {
        expect(pedeePinAtual('destravar')).toBe(true);
    });

    it('liberar o conteúdo da sessão também confere o PIN atual', () => {
        expect(pedeePinAtual('liberar')).toBe(true);
    });
});

describe('precisaProvarPin', () => {
    it('com PIN salvo e sessão trancada, a seção inteira fica trancada', () => {
        expect(precisaProvarPin(true, false)).toBe(true);
    });

    it('provado o PIN nesta sessão, a seção abre', () => {
        expect(precisaProvarPin(true, true)).toBe(false);
    });

    it('sem PIN salvo não há o que provar', () => {
        expect(precisaProvarPin(false, false)).toBe(false);
        expect(precisaProvarPin(false, true)).toBe(false);
    });
});

describe('depoisDeVerificar', () => {
    it('acertou vindo de "desligar": desliga o parental', () => {
        expect(depoisDeVerificar('verify', true)).toBe('desligar-parental');
    });

    it('acertou vindo de "trocar": vai definir o PIN novo — e NÃO desliga nada', () => {
        expect(depoisDeVerificar('trocar', true)).toBe('definir-novo-pin');
    });

    it('acertou vindo de "destravar": abre a seção — e NÃO desliga o parental', () => {
        expect(depoisDeVerificar('destravar', true)).toBe('destravar-secao');
    });

    it('acertou vindo de "liberar": libera o CONTEÚDO — não a seção, e não desliga nada', () => {
        expect(depoisDeVerificar('liberar', true)).toBe('liberar-sessao');
    });

    it('errou é errado em todos, sem exceção para quem já está nas Configurações', () => {
        expect(depoisDeVerificar('verify', false)).toBe('pin-incorreto');
        expect(depoisDeVerificar('trocar', false)).toBe('pin-incorreto');
        expect(depoisDeVerificar('destravar', false)).toBe('pin-incorreto');
        expect(depoisDeVerificar('liberar', false)).toBe('pin-incorreto');
    });
});
