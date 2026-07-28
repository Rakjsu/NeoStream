import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 🔐 Trava estrutural do gate de PIN.
 *
 * O `/recording` era a ÚNICA rota autenticada que comparava o PIN à mão, sem
 * registrar a falha. Isso a transformava num oráculo de força bruta ilimitado:
 * PIN errado devolvia 403, PIN certo caía no 404 de "arquivo não encontrado" —
 * bastava varrer as 10 mil combinações olhando o status. Com o PIN, o `/setup`
 * entrega usuário e senha de todos os provedores.
 *
 * A causa foi a checagem existir em cópias. Estes testes leem o fonte e falham
 * se alguém escrever uma quinta cópia, se uma rota nova nascer sem gate, ou se
 * o corpo do servidor voltar a tocar no `sessionPin` diretamente.
 */
const SERVIDOR = path.join(__dirname, 'webRemoteServer.ts');
// Normaliza CRLF: o recorte por marcador de bloco falhava em silêncio no
// Windows e devolvia o arquivo inteiro, passando o teste por acidente.
const fonte = fs.readFileSync(SERVIDOR, 'utf8').split(String.fromCharCode(13)).join('');

/** Rotas que EXIGEM PIN. */
const ROTAS_COM_PIN = ['/transfer?', '/recording?', '/setup'];

/** Rotas públicas de propósito — mudar isto tem que ser decisão consciente. */
const ROTAS_PUBLICAS = ['/health', '/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon.png'];

/** Toda rota que o servidor reconhece, extraída do fonte. */
function rotasDoFonte(): string[] {
    const achadas = new Set<string>();
    for (const m of fonte.matchAll(/req\.url\s*(?:===\s*|&&\s*req\.url\.startsWith\(\s*)'([^']+)'/g)) {
        achadas.add(m[1]);
    }
    return [...achadas];
}

/** Corpo do handler HTTP (onde vivem todas as rotas). */
function corpoDoHandler(): string {
    const inicio = fonte.indexOf('const handler = (req: http.IncomingMessage');
    expect(inicio, 'handler HTTP sumiu — o teste precisa ser reapontado').toBeGreaterThan(-1);
    return fonte.slice(inicio, fonte.indexOf('\n    }\n', fonte.indexOf('res.writeHead(404)', inicio)));
}

describe('gate de PIN: nenhuma rota autenticada escapa', () => {
    it('a lista de rotas do teste cobre TODAS as rotas do servidor', () => {
        // Sem isto, rota autenticada nova nasce sem gate e sem entrada aqui —
        // e o teste fica verde justamente no caso que ele existe pra pegar.
        const conhecidas = new Set([...ROTAS_COM_PIN, ...ROTAS_PUBLICAS]);
        const orfas = rotasDoFonte().filter(r => !conhecidas.has(r));
        expect(orfas, `rota sem classificação: ${orfas.join(', ')} — some em ROTAS_COM_PIN ou ROTAS_PUBLICAS`).toHaveLength(0);
    });

    it.each(ROTAS_COM_PIN)('a rota %s passa pelo gate único', rota => {
        const inicio = fonte.indexOf(`'${rota}'`);
        expect(inicio, `rota ${rota} sumiu do servidor`).toBeGreaterThan(-1);
        // A fatia PARA na próxima rota: com janela de tamanho fixo, extrair as
        // rotas estáticas vizinhas fazia o `respondPin` do /setup ser lido como
        // se fosse o do /recording, e o bug passava verde.
        const seguintes = rotasDoFonte()
            .map(r => fonte.indexOf(`'${r}'`, inicio + rota.length + 2))
            .filter(i => i > inicio);
        const fim = seguintes.length ? Math.min(...seguintes) : fonte.length;
        expect(fonte.slice(inicio, fim), `${rota} precisa chamar respondPin (o gate único)`).toContain('respondPin(');
    });

    it('só existe UMA implementação do gate', () => {
        expect(fonte.match(/function checkPin\(/g)).toHaveLength(1);
        expect(fonte.match(/function respondPin\(/g)).toHaveLength(1);
    });

    it('o corpo do servidor não toca no sessionPin — só o gate toca', () => {
        // Trava por AUSÊNCIA, não por padrão de operador: `!=`, comparação
        // invertida e `includes` escapavam de uma regex de `!==`.
        const ocorrencias = corpoDoHandler().match(/sessionPin/g) ?? [];
        expect(ocorrencias, 'o handler HTTP referencia sessionPin fora do gate').toHaveLength(0);
    });

    it('o gate registra a falha, consulta o bloqueio e tem teto global', () => {
        const corpo = fonte.slice(fonte.indexOf('function checkPin('), fonte.indexOf('function resetPinGate('));
        expect(corpo).toContain('isPinLockedOut');
        expect(corpo).toContain('registerPinFailure');
        expect(corpo).toContain('pinGlobal');
        expect(corpo).toContain('pinMatches'); // comparação em tempo constante
    });

    it('trocar o PIN e parar o servidor zeram o gate inteiro', () => {
        // O teto global sobrevivendo ao regen-pin era auto-DoS: os aparelhos do
        // dono, com o PIN velho, trancavam o pareamento do PIN novo.
        const regen = fonte.slice(fonte.indexOf("'web-remote:regen-pin'"), fonte.indexOf("'web-remote:regen-pin'") + 900);
        expect(regen, 'regen-pin precisa chamar resetPinGate').toContain('resetPinGate()');
        expect(fonte.match(/resetPinGate\(\)/g)?.length, 'resetPinGate deve rodar no regen-pin E no stop').toBeGreaterThanOrEqual(3);
    });

    it('/recording responde o MESMO status pra PIN errado e arquivo ausente', () => {
        const inicio = fonte.indexOf("'/recording?'");
        const trecho = fonte.slice(inicio, inicio + 1200);
        // 403 pra PIN e 404 pra arquivo era o oráculo binário da força bruta.
        expect(trecho, '/recording deve pedir 404 no PIN errado').toContain('404)');
        expect(trecho).not.toContain("res.end('PIN')");
    });
});
