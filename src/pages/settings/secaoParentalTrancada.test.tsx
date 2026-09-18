import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ParentalSection } from './ParentalSection';
import { parentalService } from '../../services/parentalService';
import { indexedDBCache } from '../../services/indexedDBCache';
import { languageService } from '../../services/languageService';
import {
    getKidsDailyLimitMinutes, getKidsAllowedHours, getAutoKidsHours, getProfileDailyLimitMinutes,
} from '../../services/watchLimitsService';
import { listParentalLog, logParentalEvent } from '../../services/parentalLogService';

/**
 * 🔒 A seção de Controle Parental montada de verdade, com PIN salvo.
 *
 * O buraco: só o interruptor "Ativar" pedia PIN — e só para ser DESLIGADO.
 * Limite de tela do perfil infantil, janela de horário, auto-kids, limite por
 * perfil, o 👁 que desfaz o filtro infantil inteiro e o 🗑 que apaga o log de
 * tentativas gravavam direto no `onChange`. E Configurações está no menu de
 * todo perfil, inclusive o infantil: dava para abrir a janela de horário de
 * par em par e depois varrer o rastro sem nunca saber o PIN.
 *
 * Os controles são achados pelo RÓTULO traduzido — que já existia antes do
 * conserto — e não por `data-testid` novo: assim o teste morde o comportamento
 * antigo em vez de reclamar que um atributo sumiu. O que se afirma é o
 * RESULTADO no storage, não que tal função foi chamada. O PIN é o de verdade
 * (`setPin` + `crypto.subtle`), não um dublê: o modal é uma das pontas onde o
 * conserto pode furar.
 */

const PERFIS = {
    profiles: [
        { id: 'pai', name: 'Pai', avatar: '👨', isKids: false, createdAt: 0 },
        { id: 'filho', name: 'Filho', avatar: '👶', isKids: true, createdAt: 0 },
    ],
    activeProfileId: 'pai',
};

const CONFIG_LIMPA = {
    enabled: false,
    pinHash: null,
    pinSalt: null,
    maxRating: '18' as const,
    blockAdultCategories: true,
    filterByTMDB: true,
};

const rotulo = (chave: string) => languageService.t('parental', chave);

let container: HTMLDivElement;
let root: Root;

/** Liga o parental e salva um PIN de verdade (hash salgado, como o app faz). */
async function comPinSalvo() {
    parentalService.setConfig({ enabled: true, maxRating: 'L' });
    await parentalService.setPin('1234');
}

function semPin() {
    parentalService.setConfig({ enabled: true, maxRating: 'L', pinHash: null, pinSalt: null });
}

async function montar() {
    await act(async () => { root.render(<ParentalSection />); });
    await assentar();
}

/** Deixa as promessas do efeito assentarem (contarOcultos resolve depois). */
async function assentar() {
    await act(async () => {
        for (let i = 0; i < 6; i++) await Promise.resolve();
    });
}

/**
 * Espera uma CONDICAO, nao um numero de microtasks.
 *
 * `verifyPin` passa por `crypto.subtle` (PBKDF2), que nao resolve em
 * microtask: drenar N promessas e aposta, e sob a carga da suite inteira a
 * aposta perde -- o teste pisca vermelho sem nada de errado no codigo.
 */
async function esperarAte(cond: () => boolean, oQue: string) {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`esperei demais: ${oQue}`);
}

/** A linha da seção cujo <label> contém o rótulo traduzido. */
function linha(chave: string): HTMLElement {
    const texto = rotulo(chave);
    const itens = Array.from(container.querySelectorAll('.setting-item')) as HTMLElement[];
    const achada = itens.find(item => item.querySelector('label')?.textContent?.includes(texto));
    if (!achada) throw new Error(`não achei a linha "${texto}" na seção parental`);
    return achada;
}

function selectDaLinha(chave: string): HTMLSelectElement {
    const select = linha(chave).querySelector('select');
    if (!select) throw new Error(`a linha "${rotulo(chave)}" não tem <select>`);
    return select;
}

function checkboxDaLinha(chave: string): HTMLInputElement {
    const campo = linha(chave).querySelector('input[type="checkbox"]');
    if (!campo) throw new Error(`a linha "${rotulo(chave)}" não tem checkbox`);
    return campo as HTMLInputElement;
}

/** O <select> do perfil `nome` dentro da linha "Limite diário por perfil". */
function selectDoPerfil(nome: string): HTMLSelectElement {
    const linhas = Array.from(linha('profileLimits').querySelectorAll('div')) as HTMLElement[];
    const achada = linhas.find(l => l.querySelector('span')?.textContent?.includes(nome) && l.querySelector('select'));
    const select = achada?.querySelector('select');
    if (!select) throw new Error(`não achei o limite do perfil "${nome}"`);
    return select;
}

