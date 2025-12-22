/**
 * After Pack Hook - Apply custom icon to Windows executable
 * This hook runs after electron-builder packages the app but before creating installers
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
    // Only run for Windows builds
    if (context.electronPlatformName !== 'win32') {
        return;
    }

    const appOutDir = context.appOutDir;
    const exePath = path.join(appOutDir, 'NeoStream IPTV.exe');
    const iconPath = path.join(__dirname, 'icons', 'icon.ico');
    const rceditPath = 'C:\\rcedit-2.0.0\\rcedit-x64.exe';

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║     🎨 Applying custom icon to NeoStream IPTV        ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    // Check if rcedit exists
    if (!fs.existsSync(rceditPath)) {
        console.log(`⚠️  rcedit not found at ${rceditPath}`);
        console.log('   Skipping custom icon application.');
        return;
    }

    // Check if exe exists
    if (!fs.existsSync(exePath)) {
        console.log(`⚠️  Executable not found: ${exePath}`);
        return;
    }

    // Check if icon exists
    if (!fs.existsSync(iconPath)) {
        console.log(`⚠️  Icon not found: ${iconPath}`);
        return;
    }

    try {
        console.log(`📁 Executable: ${exePath}`);
        console.log(`🎨 Icon: ${iconPath}`);

        const beforeSize = fs.statSync(exePath).size;

        // Apply icon using rcedit
        execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`, {
            stdio: 'inherit'
        });

        const afterSize = fs.statSync(exePath).size;

        console.log('');
        console.log(`✅ Icon applied successfully!`);
        console.log(`   Size before: ${(beforeSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Size after:  ${(afterSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Added: ${((afterSize - beforeSize) / 1024).toFixed(0)} KB`);
        console.log('');
    } catch (error) {
        console.error('❌ Error applying icon:', error.message);
    }
};
