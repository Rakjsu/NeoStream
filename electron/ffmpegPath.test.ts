import { describe, it, expect } from 'vitest';
import { foraDoAsar } from './ffmpegPath';

// A regra de uma linha que já deixou o DVR morto (#242): num app empacotado o
// binário fica FORA do asar, e o caminho que o ffmpeg-static devolve aponta
// para dentro. Errar isso não dá erro nenhum — o spawn falha lá adiante, com
// "gravação não iniciou" e nada mais.
describe('foraDoAsar', () => {
    it('reescreve o caminho dentro do asar', () => {
        expect(foraDoAsar('C:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'))
            .toBe('C:\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe');
    });

    it('vale para o separador do Linux e do macOS também', () => {
        expect(foraDoAsar('/opt/App/resources/app.asar/node_modules/ffmpeg-static/ffmpeg'))
            .toBe('/opt/App/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg');
    });

    // Em desenvolvimento não há asar nenhum: o caminho tem que sair intacto.
    it('caminho sem asar volta como está', () => {
        const dev = 'C:\\dev\\NeoStream\\node_modules\\ffmpeg-static\\ffmpeg.exe';
        expect(foraDoAsar(dev)).toBe(dev);
    });

    // Reescrever mais de uma vez produziria "app.asar.unpacked.unpacked".
    it('não reescreve um caminho que já está fora do asar', () => {
        const jaFora = '/opt/App/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg';
        expect(foraDoAsar(jaFora)).toBe(jaFora);
    });
});
