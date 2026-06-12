/**
 * Script para gerar imagens BMP para o instalador NSIS
 * Cores baseadas exatamente no design do NeoStream IPTV
 * Execute: node build/generate-installer-images.js
 *
 * Zero dependências — BMP 24-bit escrito à mão com Buffer.
 * Saída determinística (sem Math.random) para builds reproduzíveis.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// PALETA EXATA DO NEOSTREAM
// ========================
const COLORS = {
    // Backgrounds (do Sidebar e Welcome)
    bgDark: { r: 15, g: 15, b: 26 },       // #0f0f1a
    bgMid: { r: 26, g: 26, b: 46 },        // #1a1a2e
    bgBody: { r: 15, g: 15, b: 35 },       // #0f0f23

    // Gradient principal (Logo, buttons)
    purple: { r: 168, g: 85, b: 247 },     // #a855f7
    pink: { r: 236, g: 72, b: 153 },       // #ec4899

    // Accent Colors
    indigo: { r: 99, g: 102, b: 241 },     // #6366f1
    violet: { r: 139, g: 92, b: 246 },     // #8b5cf6
    blue: { r: 59, g: 130, b: 246 },       // #3b82f6
    cyan: { r: 6, g: 182, b: 212 },        // #06b6d4
    green: { r: 16, g: 185, b: 129 },      // #10b981

    // Text
    white: { r: 255, g: 255, b: 255 },
    lightPurple: { r: 196, g: 181, b: 253 }, // #c4b5fd
};

// BMP File Header structure
function createBMPBuffer(width, height, pixels) {
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const pixelDataSize = rowSize * height;
    const fileSize = 54 + pixelDataSize;

    const buffer = Buffer.alloc(fileSize);
    let offset = 0;

    // BMP File Header (14 bytes)
    buffer.write('BM', offset); offset += 2;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.writeUInt16LE(0, offset); offset += 2;
    buffer.writeUInt16LE(0, offset); offset += 2;
    buffer.writeUInt32LE(54, offset); offset += 4;

    // DIB Header (40 bytes)
    buffer.writeUInt32LE(40, offset); offset += 4;
    buffer.writeInt32LE(width, offset); offset += 4;
    buffer.writeInt32LE(height, offset); offset += 4;
    buffer.writeUInt16LE(1, offset); offset += 2;
    buffer.writeUInt16LE(24, offset); offset += 2;
    buffer.writeUInt32LE(0, offset); offset += 4;
    buffer.writeUInt32LE(pixelDataSize, offset); offset += 4;
    buffer.writeInt32LE(2835, offset); offset += 4;
    buffer.writeInt32LE(2835, offset); offset += 4;
    buffer.writeUInt32LE(0, offset); offset += 4;
    buffer.writeUInt32LE(0, offset); offset += 4;

    // Pixel data (bottom-up, BGR format)
    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            const pixelIndex = (y * width + x) * 3;
            const dataOffset = 54 + ((height - 1 - y) * rowSize) + (x * 3);
            buffer[dataOffset] = pixels[pixelIndex + 2];     // Blue
            buffer[dataOffset + 1] = pixels[pixelIndex + 1]; // Green
            buffer[dataOffset + 2] = pixels[pixelIndex];     // Red
        }
        const padding = rowSize - (width * 3);
        for (let p = 0; p < padding; p++) {
            buffer[54 + ((height - 1 - y) * rowSize) + (width * 3) + p] = 0;
        }
    }

    return buffer;
}

// ========================
// HELPERS
// ========================
function lerp(a, b, t) {
    return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
}

function lerpColor(c1, c2, t) {
    return {
        r: lerp(c1.r, c2.r, t),
        g: lerp(c1.g, c2.g, t),
        b: lerp(c1.b, c2.b, t)
    };
}

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

// Pseudo-random determinístico (mesma saída em todo build)
function hash2(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
}

// SDF de retângulo arredondado (distância < 0 = dentro)
function roundedRectSDF(px, py, cx, cy, halfW, halfH, radius) {
    const dx = Math.abs(px - cx) - (halfW - radius);
    const dy = Math.abs(py - cy) - (halfH - radius);
    const ax = Math.max(dx, 0);
    const ay = Math.max(dy, 0);
    return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

// SDF de triângulo "play" (aponta para a direita), relativo ao centro (cx, cy)
function playTriangleSDF(px, py, cx, cy, scale) {
    // Vértices do triângulo (proporção do logo)
    const verts = [
        { x: cx - 0.42 * scale, y: cy - 0.55 * scale },
        { x: cx - 0.42 * scale, y: cy + 0.55 * scale },
        { x: cx + 0.62 * scale, y: cy },
    ];
    // Distância máxima das semi-planos das arestas (polígono convexo, CCW)
    let d = -Infinity;
    for (let i = 0; i < 3; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % 3];
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len = Math.sqrt(ex * ex + ey * ey);
        // Normal apontando para fora (vértices A→B→C em sentido anti-horário
        // em coordenadas de tela, onde y cresce para baixo)
        const nx = -ey / len;
        const ny = ex / len;
        const dist = (px - a.x) * nx + (py - a.y) * ny;
        d = Math.max(d, dist);
    }
    return d;
}

// Cobertura suavizada a partir de um SDF (antialiasing de 1px)
function coverage(sdf) {
    return clamp01(0.5 - sdf);
}

/**
 * Desenha o logo do app: tile arredondado com gradiente purple→pink,
 * glow externo e triângulo play branco. Pinta por cima de bgColor.
 */
