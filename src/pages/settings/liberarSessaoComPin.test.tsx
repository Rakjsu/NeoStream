import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ParentalSection } from './ParentalSection';
import { parentalService } from '../../services/parentalService';
import { profileService } from '../../services/profileService';
import { isParentalActive } from '../../services/contentGate';
import { indexedDBCache } from '../../services/indexedDBCache';
import { languageService } from '../../services/languageService';
import { getKidsDailyLimitMinutes } from '../../services/watchLimitsService';
import pt from '../../locales/ui/pt.json';
import en from '../../locales/ui/en.json';
import es from '../../locales/ui/es.json';

/**
 * 🔓 "Liberar nesta sessão" — o caminho inteiro, rodando.
 *
 * `parentalService.unlockSession()` estava completo e sem NENHUM chamador no
 * app, embora doze lugares leiam `isSessionUnlocked()` e ele seja a válvula do
 * gate inteiro (`isParentalActive` em contentGate.ts). O adulto que ligou o
 * controle e queria ver um título barrado só tinha a saída de DESLIGAR o
 * controle inteiro.
 *
 * Duas chaves de sessão convivem na seção, e o teste cobra que NUNCA se
 * misturem: o destrave da SEÇÃO (#547, `unlockParentalSettings`) e a liberação
 * do CONTEÚDO (este item, `unlockSession`). Provar o PIN para mexer no limite
 * de tela do filho não abre o catálogo adulto; liberar o catálogo não abre as
 * Configurações.
 *
 * A seção é montada de verdade, o PIN é o de verdade (`setPin` +
 * `crypto.subtle`), e o que se afirma é o ESTADO DO GATE e os RÓTULOS
 * renderizados — um botão que diz "Liberar" enquanto tranca é um defeito que
 * nenhuma asserção de estado enxerga.
 */

const PIN = '1234';

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
};

/** Categoria que o gate esconde quando o parental está valendo. */
const CATEGORIA_ADULTA = 'Canais Adulto';

const rotulo = (chave: string) => languageService.t('parental', chave);

let container: HTMLDivElement;
let root: Root;

/** Liga o parental e salva um PIN de verdade (hash salgado, como o app faz). */
async function comPinSalvo() {
    parentalService.setConfig({ enabled: true, blockAdultCategories: true, maxRating: 'L' });
    await parentalService.setPin(PIN);
}

async function montar() {
    await act(async () => { root.render(<ParentalSection />); });
    // O contador de ocultos resolve depois do mount (promessa já resolvida
    // pelo dublê do IndexedDB — aqui não há crypto nenhum).
    await act(async () => {
        for (let i = 0; i < 6; i++) await Promise.resolve();
    });
}

/**
 * Espera uma CONDIÇÃO, não um número de microtasks nem de voltas.
 *
 * `verifyPin` passa por PBKDF2 no `crypto.subtle`, que resolve numa volta do
 * event loop: contar promessas é aposta, e sob a carga da suíte inteira a
 * aposta perde — o teste pisca vermelho sem nada de errado no código.
 */
async function esperarAte(cond: () => boolean, oQue: string) {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`esperei demais: ${oQue}`);
}

