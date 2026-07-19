import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LETTERS, KEYMAP_STORAGE_KEY, keymapService } from './keymapService';

describe('keymapService', () => {
    beforeEach(() => {
        localStorage.clear();
        keymapService.resetLetters();
    });

    it('retorna as letras padrão sem overrides', () => {
        expect(keymapService.getLetters()).toEqual(DEFAULT_LETTERS);
    });

    it('troca a letra de uma ação e persiste no localStorage', () => {
        expect(keymapService.setLetter('screenshot', 'p')).toBe('ok');
        expect(keymapService.getLetters().screenshot).toBe('p');
        expect(JSON.parse(localStorage.getItem(KEYMAP_STORAGE_KEY) || '{}')).toEqual({ screenshot: 'p' });
    });

    it('normaliza maiúsculas antes de gravar', () => {
        expect(keymapService.setLetter('mute', 'Q')).toBe('ok');
        expect(keymapService.getLetters().mute).toBe('q');
    });

    it('rejeita teclas reservadas', () => {
        expect(keymapService.setLetter('mute', ' ')).toBe('reserved');
        expect(keymapService.setLetter('mute', 'Escape')).toBe('reserved');
        expect(keymapService.setLetter('mute', 'ArrowLeft')).toBe('reserved');
        expect(keymapService.getLetters().mute).toBe('m');
    });

    it('rejeita tecla já usada por outra ação', () => {
        expect(keymapService.setLetter('mute', 'f')).toBe('conflict');
        expect(keymapService.getLetters().mute).toBe('m');
    });

    it('aceita reatribuir a própria tecla atual', () => {
        expect(keymapService.setLetter('mute', 'm')).toBe('ok');
        // voltar ao padrão limpa o override em vez de duplicá-lo
        expect(JSON.parse(localStorage.getItem(KEYMAP_STORAGE_KEY) || '{}')).toEqual({});
    });

    it('rejeita teclas multi-caractere não reservadas', () => {
        expect(keymapService.setLetter('mute', 'Enter')).toBe('invalid');
    });

    it('keyToAction inclui teclas fixas e reflete letras custom', () => {
        expect(keymapService.getKeyToAction()[' ']).toBe('togglePlay');
        expect(keymapService.getKeyToAction()['arrowleft']).toBe('seekBack');
        expect(keymapService.getKeyToAction()['arrowright']).toBe('seekForward');
        keymapService.setLetter('screenshot', 'p');
        const map = keymapService.getKeyToAction();
        expect(map['p']).toBe('screenshot');
        expect(map['s']).toBeUndefined();
    });

    it('resetLetters volta tudo ao padrão', () => {
        keymapService.setLetter('screenshot', 'p');
        keymapService.setLetter('mute', 'q');
        keymapService.resetLetters();
        expect(keymapService.getLetters()).toEqual(DEFAULT_LETTERS);
        expect(keymapService.getKeyToAction()['s']).toBe('screenshot');
    });

    it('ignora lixo gravado no localStorage', () => {
        localStorage.setItem(KEYMAP_STORAGE_KEY, 'not-json');
        expect(keymapService.getLetters()).toEqual(DEFAULT_LETTERS);
        localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify({ screenshot: 'ArrowUp', mute: 7, ghost: 'z' }));
        expect(keymapService.getLetters()).toEqual(DEFAULT_LETTERS);
    });
});