function applyLogo(bgColor, x, y, cx, cy, tileHalf, opts = {}) {
    const glowRadius = opts.glowRadius || tileHalf * 2.6;
    const glowStrength = opts.glowStrength !== undefined ? opts.glowStrength : 0.35;
    const tileOpacity = opts.tileOpacity !== undefined ? opts.tileOpacity : 1.0;
    const triOpacity = opts.triOpacity !== undefined ? opts.triOpacity : 1.0;
    const desaturate = opts.desaturate || 0;

    let color = bgColor;

    // Glow radial atrás do tile (purple→pink na diagonal)
    const gdx = x - cx;
    const gdy = y - cy;
    const gdist = Math.sqrt(gdx * gdx + gdy * gdy);
    if (gdist < glowRadius) {
        const t = 1 - gdist / glowRadius;
        const glowT = clamp01((gdx + gdy) / (glowRadius * 2) + 0.5);
        let glowColor = lerpColor(COLORS.purple, COLORS.pink, glowT);
        if (desaturate > 0) {
            const gray = Math.round((glowColor.r + glowColor.g + glowColor.b) / 3);
            glowColor = lerpColor(glowColor, { r: gray, g: gray, b: gray }, desaturate);
        }
        color = lerpColor(color, glowColor, Math.pow(t, 2.2) * glowStrength);
    }

    // Tile arredondado com gradiente diagonal
    const tileSDF = roundedRectSDF(x, y, cx, cy, tileHalf, tileHalf, tileHalf * 0.36);
    const tileCov = coverage(tileSDF) * tileOpacity;
    if (tileCov > 0) {
        const diagT = clamp01(((x - (cx - tileHalf)) + (y - (cy - tileHalf))) / (tileHalf * 4));
        let tileColor = lerpColor(COLORS.purple, COLORS.pink, diagT);
        // Brilho sutil no canto superior esquerdo do tile
        const hlT = clamp01(1 - (((x - (cx - tileHalf)) + (y - (cy - tileHalf))) / (tileHalf * 1.6)));
        tileColor = lerpColor(tileColor, COLORS.white, hlT * 0.18);
        if (desaturate > 0) {
            const gray = Math.round((tileColor.r + tileColor.g + tileColor.b) / 3);
            tileColor = lerpColor(tileColor, { r: gray, g: gray, b: gray }, desaturate);
        }
        color = lerpColor(color, tileColor, tileCov);
    }

    // Triângulo play branco
    const triSDF = playTriangleSDF(x, y, cx + tileHalf * 0.06, cy, tileHalf * 0.78);
    const triCov = coverage(triSDF) * triOpacity;
    if (triCov > 0) {
        color = lerpColor(color, COLORS.white, triCov);
    }

    return color;
}

