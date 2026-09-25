import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UpdateNotification } from './UpdateNotification';
import { UpdateModal } from './UpdateModal';
import { SHOW_UP_TO_DATE_MODAL_EVENT } from './updateNotificationBus';
import { updateService } from '../services/updateService';
import { languageService, type SupportedLanguage } from '../services/languageService';
import type { UpdateInfo, DownloadProgress } from '../types/update';
import pt from '../locales/ui/pt.json';
import en from '../locales/ui/en.json';
import es from '../locales/ui/es.json';

/**
 * 🌐 O aviso de atualização fala o idioma da pessoa (#D126).
 *
 * Os dois diálogos de atualização — o `UpdateNotification` (montado sempre no
 * App, é o que aparece depois de "Verificar Atualizações Agora") e o
 * `UpdateModal` (aberto pelo selo da Sidebar) — já importavam `useLanguage`,
 * mas quase todo o texto estava cravado em português: quem usa o app em
 * inglês ou espanhol recebia "Nova Atualização Disponível!", "Baixar Agora",
 * "Pular esta versão", "Versão Atual"...
 *
 * Os componentes são montados DE VERDADE e passam por todos os estados
 * (atualizado, disponível, baixando, baixado, erro); o `updateService` só é
 * espionado para o teste disparar os eventos do main. O que se afirma é o
 * TEXTO RENDERIZADO: nenhum trecho português cravado, e cada texto no idioma
 * escolhido.
 */

type Dicionario = Record<string, Record<string, string>>;
const DICIONARIOS: Record<SupportedLanguage, Dicionario> = { pt, en, es };

/**
 * Trechos que estavam cravados nos dois componentes. Nenhum pode sobrar em en/es.
 * A busca diferencia maiúsculas DE PROPÓSITO: o es.json diz "Reiniciar e
 * instalar" (espanhol legítimo, mesmas palavras do pt). Se um dia o es ficar
 * idêntico ao pt "Reiniciar e Instalar", tire só esse trecho da lista em vez
 * de afrouxar a checagem inteira.
 */
const CRAVADOS_EM_PT = [
    'Você está atualizado',
    'versão mais recente',
    'Nova Atualização Disponível',
    'Baixando atualização',
    'Baixando...',
    'Download concluído',
    'Uma nova versão',
    'Reiniciar e Instalar',
    'Instalar e Reiniciar',
    'Baixar Agora',
    'Mais Tarde',
    'Pular esta versão',
    'Pular Esta Versão',
    'Versão Atual',
    'Nova Versão',
    'Novidades',
    'Depois',
    'Erro ao atualizar',
    'Erro ao baixar',
];

const INFO: UpdateInfo = {
    version: '9.9.9',
    releaseDate: '2026-09-25',
    releaseNotes: '<p>notas</p>',
    files: [],
};

const PROGRESSO: DownloadProgress = {
    percent: 42,
    transferred: 42 * 1024 * 1024,
    total: 100 * 1024 * 1024,
    delta: 1024,
    bytesPerSecond: 2 * 1024 * 1024,
};

/** O que o main mandaria, capturado das inscrições dos componentes. */
const ouvintes = {
    available: [] as Array<(info: UpdateInfo) => void>,
    progress: [] as Array<(p: DownloadProgress) => void>,
    downloaded: [] as Array<(info: UpdateInfo) => void>,
    error: [] as Array<(e: Error) => void>,
};

let liberarDownload: (r: { success: boolean; error?: string; manual?: boolean }) => void = () => {};

let container: HTMLDivElement;
let root: Root;

async function esperarAte(cond: () => boolean, oQue: string) {
    // Prazo de RELÓGIO, não número de voltas: sob a suíte inteira o import
    // lazy do en/es pode passar de 1 s (mesmo padrão do buscaPorPessoaAnunciadaNoRodape).
    const prazo = Date.now() + 8000;
    while (Date.now() < prazo) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`esperei demais: ${oQue}`);
}

