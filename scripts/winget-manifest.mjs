// 📦 Gera os manifests do winget (Rakjsu.NeoStream) pra uma versão já
// publicada no GitHub Releases. O winget exige a URL pública do instalador
// e o SHA256 dele, então isto roda DEPOIS do release:
//
//   node scripts/winget-manifest.mjs 4.32.0 <sha256-do-setup>
//
// Saída em dist/winget/ — copiar a pasta pro fork de microsoft/winget-pkgs
// em manifests/r/Rakjsu/NeoStream/<versão>/ e abrir o PR lá.
import fs from 'node:fs';
import path from 'node:path';

const [version, sha256] = process.argv.slice(2);
if (!version || !sha256 || !/^[0-9a-fA-F]{64}$/.test(sha256)) {
    console.error('uso: node scripts/winget-manifest.mjs <versao> <sha256-64-hex>');
    process.exit(1);
}

const id = 'Rakjsu.NeoStream';
const url = `https://github.com/Rakjsu/NeoStream/releases/download/v${version}/NeoStream-IPTV-Setup-${version}.exe`;
const outDir = path.join('dist', 'winget');

const versionManifest = `PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: pt-BR
ManifestType: version
ManifestVersion: 1.6.0
`;

const installerManifest = `PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
Installers:
  - Architecture: x64
    InstallerUrl: ${url}
    InstallerSha256: ${sha256.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.6.0
`;

const localeManifest = `PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: pt-BR
Publisher: Rakjsu
PackageName: NeoStream IPTV
License: MIT
ShortDescription: Player de IPTV pra Windows com catálogo, EPG, DVR, cast e controle pelo celular.
PackageUrl: https://github.com/Rakjsu/NeoStream
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${id}.yaml`), versionManifest);
fs.writeFileSync(path.join(outDir, `${id}.installer.yaml`), installerManifest);
fs.writeFileSync(path.join(outDir, `${id}.locale.pt-BR.yaml`), localeManifest);
console.log(`winget: 3 manifests de ${id} ${version} em ${outDir}`);