// ========================
// SIDEBAR IMAGE (164x314)
// Usada no welcome custom (nsDialogs), finish page (MUI) e como painel lateral.
// Conteúdo importante concentrado no topo (~220px) pois a página custom
// recorta a parte de baixo.
// ========================
function generateSidebar() {
    const width = 164;
    const height = 314;
    const pixels = Buffer.alloc(width * height * 3);

    // Orbs (como .welcome-orb do Welcome.tsx)
    const orbs = [
        { x: 20, y: 30, radius: 110, color: COLORS.purple, opacity: 0.30 },
        { x: 150, y: 120, radius: 95, color: COLORS.pink, opacity: 0.22 },
        { x: 40, y: 230, radius: 100, color: COLORS.indigo, opacity: 0.20 },
        { x: 140, y: 290, radius: 80, color: COLORS.cyan, opacity: 0.14 },
    ];

    // Sparkles determinísticos (pontos de luz)
    const sparkles = [];
    for (let i = 0; i < 26; i++) {
        sparkles.push({
            x: Math.floor(hash2(i, 1) * width),
            y: Math.floor(hash2(i, 7) * height),
            intensity: 0.25 + hash2(i, 13) * 0.5,
            radius: 0.8 + hash2(i, 23) * 1.4,
        });
    }

    const logoCx = width / 2;
    const logoCy = 78;
    const tileHalf = 30;

    for (let y = 0; y < height; y++) {
        const gradientT = y / height;

        for (let x = 0; x < width; x++) {
            // Base: gradiente vertical bgDark → bgMid → bgDark
            let bgColor;
            if (gradientT < 0.5) {
                bgColor = lerpColor(COLORS.bgDark, COLORS.bgMid, gradientT * 2);
            } else {
                bgColor = lerpColor(COLORS.bgMid, COLORS.bgDark, (gradientT - 0.5) * 2);
            }

            // Glow roxo no topo (como .bg-glow)
            if (y < 130) {
                const glowIntensity = 1 - (y / 130);
                bgColor = lerpColor(bgColor, COLORS.purple, Math.pow(glowIntensity, 1.6) * 0.14);
            }

            // Orbs com falloff suave
            for (const orb of orbs) {
                const dx = x - orb.x;
                const dy = y - orb.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < orb.radius) {
                    const t = 1 - dist / orb.radius;
                    bgColor = lerpColor(bgColor, orb.color, Math.pow(t, 2.4) * orb.opacity);
                }
            }

            // Grid sutil determinístico (como .welcome-grid)
            const onGrid = (x % 28 === 0) || (y % 28 === 0);
            if (onGrid && hash2(x, y) > 0.45) {
                bgColor = lerpColor(bgColor, COLORS.white, 0.018);
            }

            // Sparkles
            for (const s of sparkles) {
                const dx = x - s.x;
                const dy = y - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < s.radius * 3) {
                    const t = clamp01(1 - dist / (s.radius * 3));
                    bgColor = lerpColor(bgColor, COLORS.white, Math.pow(t, 3) * s.intensity * 0.5);
                }
            }

            // Logo (tile + glow + triângulo play)
            bgColor = applyLogo(bgColor, x, y, logoCx, logoCy, tileHalf, {
                glowStrength: 0.4,
            });

            // Linha divisória com gradiente purple→pink abaixo do logo
            const lineY = 152;
            if (y >= lineY && y < lineY + 2 && x >= 24 && x < width - 24) {
                const lineT = (x - 24) / (width - 48);
                const lineColor = lerpColor(COLORS.purple, COLORS.pink, lineT);
                // Esmaece nas pontas
                const edgeFade = clamp01(Math.min(x - 24, width - 24 - x) / 18);
                bgColor = lerpColor(bgColor, lineColor, 0.85 * edgeFade);
            }

            // Vinheta nas bordas
            const edgeDist = Math.min(x, width - 1 - x);
            if (edgeDist < 14) {
                bgColor = lerpColor(bgColor, COLORS.bgDark, (1 - edgeDist / 14) * 0.35);
            }

            const i = (y * width + x) * 3;
            pixels[i] = bgColor.r;
            pixels[i + 1] = bgColor.g;
            pixels[i + 2] = bgColor.b;
        }
    }

    return createBMPBuffer(width, height, pixels);
}

