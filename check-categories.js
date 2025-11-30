// Script temporário para verificar categorias do servidor IPTV
const fs = require('fs');
const path = require('path');

async function checkCategories() {
    try {
        // Ler credenciais
        const configPath = path.join(process.env.APPDATA || process.env.HOME, 'neostream-iptv', 'credentials.json');
        const credentials = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        const { url, username, password } = credentials;

        // Buscar categorias
        const response = await fetch(
            `${url}/player_api.php?username=${username}&password=${password}&action=get_series_categories`
        );

        const categories = await response.json();

        console.log('\n=== CATEGORIAS DO SERVIDOR ===\n');
        console.log(`Total de categorias: ${categories.length}\n`);

        // Ordenar alfabeticamente
        categories.sort((a, b) => a.category_name.localeCompare(b.category_name));

        categories.forEach((cat, index) => {
            console.log(`${index + 1}. ${cat.category_name} (ID: ${cat.category_id})`);
        });

        console.log('\n==============================\n');

    } catch (error) {
        console.error('Erro ao buscar categorias:', error.message);
    }
}

checkCategories();
