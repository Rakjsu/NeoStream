const { createWindowsInstaller } = require('electron-winstaller');
const path = require('path');

async function createInstaller() {
    try {
        console.log('Creating Windows installer...');

        const resultPromise = createWindowsInstaller({
            appDirectory: path.join(__dirname, 'release', 'NeoStream IPTV-win32-x64'),
            outputDirectory: path.join(__dirname, 'release', 'installers'),
            authors: 'Rakjsu',
            exe: 'NeoStream IPTV.exe',
            setupExe: 'NeoStream-IPTV-Setup.exe',
            noMsi: true,
            name: 'NeoStreamIPTV',
            description: 'Advanced IPTV Player with Auto-Update',
            title: 'NeoStream IPTV',
            version: '1.0.0',
            iconUrl: 'https://raw.githubusercontent.com/Rakjsu/NeoStream/main/public/icon.png',
            setupIcon: path.join(__dirname, 'public', 'icon.png')
        });

        await resultPromise;

        console.log('✅ Installer created successfully!');
        console.log('📦 Location: ./release/installers/NeoStream-IPTV-Setup.exe');
    } catch (e) {
        console.error(`❌ Error creating installer: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

createInstaller();
