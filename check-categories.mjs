// Script para verificar categorias (ES Module)
import fs from 'fs';
import path from 'path';

async function checkCategories() {
    try {
        const configPath = path.join(process.env.APPDATA || process.env.HOME, 'neostream-iptv', 'credentials.json');
        const credentials = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        const { url, username, password } = credentials;

        const response = await fetch(
            `${url}/player_api.php?username=${username}&password=${password}&action=get_series_categories`
        );

        const categories = await response.json();

        console.log('\n=== CATEGORIAS DO SERVIDOR ===\n');
        console.log(`Total: ${categories.length} categorias\n`);

        categories.sort((a, b) => a.category_name.localeCompare(b.category_name));

        categories.forEach((cat, index) => {
            console.log(`${(index + 1).toString().padStart(3, ' ')}. ${cat.category_name}`);
        });

    } catch (error) {
        console.error('Erro:', error.message);
    }
}

checkCategories();
