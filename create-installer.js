const installer = require('electron-winstaller');

async function createInstaller() {
    try {
        console.log('Creating Windows installer...');

        await installer.createWindowsInstaller({
            appDirectory: './release/NeoStream IPTV-win32-x64',
            outputDirectory: './release/installers',
            authors: 'Rakjsu',
            exe: 'NeoStream IPTV.exe',
            setupExe: 'NeoStream-IPTV-Setup.exe',
            setupIcon: './public/icon.png',
            noMsi: true,
            name: 'NeoStreamIPTV',
            description: 'Advanced IPTV Player with Auto-Update',
            title: 'NeoStream IPTV',
            version: '1.0.0'
        });

        console.log('✅ Installer created successfully!');
        console.log('📦 Location: ./release/installers/NeoStream-IPTV-Setup.exe');
    } catch (e) {
        console.error(`❌ Error creating installer: ${e.message}`);
        process.exit(1);
    }
}

createInstaller();
