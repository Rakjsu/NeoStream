#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// NeoStream IPTV — build do instalador customizado
//
// Empacota o "installer shell" (installer-shell/, Electron frameless com a
// cara do app) como um exe PORTABLE que carrega embutido o NSIS Setup
// padrão do electron-builder e o executa em modo silencioso (/S /D=dir).
// O produto instalado continua sendo o NSIS padrão → electron-updater
// segue funcionando normalmente.
//
// Uso:  node build/build-custom-installer.cjs
// Saída: release/NeoStream-IPTV-Installer-<version>.exe
//
// EPERM quirk: builds dentro de C:\Users\...\Music podem falhar no rename
// de win-unpacked.tmp (WMPNetworkSvc tranca diretórios novos lá). Por isso
// o shell é construído em os.tmpdir() e só o exe final volta pra release/.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHELL_DIR = path.join(ROOT, 'installer-shell');
const RELEASE_DIR = path.join(ROOT, 'release');

const version = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).version;

const setupName = `NeoStream-IPTV-Setup-${version}.exe`;
const installerName = `NeoStream-IPTV-Installer-${version}.exe`;

function log(msg) {
    console.log(`[custom-installer] ${msg}`);
}

function run(cmd, args, opts = {}) {
    log(`$ ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32', // npm/npx are .cmd shims on Windows
        ...opts,
    });
    if (result.status !== 0) {
        throw new Error(`${cmd} exited with code ${result.status}`);
    }
}

// ─── 1. Locate (or build) the silent NSIS payload ───────────────────────

function findSetupExe() {
    const candidates = [
        path.join(RELEASE_DIR, setupName),
        // build cache used during release prep on this machine
        path.join(os.tmpdir(), 'neostream-release', setupName),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
}

let setupExe = findSetupExe();
if (!setupExe) {
    log(`${setupName} não encontrado — rodando o build completo do app...`);
    run('npm', ['run', 'build:win', '--', '--publish', 'never']);
    setupExe = findSetupExe();
    if (!setupExe) {
        throw new Error(`Build terminou mas ${setupName} não foi encontrado.`);
    }
}
log(`payload: ${setupExe}`);

// ─── 2. Stage payload + sync version into the shell package.json ────────

const payloadDest = path.join(SHELL_DIR, 'payload.exe');
fs.copyFileSync(setupExe, payloadDest);

const shellPkgPath = path.join(SHELL_DIR, 'package.json');
const shellPkg = JSON.parse(fs.readFileSync(shellPkgPath, 'utf8'));
if (shellPkg.version !== version) {
    shellPkg.version = version;
    fs.writeFileSync(shellPkgPath, JSON.stringify(shellPkg, null, 2) + '\n');
    log(`installer-shell/package.json: versão sincronizada → ${version}`);
}

// ─── 3. Build the shell portable exe (output OUTSIDE Music, see header) ─

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-installer-shell-'));
log(`output temporário: ${outDir}`);

try {
    run('npx', [
        'electron-builder',
        '--win', 'portable',
        '--config', 'installer-shell/electron-builder.yml',
        `-c.directories.output=${outDir}`,
        '--publish', 'never',
    ]);

    // Sanity check: the payload must be inside the packaged resources.
    const packedPayload = path.join(outDir, 'win-unpacked', 'resources', 'payload.exe');
    if (!fs.existsSync(packedPayload)) {
        throw new Error('payload.exe não foi embutido nos resources do shell.');
    }

    const builtExe = path.join(outDir, installerName);
    if (!fs.existsSync(builtExe)) {
        throw new Error(`Artefato esperado não encontrado: ${builtExe}`);
    }

    fs.mkdirSync(RELEASE_DIR, { recursive: true });
    const finalExe = path.join(RELEASE_DIR, installerName);
    fs.copyFileSync(builtExe, finalExe);
    log(`OK → ${finalExe}`);
} finally {
    fs.rmSync(outDir, { recursive: true, force: true });
}
