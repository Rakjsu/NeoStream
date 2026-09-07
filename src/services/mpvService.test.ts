import { describe, it, expect, vi } from 'vitest';
import { mpvService } from './mpvService';

/**
 * O botão "Baixar MPV automaticamente" só faz sentido no Windows: o pacote é
 * um .7z de build Windows e o binário procurado depois é `mpv.exe`. Quem
 * decide é o main — o renderer não tem como saber a plataforma sozinho, e o
 * preload não expõe `process.platform`.
 *
 * Estes casos travam o lado SEGURO da decisão: na dúvida, o botão some.
 */
describe('mpvService.getAvailability', () => {
    const comResposta = (resposta: unknown) => {
        const invoke = vi.fn(async () => resposta);
        (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
    };

    it('repassa o que o main respondeu', async () => {
        comResposta({ path: 'C:/mpv/mpv.exe', configuredPath: null, downloadSupported: true });
        expect(await mpvService.getAvailability())
            .toEqual({ path: 'C:/mpv/mpv.exe', configuredPath: null, downloadSupported: true });
    });

    // Build mais velho que a tela: o campo simplesmente não vem.
    it('main sem o campo cai em false, não em undefined', async () => {
        comResposta({ path: null, configuredPath: null });
        expect((await mpvService.getAvailability()).downloadSupported).toBe(false);
    });

    it('qualquer coisa que não seja true é false', async () => {
        for (const valor of ['true', 1, {}, null]) {
            comResposta({ path: null, configuredPath: null, downloadSupported: valor });
            expect((await mpvService.getAvailability()).downloadSupported).toBe(false);
        }
    });

    it('IPC quebrado não derruba a tela — e some com o botão', async () => {
        const invoke = vi.fn(async () => { throw new Error('sem preload'); });
        (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
        expect(await mpvService.getAvailability())
            .toEqual({ path: null, configuredPath: null, downloadSupported: false });
    });
});