async function trocarIdioma(idioma: SupportedLanguage) {
    languageService.setLanguage(idioma);
    const alvo = DICIONARIOS[idioma].updates.checkNow;
    await esperarAte(() => languageService.t('updates', 'checkNow') === alvo, `dicionário ${idioma}`);
}

const texto = () => container.textContent ?? '';

async function emitir(fn: () => void) {
    await act(async () => { fn(); });
}

function botaoCom(trecho: string): HTMLButtonElement {
    const botoes = Array.from(container.querySelectorAll('button'));
    const achado = botoes.find(b => (b.textContent ?? '').includes(trecho));
    if (!achado) throw new Error(`não achei o botão "${trecho}" em: ${texto()}`);
    return achado;
}

async function clicar(el: HTMLElement) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/** Passa o UpdateNotification por todos os estados e devolve o texto de cada um. */
async function percorrerNotificacao(u: Record<string, string>): Promise<string[]> {
    const vistos: string[] = [];
    await act(async () => { root.render(<UpdateNotification />); });

    // "Você está atualizado" (Configurações → Verificar agora, sem novidade).
    await emitir(() => { window.dispatchEvent(new CustomEvent(SHOW_UP_TO_DATE_MODAL_EVENT)); });
    await esperarAte(() => texto().includes(u.upToDateTitle ?? '\u0000'), 'aviso de "atualizado"');
    vistos.push(texto());
    await clicar(botaoCom(u.gotIt ?? '\u0000'));

    // Atualização disponível.
    await emitir(() => ouvintes.available.forEach(cb => cb(INFO)));
    await esperarAte(() => texto().includes('v9.9.9'), 'aviso de versão nova');
    vistos.push(texto());

    // Baixando (o download fica pendurado até o teste soltar).
    await clicar(botaoCom(u.downloadNow ?? '\u0000'));
    await emitir(() => ouvintes.progress.forEach(cb => cb(PROGRESSO)));
    await esperarAte(() => texto().includes('42%'), 'progresso do download');
    vistos.push(texto());

    // Baixado.
    await emitir(() => ouvintes.downloaded.forEach(cb => cb(INFO)));
    await esperarAte(() => texto().includes(u.restartAndInstall ?? '\u0000'), 'download concluído');
    vistos.push(texto());
    await act(async () => { liberarDownload({ success: true }); });

    // Erro sem mensagem do main: cai no texto de reserva.
    await emitir(() => ouvintes.error.forEach(cb => cb(new Error(''))));
    await esperarAte(() => texto().includes(u.updateError ?? '\u0000'), 'erro de atualização');
    vistos.push(texto());
    return vistos;
}

