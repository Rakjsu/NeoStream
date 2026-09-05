import { describe, it, expect, beforeEach } from 'vitest';
import { subtitleSyncPrefs, subtitleSyncKey, MAX_OFFSET_SECONDS } from './subtitleSyncPrefs';

/**
 * O ajuste de sincronia voltava a zero a cada episódio — e não porque o usuário
 * esquecia: trocar de episódio faz o AsyncVideoPlayer voltar para a tela de
 * carregamento e DESMONTAR o player, então o `useState(0)` renasce.
 */
describe('subtitleSyncKey', () => {
    it('compõe tipo:id, e sem id não há chave', () => {
        expect(subtitleSyncKey('series', '301')).toBe('series:301');
        expect(subtitleSyncKey(undefined, '204')).toBe('movie:204');
        expect(subtitleSyncKey('series', undefined)).toBeNull();
        expect(subtitleSyncKey('series', null)).toBeNull();
    });
});

describe('subtitleSyncPrefs', () => {
    beforeEach(() => localStorage.clear());

    it('lembra por conteúdo, sem misturar', () => {
        subtitleSyncPrefs.set('series:301', 1.5);
        subtitleSyncPrefs.set('movie:204', -2);
        expect(subtitleSyncPrefs.get('series:301')).toBe(1.5);
        expect(subtitleSyncPrefs.get('movie:204')).toBe(-2);
    });

    it('conteúdo sem ajuste é zero, não null', () => {
        expect(subtitleSyncPrefs.get('series:999')).toBe(0);
        expect(subtitleSyncPrefs.get(null)).toBe(0);
    });

    it('voltar a zero apaga o registro em vez de guardar o padrão', () => {
        subtitleSyncPrefs.set('series:301', 2);
        subtitleSyncPrefs.set('series:301', 0);
        expect(JSON.parse(localStorage.getItem('neostream_subtitle_sync') || '{}')).toEqual({});
    });

    // Guardar sem limite deixaria um valor absurdo (bug ou storage corrompido)
    // grudado no conteúdo para sempre.
    it('valor fora do limite é GRAVADO no limite, não descartado', () => {
        subtitleSyncPrefs.set('series:301', 9999);
        expect(subtitleSyncPrefs.get('series:301')).toBe(MAX_OFFSET_SECONDS);
        subtitleSyncPrefs.set('movie:1', -9999);
        expect(subtitleSyncPrefs.get('movie:1')).toBe(-MAX_OFFSET_SECONDS);
    });

    it('valor não-finito não vira ajuste', () => {
        subtitleSyncPrefs.set('series:301', Number.NaN);
        expect(subtitleSyncPrefs.get('series:301')).toBe(0);
    });

    it('registro corrompido no storage não derruba a leitura', () => {
        localStorage.setItem('neostream_subtitle_sync', 'isto não é json');
        expect(subtitleSyncPrefs.get('series:301')).toBe(0);

        localStorage.setItem('neostream_subtitle_sync', '{"series:301":"dois","movie:1":3}');
        expect(subtitleSyncPrefs.get('series:301')).toBe(0);
        expect(subtitleSyncPrefs.get('movie:1')).toBe(3);
    });

    it('chave nula não escreve nada', () => {
        subtitleSyncPrefs.set(null, 5);
        expect(localStorage.getItem('neostream_subtitle_sync')).toBeNull();
    });
});
