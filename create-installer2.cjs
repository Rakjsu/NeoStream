const installer = require('electron-installer-windows');

const options = {
    src: 'release/NeoStream IPTV-win32-x64/',
    dest: 'release/installers/',
    options: {
        name: 'NeoStreamIPTV',
        productName: 'NeoStream IPTV',
        version: '1.0.0',
        bin: 'NeoStream IPTV.exe',
        authors: 'Rakjsu',
        description: 'Advanced IPTV Player',
        setupExe: 'NeoStream-IPTV-Setup.exe',
        noMsi: true
    }
};

console.log('Creating installer...');

installer(options)
    .then(() => {
        console.log('✅ Success! Installer created at: release/installers/');
    })
    .catch(err => {
        console.error('❌ Error:', err);
        process.exit(1);
    });
