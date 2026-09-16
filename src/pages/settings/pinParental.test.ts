import { describe, it, expect } from 'vitest';
import { modoAoTrocarPin, pedeePinAtual, depoisDeVerificar } from './pinParental';

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
});

describe('depoisDeVerificar', () => {
    it('acertou vindo de "desligar": desliga o parental', () => {
        expect(depoisDeVerificar('verify', true)).toBe('desligar-parental');
    });

    it('acertou vindo de "trocar": vai definir o PIN novo — e NÃO desliga nada', () => {
        expect(depoisDeVerificar('trocar', true)).toBe('definir-novo-pin');
    });

    it('errou é errado nos dois, sem exceção para quem já está nas Configurações', () => {
        expect(depoisDeVerificar('verify', false)).toBe('pin-incorreto');
        expect(depoisDeVerificar('trocar', false)).toBe('pin-incorreto');
    });
});