/** Passa o UpdateModal por todos os estados e devolve o texto de cada um. */
async function percorrerModal(u: Record<string, string>): Promise<string[]> {
    const vistos: string[] = [];
    const fechar = vi.fn();
    await act(async () => { root.render(<UpdateModal isOpen onClose={fechar} updateInfo={INFO} />); });
    await esperarAte(() => texto().includes('v9.9.9'), 'modal aberto');
    vistos.push(texto());

    await clicar(botaoCom(u.downloadNow ?? '\u0000'));
    await emitir(() => ouvintes.progress.forEach(cb => cb(PROGRESSO)));
    await esperarAte(() => texto().includes('42%'), 'progresso do download');
    vistos.push(texto());

    await emitir(() => ouvintes.downloaded.forEach(cb => cb(INFO)));
    await esperarAte(() => texto().includes(u.restartAndInstall ?? '\u0000'), 'download concluído');
    vistos.push(texto());
    await act(async () => { liberarDownload({ success: true }); });

    // Remonta limpo e faz o download falhar sem mensagem: texto de reserva.
    await act(async () => { root.render(<></>); });
    await act(async () => { root.render(<UpdateModal isOpen onClose={fechar} updateInfo={INFO} />); });
    await clicar(botaoCom(u.downloadNow ?? '\u0000'));
    await act(async () => { liberarDownload({ success: false }); });
    await esperarAte(() => texto().includes(u.downloadError ?? '\u0000'), 'erro de download');
    vistos.push(texto());
    return vistos;
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('__APP_VERSION__', '1.0.0');
    ouvintes.available = [];
    ouvintes.progress = [];
    ouvintes.downloaded = [];
    ouvintes.error = [];
    vi.spyOn(updateService, 'autoInstallSupport').mockResolvedValue({ supported: true, releaseUrl: '' });
    vi.spyOn(updateService, 'downloadUpdate').mockImplementation(
        () => new Promise(resolve => { liberarDownload = resolve; }),
    );
    vi.spyOn(updateService, 'installUpdate').mockResolvedValue(undefined);
    vi.spyOn(updateService, 'skipVersion').mockResolvedValue({ success: true });
    vi.spyOn(updateService, 'onUpdateAvailable').mockImplementation(cb => {
        ouvintes.available.push(cb);
        return () => { ouvintes.available = ouvintes.available.filter(x => x !== cb); };
    });
    vi.spyOn(updateService, 'onUpdateNotAvailable').mockImplementation(() => () => {});
    vi.spyOn(updateService, 'onDownloadProgress').mockImplementation(cb => {
        ouvintes.progress.push(cb);
        return () => { ouvintes.progress = ouvintes.progress.filter(x => x !== cb); };
    });
    vi.spyOn(updateService, 'onUpdateDownloaded').mockImplementation(cb => {
        ouvintes.downloaded.push(cb);
        return () => { ouvintes.downloaded = ouvintes.downloaded.filter(x => x !== cb); };
    });
    vi.spyOn(updateService, 'onUpdateError').mockImplementation(cb => {
        ouvintes.error.push(cb);
        return () => { ouvintes.error = ouvintes.error.filter(x => x !== cb); };
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    languageService.setLanguage('pt');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
});

/** Chaves que cada diálogo precisa mostrar em algum dos seus estados. */
const CHAVES_NOTIFICACAO = [
    'upToDateTitle', 'upToDateMessage', 'gotIt', 'newVersionTitle', 'newVersionDescription',
    'downloadNow', 'later', 'skipVersion', 'downloading', 'downloadingShort',
    'downloadedRestart', 'restartAndInstall', 'updateError',
];
const CHAVES_MODAL = [
    'newVersionTitle', 'readyToInstall', 'currentVersion', 'newVersion', 'whatsNew',
    'skipVersion', 'later', 'downloadNow', 'downloading', 'restartAndInstall', 'downloadError',
];

describe.each(['en', 'es'] as const)('aviso de atualização em %s', (idioma) => {
    const u = DICIONARIOS[idioma].updates;

    it('o UpdateNotification não tem texto português cravado em nenhum estado', async () => {
        await trocarIdioma(idioma);
        const tudo = (await percorrerNotificacao(u)).join('\n');
        expect(CRAVADOS_EM_PT.filter(trecho => tudo.includes(trecho))).toEqual([]);
        expect(CHAVES_NOTIFICACAO.filter(chave => !u[chave] || !tudo.includes(u[chave]))).toEqual([]);
    }, 30_000);

    it('o UpdateModal não tem texto português cravado em nenhum estado', async () => {
        await trocarIdioma(idioma);
        const tudo = (await percorrerModal(u)).join('\n');
        expect(CRAVADOS_EM_PT.filter(trecho => tudo.includes(trecho))).toEqual([]);
        expect(CHAVES_MODAL.filter(chave => !u[chave] || !tudo.includes(u[chave]))).toEqual([]);
    }, 30_000);
});

describe('em português nada some', () => {
    it('os dois diálogos mostram os textos do pt.json', async () => {
        await trocarIdioma('pt');
        const u = pt.updates as Record<string, string>;
        const notificacao = (await percorrerNotificacao(u)).join('\n');
        expect(CHAVES_NOTIFICACAO.filter(chave => !u[chave] || !notificacao.includes(u[chave]))).toEqual([]);
        await act(async () => { root.render(<></>); });
        const modal = (await percorrerModal(u)).join('\n');
        expect(CHAVES_MODAL.filter(chave => !u[chave] || !modal.includes(u[chave]))).toEqual([]);
    }, 30_000);
});