async function clicar(elemento: HTMLElement) {
    await act(async () => { elemento.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/** A linha da seção cujo <label> contém o rótulo traduzido. */
function linha(chave: string): HTMLElement {
    const texto = rotulo(chave);
    const itens = Array.from(container.querySelectorAll('.setting-item')) as HTMLElement[];
    const achada = itens.find(item => item.querySelector('label')?.textContent?.includes(texto));
    if (!achada) throw new Error(`não achei a linha "${texto}" na seção parental`);
    return achada;
}

/**
 * O botão de liberar/trancar o CONTEÚDO, achado pelo rótulo traduzido de um
 * dos dois estados. `null` se ele não está na tela.
 */
function botaoLiberacao(): HTMLButtonElement | null {
    const grupo = container.querySelector('.settings-group');
    const textos = [rotulo('sessionUnlock'), rotulo('sessionLockAgain')];
    const botoes = Array.from(grupo?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    return botoes.find(b => textos.includes((b.textContent ?? '').trim())) ?? null;
}

function botaoLiberacaoNaTela(): HTMLButtonElement {
    const botao = botaoLiberacao();
    if (!botao) throw new Error('o botão de liberar a sessão não existe na tela');
    return botao;
}

/** O convite para destravar a SEÇÃO (só existe enquanto ela está trancada). */
function botaoDestravarSecao(): HTMLButtonElement | null {
    const grupo = container.querySelector('.settings-group');
    const botoes = Array.from(grupo?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    return botoes.find(b => b.textContent?.includes('Desbloquear')) ?? null;
}

function modal(): HTMLElement | null {
    return container.querySelector('.pin-modal-overlay');
}

/** Digita no campo escondido do modal (o React só enxerga o setter nativo). */
async function digitarPin(pin: string) {
    const campo = container.querySelector('#pin-hidden-input') as HTMLInputElement | null;
    if (!campo) throw new Error('o modal de PIN não está aberto');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
        setter?.call(campo, pin);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** Aperta o botão de ação DENTRO do modal e espera o modal REAGIR. */
async function enviarPin() {
    const aberto = modal();
    const botoes = Array.from(aberto?.querySelectorAll('button') ?? []) as HTMLElement[];
    if (!botoes.length) throw new Error('o modal de PIN não está aberto');
    const antes = aberto?.textContent ?? '';
    await clicar(botoes[botoes.length - 1]);
    // Fechar (PIN certo), avisar erro (PIN errado) ou trocar de etapa.
    await esperarAte(() => {
        const agora = modal();
        return !agora || (agora.textContent ?? '') !== antes;
    }, 'o modal do PIN não respondeu ao envio');
}

/** Clica em "Liberar nesta sessão", digita o PIN e confirma. */
async function liberarComPin(pin: string) {
    await clicar(botaoLiberacaoNaTela());
    await digitarPin(pin);
    await enviarPin();
}

/** O gate parental está valendo agora, com a config que está salva? */
function gateValendo(): boolean {
    const cfg = parentalService.getConfig();
    return isParentalActive({
        isKidsProfile: false,
        parentalEnabled: cfg.enabled,
        blockAdultCategories: cfg.blockAdultCategories,
        sessionUnlocked: parentalService.isSessionUnlocked(),
    });
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();
    parentalService.setConfig(CONFIG_LIMPA);
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
    parentalService.lockSession();
    parentalService.lockParentalSettings();
    parentalService.setConfig(CONFIG_LIMPA);
    localStorage.clear();
    sessionStorage.clear();
});

describe('liberar o conteúdo com o PIN só nesta sessão', () => {
    it('acertar o PIN derruba o gate sem desligar o controle parental', async () => {
        await comPinSalvo();
        parentalService.unlockParentalSettings();
        await montar();

        expect(gateValendo()).toBe(true);
        expect(parentalService.shouldHideContent(CATEGORIA_ADULTA)).toBe(true);

        await liberarComPin(PIN);

        expect(modal()).toBeNull();
        // O que importa não é "unlockSession foi chamado": é o gate ter caído.
        expect(gateValendo()).toBe(false);
        expect(parentalService.shouldHideContent(CATEGORIA_ADULTA)).toBe(false);
        // E o controle continua LIGADO: é liberação de sessão, não desligamento.
        expect(parentalService.getConfig().enabled).toBe(true);
    });

    it('errar o PIN não libera nada', async () => {
        await comPinSalvo();
        await montar();

        await liberarComPin('9999');

        expect(modal()?.textContent).toContain(rotulo('pinIncorrect'));
        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(gateValendo()).toBe(true);
        expect(botaoLiberacaoNaTela().textContent).toBe(rotulo('sessionUnlock'));
    });

    it('o modal pergunta o PIN sem mentir que é para DESATIVAR o controle', async () => {
        await comPinSalvo();
        await montar();

        await clicar(botaoLiberacaoNaTela());

        const aberto = modal()!;
        expect(aberto).not.toBeNull();
        // 'verifyPin' é "Digite o PIN para desativar" — não serve aqui.
        expect(aberto.querySelector('h2')?.textContent?.trim()).toBe(rotulo('pin'));
        expect(aberto.textContent).not.toContain(rotulo('verifyPin'));
        expect(aberto.textContent).toContain(rotulo('enterPin'));
        // E o botão de confirmar não promete um segundo passo que não existe.
        const botoes = aberto.querySelectorAll('button');
        expect(botoes[botoes.length - 1].textContent).toContain('Desbloquear');
    });
});

describe('a liberação do CONTEÚDO e o destrave da SEÇÃO não se misturam', () => {
    it('com a seção TRANCADA o botão de liberar está na tela e clicável', async () => {
        await comPinSalvo();
        await montar();

        // A seção está trancada (#547)...
        expect(botaoDestravarSecao()).not.toBeNull();
        // ...e mesmo assim liberar o conteúdo continua ao alcance: ele pede o
        // PIN por conta própria.
        const botao = botaoLiberacao();
        expect(botao).not.toBeNull();
        expect(botao!.disabled).toBe(false);
    });

    it('liberar com a seção trancada NÃO destrava a seção', async () => {
        await comPinSalvo();
        await montar();

        await liberarComPin(PIN);

        expect(gateValendo()).toBe(false);
        // A seção continua exatamente como estava: trancada.
        expect(parentalService.isParentalSettingsUnlocked()).toBe(false);
        expect(botaoDestravarSecao()).not.toBeNull();
        expect((linha('kidsLimit').querySelector('select') as HTMLSelectElement).disabled).toBe(true);
    });

    it('com a seção DESTRAVADA, liberar ainda pede o PIN — o destrave da seção não vale para o conteúdo', async () => {
        await comPinSalvo();
        parentalService.unlockParentalSettings();
        await montar();

        await clicar(botaoLiberacaoNaTela());

        // O clique só abre a conferência; o gate não cai por ter a seção aberta.
        expect(modal()).not.toBeNull();
        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(gateValendo()).toBe(true);
    });

    it('destravar a seção com o PIN NÃO libera o conteúdo', async () => {
        await comPinSalvo();
        await montar();

        await clicar(botaoDestravarSecao()!);
        await digitarPin(PIN);
        await enviarPin();

        expect(parentalService.isParentalSettingsUnlocked()).toBe(true);
        expect(gateValendo()).toBe(true);
        expect(parentalService.shouldHideContent(CATEGORIA_ADULTA)).toBe(true);
        // E o botão de conteúdo continua oferecendo LIBERAR.
        expect(botaoLiberacaoNaTela().textContent).toBe(rotulo('sessionUnlock'));
    });
});

describe('trancar de volta', () => {
    it('o mesmo botão tranca depois de liberado, e o gate volta', async () => {
        await comPinSalvo();
        await montar();
        await liberarComPin(PIN);
        expect(gateValendo()).toBe(false);

        await clicar(botaoLiberacaoNaTela());

        expect(modal()).toBeNull();
        expect(gateValendo()).toBe(true);
        expect(botaoLiberacaoNaTela().textContent).toBe(rotulo('sessionUnlock'));
    });

    it('o rótulo e a descrição dizem o que o clique vai fazer, antes e depois', async () => {
        await comPinSalvo();
        await montar();
        expect(botaoLiberacaoNaTela().textContent).toBe(rotulo('sessionUnlock'));
        expect(container.textContent).toContain(rotulo('sessionLockedDesc'));

        await liberarComPin(PIN);

        expect(botaoLiberacaoNaTela().textContent).toBe(rotulo('sessionLockAgain'));
        expect(container.textContent).toContain(rotulo('sessionUnlockedDesc'));
        expect(container.textContent).not.toContain(rotulo('sessionLockedDesc'));
    });

    it('voltando a Configurações com a sessão JÁ liberada, o botão oferece trancar', async () => {
        // Sem isto não há como re-trancar sem fechar o app: quem liberou, saiu
        // da tela e voltou encontraria o botão oferecendo liberar de novo.
        await comPinSalvo();
        parentalService.unlockSession();
        await montar();

        expect(botaoLiberacaoNaTela().textContent).toBe(rotulo('sessionLockAgain'));

        await clicar(botaoLiberacaoNaTela());

        expect(gateValendo()).toBe(true);
    });

    it('sem PIN salvo, ou com o controle desligado, o botão fica desabilitado', async () => {
        parentalService.setConfig({ enabled: true });
        await montar();
        expect(botaoLiberacaoNaTela().disabled).toBe(true);

        await act(async () => { root.unmount(); });
        root = createRoot(container);
        await comPinSalvo();
        parentalService.setConfig({ enabled: false });
        await montar();
        expect(botaoLiberacaoNaTela().disabled).toBe(true);
    });
});

describe('a liberação morre quando tem de morrer', () => {
    it('religar o controle parental fecha a liberação em curso', async () => {
        // Senão o parental volta LIGADO E INERTE: isParentalActive é
        // `enabled && !sessionUnlocked`, então a chave de sessão que ficou de
        // pé anula o controle recém-religado, sem aviso na tela.
        await comPinSalvo();
        parentalService.setConfig({ enabled: false });
        parentalService.unlockSession();
        await montar();

        const ativar = linha('enable').querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(ativar.checked).toBe(false);
        await clicar(ativar);

        expect(parentalService.getConfig().enabled).toBe(true);
        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(gateValendo()).toBe(true);
        // E a tela não pode continuar oferecendo "Trancar de novo" sobre uma
        // sessão que já está trancada.
        expect(botaoLiberacaoNaTela().textContent).toBe(rotulo('sessionUnlock'));
    });

    it('trocar de perfil tranca a sessão que o PIN tinha liberado', async () => {
        await comPinSalvo();
        parentalService.unlockSession();
        expect(gateValendo()).toBe(false);

        expect(profileService.setActiveProfile('filho')).toBe(true);

        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(gateValendo()).toBe(true);
    });

    it('entrar como convidado tranca a sessão — é trocar de perfil por outra porta', async () => {
        // O botão "Entrar como convidado" da tela de perfis chama
        // startGuestSession(), que NÃO passa por setActiveProfile. Sem trancar
        // lá, a visita herdava o catálogo que o dono tinha liberado.
        await comPinSalvo();
        parentalService.unlockSession();
        expect(gateValendo()).toBe(false);

        profileService.startGuestSession();

        expect(profileService.isGuestActive()).toBe(true);
        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(gateValendo()).toBe(true);
    });

    it('sair do perfil (logout) tranca a sessão liberada', async () => {
        await comPinSalvo();
        parentalService.unlockSession();

        profileService.clearActiveProfile();

        expect(profileService.getActiveProfile()).toBeNull();
        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(gateValendo()).toBe(true);
    });

    it('trocar de perfil NÃO destrava a seção nem mexe nela — só tranca o conteúdo', async () => {
        await comPinSalvo();
        parentalService.unlockSession();

        profileService.setActiveProfile('filho');

        expect(parentalService.isSessionUnlocked()).toBe(false);
        expect(parentalService.isParentalSettingsUnlocked()).toBe(false);
    });

    it('a liberação não mexe no limite de tela nem em nada da seção', async () => {
        await comPinSalvo();
        await montar();
        await liberarComPin(PIN);

        await act(async () => {
            const select = linha('kidsLimit').querySelector('select') as HTMLSelectElement;
            select.value = '180';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(getKidsDailyLimitMinutes()).toBe(0);
    });
});

describe('os quatro textos existem nas três línguas', () => {
    const CHAVES = ['sessionUnlock', 'sessionLockAgain', 'sessionLockedDesc', 'sessionUnlockedDesc'] as const;
    const locais = { pt, en, es } as unknown as Record<string, { parental: Record<string, string | undefined> }>;

    it.each(['pt', 'en', 'es'])('%s tem as quatro chaves, preenchidas', (idioma) => {
        for (const chave of CHAVES) {
            const texto = locais[idioma].parental[chave];
            expect(typeof texto, `${idioma}.parental.${chave}`).toBe('string');
            expect((texto ?? '').trim().length, `${idioma}.parental.${chave}`).toBeGreaterThan(0);
        }
    });

    it.each(['en', 'es'])('%s está traduzido, não copiado do português', (idioma) => {
        expect(locais[idioma].parental.sessionUnlock).not.toBe(pt.parental.sessionUnlock);
        expect(locais[idioma].parental.sessionLockAgain).not.toBe(pt.parental.sessionLockAgain);
    });
});
