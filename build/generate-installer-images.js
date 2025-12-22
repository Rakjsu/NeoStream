/**
 * Script para gerar imagens BMP para o instalador NSIS
 * Cores baseadas exatamente no design do NeoStream IPTV
 * Execute: node build/generate-installer-images.js
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

// Color interpolation
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

// ========================
// SIDEBAR IMAGE (164x314)
// Reproduz o estilo do Sidebar.tsx com gradiente e glows
// ========================
function generateSidebar() {
    const width = 164;
    const height = 314;
    const pixels = Buffer.alloc(width * height * 3);

    // Orb positions (similar ao .welcome-orb do Welcome.tsx)
    const orbs = [
        { x: 30, y: 60, radius: 100, color: COLORS.purple, opacity: 0.25 },
        { x: 130, y: 250, radius: 90, color: COLORS.pink, opacity: 0.20 },
        { x: 82, y: 157, radius: 70, color: COLORS.cyan, opacity: 0.15 },
    ];

    for (let y = 0; y < height; y++) {
        // Gradiente vertical como o .bg-gradient do Sidebar
        const gradientT = y / height;

        for (let x = 0; x < width; x++) {
            // Base: gradiente de bgDark para bgMid e volta para bgDark
            let bgColor;
            if (gradientT < 0.5) {
                bgColor = lerpColor(COLORS.bgDark, COLORS.bgMid, gradientT * 2);
            } else {
                bgColor = lerpColor(COLORS.bgMid, COLORS.bgDark, (gradientT - 0.5) * 2);
            }

            // Adiciona glow no topo (como .bg-glow)
            if (y < 100) {
                const glowIntensity = 1 - (y / 100);
                bgColor = lerpColor(bgColor, COLORS.purple, glowIntensity * 0.12);
            }

            // Adiciona os orbs com blur (simulado)
            for (const orb of orbs) {
                const dx = x - orb.x;
                const dy = y - orb.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < orb.radius) {
                    const t = 1 - (dist / orb.radius);
                    const intensity = Math.pow(t, 2.5) * orb.opacity;
                    bgColor = lerpColor(bgColor, orb.color, intensity);
                }
            }

            // Sutil grid pattern (como .welcome-grid)
            const gridX = x % 30 === 0;
            const gridY = y % 30 === 0;
            if ((gridX || gridY) && Math.random() > 0.5) {
                bgColor = lerpColor(bgColor, COLORS.white, 0.015);
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
// Gradiente diagonal como os botões do app
// ========================
function generateHeader() {
    const width = 150;
    const height = 57;
    const pixels = Buffer.alloc(width * height * 3);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Gradiente diagonal (como linear-gradient(135deg))
            const diagonalT = (x + y) / (width + height);

            // Base: gradiente de purple para pink (como logo, buttons)
            let color = lerpColor(COLORS.purple, COLORS.pink, diagonalT);

            // Escurecer levemente para melhor contraste
            color = lerpColor(COLORS.bgDark, color, 0.7);

            // Adiciona subtle wave highlights
            const wave = Math.sin(x * 0.12 + y * 0.15) * 0.5 + 0.5;
            if (wave > 0.7) {
                const intensity = (wave - 0.7) * 0.25;
                color = lerpColor(color, COLORS.white, intensity);
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
// Tons mais escuros com subtle red
// ========================
function generateUninstallSidebar() {
    const width = 164;
    const height = 314;
    const pixels = Buffer.alloc(width * height * 3);

    const dangerColor = { r: 239, g: 68, b: 68 };

    for (let y = 0; y < height; y++) {
        const gradientT = y / height;

        for (let x = 0; x < width; x++) {
            // Background mais escuro
            let bgColor;
            if (gradientT < 0.5) {
                bgColor = lerpColor(COLORS.bgDark, { r: 20, g: 15, b: 25 }, gradientT * 2);
            } else {
                bgColor = lerpColor({ r: 20, g: 15, b: 25 }, COLORS.bgDark, (gradientT - 0.5) * 2);
            }

            // Glow vermelho sutil no centro-baixo
            const centerX = width / 2;
            const centerY = height * 0.65;
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = 120;

            if (dist < maxDist) {
                const t = 1 - (dist / maxDist);
                const intensity = Math.pow(t, 3) * 0.15;
                bgColor = lerpColor(bgColor, dangerColor, intensity);
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
    { name: 'installer-sidebar.bmp', fn: generateSidebar, desc: '  ✅ Sidebar', size: '164×314' },
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
