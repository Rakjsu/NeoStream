import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ParentalSection } from './ParentalSection';
import { parentalService } from '../../services/parentalService';
import { indexedDBCache } from '../../services/indexedDBCache';
import { languageService } from '../../services/languageService';

/**
 * 🎭 O interruptor "Filtrar por TMDB" do Controle Parental (#D078).
 *
 * Tinha rótulo, descrição, checkbox, trava de PIN e até a animação de
 * "Salvo" — e nenhum leitor em todo o app: `filterByTMDB` só era escrito.
 * Desligá-lo não mudava UMA consulta, UM bloqueio, UM título na grade. E a
 * classificação da TMDB é a única fonte do `maxRating`: "desligar a TMDB"
 * nem teria significado honesto, seria desligar a classificação máxima em
 * silêncio. O interruptor sai, e o campo com ele.
 *
 * O teste olha o que o PAI vê (os interruptores da seção montada de verdade)
 * e o que fica GRAVADO no aparelho (o blob `parentalConfig`), não a forma do
 * código.
 */

const PERFIS = {
    profiles: [{ id: 'pai', name: 'Pai', avatar: '👨', isKids: false, createdAt: 0 }],
    activeProfileId: 'pai',
};

let container: HTMLDivElement;
let root: Root;

/** Espera uma CONDIÇÃO, nunca um número fixo de voltas. */
async function esperarAte(cond: () => boolean, oQue: string) {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`esperei demais: ${oQue}`);
}

function interruptores(): HTMLInputElement[] {
    return Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
}

describe('seção parental: nenhum interruptor sem efeito', () => {
    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        sessionStorage.clear();
        // Parental ligado e SEM PIN: a seção fica destravada e todos os
        // controles aparecem habilitados, como o pai os vê ao configurar.
        parentalService.setConfig({
            enabled: true, pinHash: null, pinSalt: null, maxRating: '12', blockAdultCategories: true,
        });
        localStorage.setItem('neostream_profiles', JSON.stringify(PERFIS));
        vi.spyOn(indexedDBCache, 'getHiddenItems').mockResolvedValue([]);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.restoreAllMocks();
        parentalService.setConfig({
            enabled: false, pinHash: null, pinSalt: null, maxRating: '18', blockAdultCategories: true,
        });
        localStorage.clear();
        sessionStorage.clear();
    });

    it('só sobram os interruptores que alguém lê: ativar e bloquear categorias adultas', async () => {
        await act(async () => { root.render(<ParentalSection />); });
        await esperarAte(() => interruptores().length > 0, 'a seção parental montar');

        const rotulos = interruptores().map(c => c.getAttribute('aria-label'));
        expect(rotulos).toEqual([
            languageService.t('parental', 'enable'),
            languageService.t('parental', 'blockAdult'),
        ]);
        // Nem como linha sem interruptor: nenhum TÍTULO de linha da seção
        // promete filtrar pela TMDB. (O aviso "sem a chave da TMDB" do filtro
        // infantil é um parágrafo, não um título, e continua valendo.)
        const titulos = Array.from(container.querySelectorAll('.setting-info label'))
            .map(l => l.textContent ?? '');
        expect(titulos.length).toBeGreaterThan(2);
        expect(titulos.filter(tt => /tmdb/i.test(tt))).toEqual([]);
    });
});

describe('parentalConfig gravado antes do conserto', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        vi.resetModules();
    });

    it('a chave morta sai do blob no próximo carregamento, sem perder o resto', async () => {
        localStorage.clear();
        localStorage.setItem('parentalConfig', JSON.stringify({
            enabled: true,
            pinHash: 'hash-antigo',
            pinSalt: 'sal-antigo',
            maxRating: '14',
            blockAdultCategories: false,
            filterByTMDB: false,
        }));

        // Módulo NOVO: o singleton lê o storage no construtor, como na
        // abertura do app.
        vi.resetModules();
        const { parentalService: recemCarregado } = await import('../../services/parentalService');

        const config = recemCarregado.getConfig() as unknown as Record<string, unknown>;
        expect('filterByTMDB' in config).toBe(false);
        expect(config).toEqual({
            enabled: true,
            pinHash: 'hash-antigo',
            pinSalt: 'sal-antigo',
            maxRating: '14',
            blockAdultCategories: false,
        });

        // E no aparelho: sem a chave, com o PIN e o resto intactos.
        const gravado = JSON.parse(localStorage.getItem('parentalConfig') ?? '{}') as Record<string, unknown>;
        expect(gravado).toEqual({
            enabled: true,
            pinHash: 'hash-antigo',
            pinSalt: 'sal-antigo',
            maxRating: '14',
            blockAdultCategories: false,
        });
    });

    it('blob já limpo carrega igual e não é regravado à toa', async () => {
        const limpo = JSON.stringify({
            enabled: true, pinHash: null, pinSalt: null, maxRating: '10', blockAdultCategories: true,
        });
        localStorage.clear();
        localStorage.setItem('parentalConfig', limpo);
        const gravacoes = vi.spyOn(Storage.prototype, 'setItem');

        vi.resetModules();
        const { parentalService: recemCarregado } = await import('../../services/parentalService');

        expect(recemCarregado.getConfig().maxRating).toBe('10');
        expect(gravacoes.mock.calls.filter(([chave]) => chave === 'parentalConfig')).toEqual([]);
        expect(localStorage.getItem('parentalConfig')).toBe(limpo);
    });

    it('podar junto com o PIN antigo em texto puro não deixa o aparelho um instante sem PIN', async () => {
        localStorage.clear();
        localStorage.setItem('parentalConfig', JSON.stringify({
            enabled: true,
            pin: '1234',
            maxRating: 'L',
            blockAdultCategories: true,
            filterByTMDB: true,
        }));

        vi.resetModules();
        const { parentalService: recemCarregado } = await import('../../services/parentalService');
        const lerGravado = () =>
            JSON.parse(localStorage.getItem('parentalConfig') ?? '{}') as Record<string, unknown>;

        // Logo depois da poda, antes do hash (crypto.subtle) ficar pronto: se o
        // app fechar AGORA, o que está no aparelho ainda tem de guardar o PIN.
        const noMeioDoCaminho = lerGravado();
        expect('filterByTMDB' in noMeioDoCaminho).toBe(false);
        expect(noMeioDoCaminho.pin === '1234' || typeof noMeioDoCaminho.pinHash === 'string').toBe(true);

        // Terminada a migração: hash no lugar do texto puro, e o PIN vale.
        for (let i = 0; i < 200 && typeof lerGravado().pinHash !== 'string'; i++) {
            await new Promise(r => setTimeout(r, 5));
        }
        const final = lerGravado();
        expect(final.pinHash).toMatch(/^[0-9a-f]{64}$/);
        expect('pin' in final).toBe(false);
        expect('filterByTMDB' in final).toBe(false);
        expect(final.maxRating).toBe('L');
        expect(await recemCarregado.verifyPin('1234')).toBe(true);
    });
});
