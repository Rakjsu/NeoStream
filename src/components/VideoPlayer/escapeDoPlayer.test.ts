import { describe, expect, it } from 'vitest';
import { alvoDoEscape, type AberturasDoPlayer } from './escapeDoPlayer';

/** Nada aberto, fullscreen desligado, com para onde voltar. */
const NADA: AberturasDoPlayer = {
    ajustes: false,
    marcadores: false,
    qr: false,
    fullscreen: false,
    podeFechar: true,
};

describe('Escape no player', () => {
    it('com o menu da engrenagem aberto, fecha o MENU — não o filme', () => {
        // Era este o defeito: o atalho chamava onClose() direto, então
        // "sair do menu" perdia a sessão de reprodução inteira.
        expect(alvoDoEscape({ ...NADA, ajustes: true })).toBe('ajustes');
    });

    it('o painel de marcadores e o QR também vêm antes do filme', () => {
        expect(alvoDoEscape({ ...NADA, marcadores: true })).toBe('marcadores');
        expect(alvoDoEscape({ ...NADA, qr: true })).toBe('qr');
    });

    it('sobreposição ganha do fullscreen', () => {
        // Sair do fullscreen deixando o menu aberto é a mesma surpresa, mais
        // barata: o menu é o que está sob a mão do usuário.
        expect(alvoDoEscape({ ...NADA, ajustes: true, fullscreen: true })).toBe('ajustes');
    });

    it('sem sobreposição, o fullscreen continua sendo o primeiro a cair', () => {
        expect(alvoDoEscape({ ...NADA, fullscreen: true })).toBe('fullscreen');
    });

    it('com a tela limpa, aí sim fecha o player', () => {
        expect(alvoDoEscape(NADA)).toBe('fechar');
    });

    it('sem onClose não sobra nada pra fazer', () => {
        // O player embutido (mosaico, PiP) não tem pra onde voltar; Esc não
        // pode virar um no-op disfarçado de fechamento.
        expect(alvoDoEscape({ ...NADA, podeFechar: false })).toBe('nada');
    });
});
