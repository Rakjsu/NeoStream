// ═══════════════════════════════════════════════════════════════════════
// NeoStream IPTV — portão de sintaxe do instalador customizado (D150)
//
// installer-shell/ vira o NeoStream-IPTV-Installer-<versão>.exe anexado a
// toda release (release.yml → build/build-custom-installer.cjs) e é a
// primeira coisa que o usuário do Windows vê. Mas nenhuma ferramenta olha
// para esse JavaScript: está no globalIgnores do eslint.config.js, fora de
// todo tsconfig (tsconfig.app.json só inclui src/). Um erro de sintaxe ali
// só aparecia na mão de quem baixou o instalador: janela branca
// (renderer/app.js) ou o exe morrendo ao abrir (main.cjs/preload.cjs).
//
// Roda `node --check` em TODO .js/.cjs/.mjs do shell — arquivo novo entra
// sozinho, sem lista para esquecer de atualizar. O build do instalador chama
// isto ANTES de qualquer outra coisa; electron/instaladorCustomSintaxe.test.ts
// roda o mesmo portão contra o shell real na CI (Windows e Linux) a cada PR.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSOES = new Set(['.js', '.cjs', '.mjs']);

function listarScripts(dir) {
    const achados = [];
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
            // Dependências de terceiros não são código do shell (um `npm install`
            // solto ali para testar o shell à mão encheria o portão de pacotes).
            if (entrada.name !== 'node_modules') achados.push(...listarScripts(completo));
        }
        else if (EXTENSOES.has(path.extname(entrada.name))) achados.push(completo);
    }
    return achados;
}

/**
 * @param {string} shellDir pasta do installer-shell
 * @returns {{ conferidos: string[], falhas: { arquivo: string, detalhe: string }[] }}
 */
function conferirSintaxeDoShell(shellDir) {
    const conferidos = [];
    const falhas = [];
    for (const arquivo of listarScripts(shellDir)) {
        const nome = path.relative(shellDir, arquivo).split(path.sep).join('/');
        conferidos.push(nome);
        const r = spawnSync(process.execPath, ['--check', arquivo], { encoding: 'utf8' });
        // status null (não deu nem para rodar) também reprova: o portão falha fechado.
        if (r.status !== 0) falhas.push({ arquivo: nome, detalhe: (r.stderr || '').trim() });
    }
    return { conferidos, falhas };
}

/** Lança se o shell não passar — é o que o build do instalador usa. */
function exigirSintaxeDoShell(shellDir) {
    const { conferidos, falhas } = conferirSintaxeDoShell(shellDir);
    if (falhas.length > 0) {
        const lista = falhas.map((f) => `  - ${f.arquivo}:\n${f.detalhe}`).join('\n');
        throw new Error(`installer-shell com JavaScript quebrado — o instalador não será gerado:\n${lista}`);
    }
    return conferidos;
}

module.exports = { conferirSintaxeDoShell, exigirSintaxeDoShell };
