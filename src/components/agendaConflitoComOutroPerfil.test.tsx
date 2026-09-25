import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgendaPanel } from './AgendaPanel';
import { languageService } from '../services/languageService';
import { scheduleId, type ScheduledRecording } from '../services/scheduledRecordingService';

/**
 * ⚠ O aviso de CONFLITO da agenda tem que contar a gravação do OUTRO perfil (D065).
 *
 * Desde o D065 o boot arma os agendamentos de todos os perfis: gravar é da
 * máquina, e o limite de gravações simultâneas também. A agenda que cada
 * perfil vê continua sendo só a dele — mas se o aviso medisse a vaga só contra
 * ela, diria "cabe" para uma gravação que vai ficar de fora porque o jogo que
 * o outro perfil agendou já ocupou a vaga. É o "falha sozinha, sem aviso" que
 * a marca de conflito existe para impedir.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function perfis(ativo: string, ...ids: string[]) {
    localStorage.setItem('neostream_profiles', JSON.stringify({
        profiles: ids.map(id => ({ id, name: `Perfil ${id}`, avatar: '', createdAt: '', lastUsed: '' })),
        activeProfileId: ativo,
    }));
}

function gravacao(title: string, channelName: string, inicioH: number, fimH: number): ScheduledRecording {
    const startIso = new Date(Date.now() + inicioH * 3600_000).toISOString();
    const endIso = new Date(Date.now() + fimH * 3600_000).toISOString();
    return { id: scheduleId(channelName, startIso), title, channelName, streamId: 1, startIso, endIso };
}

function guardarNoPerfil(perfilId: string, ...recs: ScheduledRecording[]) {
    localStorage.setItem(`scheduled_recordings_${perfilId}`, JSON.stringify(recs));
}

async function montar() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<AgendaPanel />); });
}

function linha(titulo: string): HTMLElement {
    const linhas = Array.from(container!.querySelectorAll('.agenda-row')) as HTMLElement[];
    const alvo = linhas.find(l => l.textContent?.includes(titulo));
    if (!alvo) throw new Error(`linha "${titulo}" não está na agenda: ${linhas.map(l => l.textContent).join(' | ')}`);
    return alvo;
}

const CONFLITO = () => languageService.t('agenda', 'conflict');

beforeEach(() => {
    localStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Uma gravação por vez: qualquer sobreposição disputa a vaga.
    localStorage.setItem('neostream_dvr_max_concurrent', '1');
});

afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    root = null;
    container = null;
});

describe('AgendaPanel — conflito com agendamento de outro perfil (D065)', () => {
    it('gravação do perfil ativo que bate com a do outro perfil é marcada em CONFLITO', async () => {
        perfis('b', 'a', 'b');
        guardarNoPerfil('a', gravacao('Jogo do A', 'Canal A', 24, 26));
        guardarNoPerfil('b', gravacao('Filme do B', 'Canal B', 25, 27));

        await montar();

        await vi.waitFor(() => expect(linha('Filme do B').textContent).toContain(CONFLITO()));
        // A agenda mostrada continua sendo só a do perfil ativo.
        expect(container!.textContent).not.toContain('Jogo do A');
    });

    it('sem o agendamento do outro perfil, a mesma gravação cabe e não tem aviso', async () => {
        perfis('b', 'a', 'b');
        guardarNoPerfil('b', gravacao('Filme do B', 'Canal B', 25, 27));

        await montar();

        await vi.waitFor(() => expect(linha('Filme do B')).toBeTruthy());
        expect(linha('Filme do B').textContent).not.toContain(CONFLITO());
    });
});
