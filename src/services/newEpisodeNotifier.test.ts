import { describe, it, expect } from 'vitest';
import { createNotifierState, pickNewlyFlagged, buildNotificationBody } from './newEpisodeNotifier';

describe('pickNewlyFlagged', () => {
    it('primeira chamada só prepara a memória (nada notifica)', () => {
        const state = createNotifierState();
        expect(pickNewlyFlagged(state, ['1', '2'])).toEqual([]);
    });

    it('chamadas seguintes devolvem só as adições', () => {
        const state = createNotifierState();
        pickNewlyFlagged(state, ['1']);
        expect(pickNewlyFlagged(state, ['1', '2', '3'])).toEqual(['2', '3']);
        expect(pickNewlyFlagged(state, ['1', '2', '3'])).toEqual([]);
    });

    it('série que saiu e voltou não repete notificação', () => {
        const state = createNotifierState();
        pickNewlyFlagged(state, ['1']);
        pickNewlyFlagged(state, ['1', '2']);
        pickNewlyFlagged(state, ['1']); // 2 saiu (usuário abriu)
        expect(pickNewlyFlagged(state, ['1', '2'])).toEqual([]);
    });
});

describe('buildNotificationBody', () => {
    const tpl = { one: 'Novos episódios em {name}', many: '{count} séries com novos episódios (ex.: {name})' };

    it('singular e plural', () => {
        expect(buildNotificationBody(['Dark'], tpl)).toBe('Novos episódios em Dark');
        expect(buildNotificationBody(['Dark', 'Ozark', 'Alice'], tpl)).toBe('3 séries com novos episódios (ex.: Dark)');
    });
});