function botaoDaLinha(chave: string): HTMLButtonElement {
    const botao = linha(chave).querySelector('button');
    if (!botao) throw new Error(`a linha "${rotulo(chave)}" não tem <button>`);
    return botao;
}

/** O convite para destravar a seção (só existe enquanto ela está trancada). */
function botaoDestravar(): HTMLButtonElement | null {
    const grupo = container.querySelector('.settings-group');
    const botoes = Array.from(grupo?.querySelectorAll('button') ?? []);
    return (botoes.find(b => b.textContent?.includes('Desbloquear')) as HTMLButtonElement) ?? null;
}

async function escolher(select: HTMLSelectElement, valor: string) {
    await act(async () => {
        select.value = valor;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function clicar(elemento: HTMLElement) {
    await act(async () => { elemento.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/** Digita no campo escondido do modal (o React só enxerga o setter nativo). */
async function digitarPin(pin: string) {
    const campo = container.querySelector('#pin-hidden-input') as HTMLInputElement;
    if (!campo) throw new Error('o modal de PIN não está aberto');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
        setter?.call(campo, pin);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** Aperta o botão de ação DENTRO do modal (o da seção tem o mesmo rótulo). */
async function enviarPin() {
    const modal = container.querySelector('.pin-modal-overlay');
    const botoes = Array.from(modal?.querySelectorAll('button') ?? []) as HTMLElement[];
    if (!botoes.length) throw new Error('o modal de PIN não está aberto');
    const antes = modal?.textContent ?? '';
    await clicar(botoes[botoes.length - 1]);
    await assentar();
    // O PBKDF2 do verifyPin nao termina em microtask, entao contar promessas e
    // aposta. Espera o modal REAGIR: fechar (PIN certo), avisar erro (PIN
    // errado) ou trocar de etapa (definir -> confirmar).
    await esperarAte(() => {
        const agora = container.querySelector('.pin-modal-overlay');
        return !agora || (agora.textContent ?? '') !== antes;
    }, 'o modal do PIN nao respondeu ao envio');
}

describe('seção de Controle Parental trancada pelo PIN', () => {
    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        sessionStorage.clear();
        parentalService.setConfig(CONFIG_LIMPA);
        localStorage.setItem('neostream_profiles', JSON.stringify(PERFIS));
        // Um título escondido: sem isso o 👁 já nasce desabilitado por falta
        // de conteúdo oculto e o teste não veria a tranca.
        vi.spyOn(indexedDBCache, 'getHiddenItems').mockImplementation(async (tipo) =>
            (tipo === 'movie' ? ['123'] : []));
        vi.spyOn(indexedDBCache, 'clearHiddenItems').mockResolvedValue(undefined);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.restoreAllMocks();
        parentalService.lockSession();
        parentalService.lockParentalSettings();
        parentalService.setConfig(CONFIG_LIMPA);
        localStorage.clear();
        sessionStorage.clear();
    });

    it('trancada, o limite de tela kids não é gravado', async () => {
        await comPinSalvo();
        await montar();

        await escolher(selectDaLinha('kidsLimit'), '180');

        expect(getKidsDailyLimitMinutes()).toBe(0);
    });

    it('trancada, a janela de horário não é aberta', async () => {
        await comPinSalvo();
        await montar();

        await escolher(selectDaLinha('kidsHours'), '8-22');

        expect(getKidsAllowedHours()).toBe(null);
    });

    it('trancada, o auto-kids não é reprogramado', async () => {
        await comPinSalvo();
        await montar();

        await escolher(selectDaLinha('autoKids'), '6-20');

        expect(getAutoKidsHours()).toBe(null);
    });

    it('trancada, o limite do perfil do filho não é gravado', async () => {
        await comPinSalvo();
        await montar();

        await escolher(selectDoPerfil('Filho'), '30');

        expect(getProfileDailyLimitMinutes('filho')).toBe(0);
    });

    it('trancada, o 🗑 não varre o log de tentativas', async () => {
        await comPinSalvo();
        logParentalEvent('pin_fail', 'tentativa do filho');
        await montar();

        await clicar(botaoDaLinha('logTitle'));

        expect(listParentalLog()).toHaveLength(1);
    });

    it('trancada, o 👁 não desfaz o filtro infantil', async () => {
        await comPinSalvo();
        await montar();

        await clicar(botaoDaLinha('hiddenTitles'));

        expect(indexedDBCache.clearHiddenItems).not.toHaveBeenCalled();
    });

    it('trancada, a classificação máxima não é afrouxada', async () => {
        await comPinSalvo();
        await montar();

        await escolher(selectDaLinha('maxRating'), '18');

        expect(parentalService.getConfig().maxRating).toBe('L');
    });

    it('trancada, todos os controles aparecem desabilitados e sobra a saída', async () => {
        await comPinSalvo();
        await montar();

        expect(botaoDestravar()).not.toBeNull();
        expect(botaoDestravar()!.disabled).toBe(false);
        expect(selectDaLinha('kidsLimit').disabled).toBe(true);
        expect(selectDaLinha('kidsHours').disabled).toBe(true);
        expect(selectDaLinha('autoKids').disabled).toBe(true);
        expect(selectDoPerfil('Filho').disabled).toBe(true);
        expect(selectDaLinha('maxRating').disabled).toBe(true);
        expect(checkboxDaLinha('blockAdult').disabled).toBe(true);
        expect(checkboxDaLinha('filterTMDB').disabled).toBe(true);
        expect(botaoDaLinha('logTitle').disabled).toBe(true);
        expect(botaoDaLinha('hiddenTitles').disabled).toBe(true);
    });

    it('com o parental DESLIGADO e PIN salvo a saída continua clicável', async () => {
        // Desligar não apaga o PIN: sem esta exceção a seção trancaria para
        // sempre, com o único botão que a abre desabilitado junto.
        await comPinSalvo();
        parentalService.setConfig({ enabled: false });
        await montar();

        expect(botaoDestravar()).not.toBeNull();
        expect(botaoDestravar()!.disabled).toBe(false);
    });

    it('destravada a sessão, o limite de tela kids volta a ser gravado', async () => {
        await comPinSalvo();
        parentalService.unlockParentalSettings();
        await montar();

        expect(botaoDestravar()).toBeNull();
        await escolher(selectDaLinha('kidsLimit'), '180');

        expect(getKidsDailyLimitMinutes()).toBe(180);
    });

    it('destravada a sessão, o 🗑 volta a varrer o log', async () => {
        await comPinSalvo();
        parentalService.unlockParentalSettings();
        logParentalEvent('pin_fail', 'tentativa do filho');
        await montar();

        await clicar(botaoDaLinha('logTitle'));

        expect(listParentalLog()).toHaveLength(0);
    });

    it('sem PIN salvo não há o que provar: a seção continua editável', async () => {
        semPin();
        await montar();

        expect(botaoDestravar()).toBeNull();
        await escolher(selectDaLinha('kidsLimit'), '60');

        expect(getKidsDailyLimitMinutes()).toBe(60);
    });

    it('acertar o PIN destrava a seção — sem desligar o parental e sem liberar o conteúdo', async () => {
        await comPinSalvo();
        await montar();

        await clicar(botaoDestravar()!);
        // A tela de conferência NÃO pode dizer "Digite o PIN para desativar":
        // quem só quer mexer no limite de tela não está desligando nada.
        const modal = container.querySelector('.pin-modal-overlay') as HTMLElement;
        expect(modal.textContent).not.toContain(rotulo('verifyPin'));
        expect(modal.textContent).toContain(rotulo('enterPin'));
        expect(modal.querySelectorAll('button')[1].textContent).toContain('Desbloquear');

        await digitarPin('1234');
        await enviarPin();

        expect(parentalService.isParentalSettingsUnlocked()).toBe(true);
        // O destino 'destravar' não pode cair no ramo que DESLIGA o parental.
        expect(parentalService.getConfig().enabled).toBe(true);
        // E o destrave da SEÇÃO não é o destrave do CONTEÚDO: os nove
        // leitores de isSessionUnlocked() continuam filtrando.
        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(parentalService.isContentBlocked('18')).toBe(true);

        expect(botaoDestravar()).toBeNull();
        await escolher(selectDaLinha('kidsLimit'), '120');
        expect(getKidsDailyLimitMinutes()).toBe(120);
    });

    it('errar o PIN mantém a seção trancada', async () => {
        await comPinSalvo();
        await montar();

        await clicar(botaoDestravar()!);
        await digitarPin('9999');
        await enviarPin();

        expect(parentalService.isParentalSettingsUnlocked()).toBe(false);
        expect(botaoDestravar()).not.toBeNull();
        expect(selectDaLinha('kidsLimit').disabled).toBe(true);
    });

    it('quem acaba de DEFINIR o PIN não é trancado do lado de fora', async () => {
        semPin();
        parentalService.setConfig({ enabled: false });
        await montar();

        // Ligar sem PIN salvo abre o modal de definição: digita e confirma.
        await clicar(checkboxDaLinha('enable'));
        await digitarPin('4321');
        await enviarPin();
        await digitarPin('4321');
        await enviarPin();

        expect(parentalService.hasPin()).toBe(true);
        expect(botaoDestravar()).toBeNull();
        await escolher(selectDaLinha('kidsLimit'), '90');
        expect(getKidsDailyLimitMinutes()).toBe(90);
    });
});