// ========================
// HEADER IMAGE (150x57)
// Fica no canto direito do header (MUI_HEADERIMAGE_RIGHT).
// Fundo escuro que se funde com MUI_BGCOLOR + logo com glow +
// faixa de gradiente purple→pink na base.
// ========================
function generateHeader() {
    const width = 150;
    const height = 57;
    const pixels = Buffer.alloc(width * height * 3);

    const logoCx = width - 34;
    const logoCy = 26;
    const tileHalf = 16;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Base escura — esquerda funde com o MUI_BGCOLOR (#0f0f1a)
            const horizT = x / width;
            let color = lerpColor(COLORS.bgDark, COLORS.bgMid, Math.pow(horizT, 1.5) * 0.8);

            // Glow roxo difuso atrás da área do logo
            const gdx = x - logoCx;
            const gdy = y - logoCy;
            const gdist = Math.sqrt(gdx * gdx + gdy * gdy);
            if (gdist < 60) {
                const t = 1 - gdist / 60;
                color = lerpColor(color, COLORS.violet, Math.pow(t, 2.2) * 0.18);
            }

            // Logo compacto
            color = applyLogo(color, x, y, logoCx, logoCy, tileHalf, {
                glowRadius: 38,
                glowStrength: 0.30,
            });

            // Faixa gradiente purple→pink na base (2px), esmaecendo à esquerda
            if (y >= height - 3 && y < height - 1) {
                const stripeColor = lerpColor(COLORS.purple, COLORS.pink, horizT);
                const fadeIn = clamp01((x - 10) / 60);
                color = lerpColor(color, stripeColor, 0.9 * fadeIn);
            }

            const i = (y * width + x) * 3;
            pixels[i] = color.r;
            pixels[i + 1] = color.g;
            pixels[i + 2] = color.b;
        }
    }

    return createBMPBuffer(width, height, pixels);
}

// ========================
// UNINSTALL SIDEBAR (164x314)
// Tons mais escuros, glow vermelho sutil e logo dessaturado
// ========================
function generateUninstallSidebar() {
    const width = 164;
    const height = 314;
    const pixels = Buffer.alloc(width * height * 3);

    const dangerColor = { r: 239, g: 68, b: 68 };
    const darkPlum = { r: 22, g: 16, b: 28 };

    const logoCx = width / 2;
    const logoCy = 78;
    const tileHalf = 30;

    for (let y = 0; y < height; y++) {
        const gradientT = y / height;

        for (let x = 0; x < width; x++) {
            // Background mais escuro
            let bgColor;
            if (gradientT < 0.5) {
                bgColor = lerpColor(COLORS.bgDark, darkPlum, gradientT * 2);
            } else {
                bgColor = lerpColor(darkPlum, COLORS.bgDark, (gradientT - 0.5) * 2);
            }

            // Glow vermelho sutil no centro-baixo
            const centerX = width / 2;
            const centerY = height * 0.68;
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = 130;
            if (dist < maxDist) {
                const t = 1 - dist / maxDist;
                bgColor = lerpColor(bgColor, dangerColor, Math.pow(t, 3) * 0.16);
            }

            // Logo dessaturado/apagado (o app "indo embora")
            bgColor = applyLogo(bgColor, x, y, logoCx, logoCy, tileHalf, {
                glowStrength: 0.18,
                tileOpacity: 0.55,
                triOpacity: 0.7,
                desaturate: 0.55,
            });

            // Vinheta nas bordas
            const edgeDist = Math.min(x, width - 1 - x);
            if (edgeDist < 14) {
                bgColor = lerpColor(bgColor, COLORS.bgDark, (1 - edgeDist / 14) * 0.35);
            }

            const i = (y * width + x) * 3;
            pixels[i] = bgColor.r;
            pixels[i + 1] = bgColor.g;
            pixels[i + 2] = bgColor.b;
        }
    }

    return createBMPBuffer(width, height, pixels);
}

// ========================
// MAIN EXECUTION
// ========================
console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║     🎨 NeoStream IPTV - Installer Image Generator     ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');
console.log('📋 Design System:');
console.log('   Background: #0f0f1a → #1a1a2e');
console.log('   Gradient:   #a855f7 (purple) → #ec4899 (pink)');
console.log('   Accents:    #6366f1 #8b5cf6 #3b82f6 #06b6d4');
console.log('');

const outputDir = __dirname;

// Generate all images
const images = [
    { name: 'installer-sidebar.bmp', fn: generateSidebar, desc: '  ✅ Sidebar (welcome/finish)', size: '164×314' },
    { name: 'installer-header.bmp', fn: generateHeader, desc: '  ✅ Header', size: '150×57' },
    { name: 'uninstaller-sidebar.bmp', fn: generateUninstallSidebar, desc: '  ✅ Uninstaller Sidebar', size: '164×314' },
];

console.log('📁 Generating images:');
for (const img of images) {
    const buffer = img.fn();
    const filepath = path.join(outputDir, img.name);
    fs.writeFileSync(filepath, buffer);
    console.log(`${img.desc} (${img.size}): ${img.name}`);
}

console.log('');
console.log('🎉 All images generated successfully!');
console.log(`📍 Location: ${outputDir}`);
console.log('');
