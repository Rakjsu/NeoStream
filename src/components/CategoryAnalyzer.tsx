import { useState } from 'react';

interface CategoryAnalysis {
    categoryName: string;
    categoryId: string;
    seriesCount: number;
    hasIcon: boolean;
    matchedKeywords: string[];
}

interface CategorySummary {
    total: number;
    withIcons: number;
    withoutIcons: number;
    empty: number;
}

interface ProviderCategory {
    category_id: string;
    category_name: string;
}

export function CategoryAnalyzer() {
    const [analyzing, setAnalyzing] = useState(false);
    const [report, setReport] = useState<CategoryAnalysis[]>([]);
    const [summary, setSummary] = useState<CategorySummary | null>(null);

    // Lista de todas as keywords implementadas no código
    const implementedKeywords = [
        'ação', 'action', 'aventura', 'adventure', 'drama', 'romance', 'romantic',
        'comédia', 'comedy', 'humor', 'terror', 'horror', 'suspense', 'thriller',
        'mistério', 'mystery', 'ficção', 'sci-fi', 'science', 'fantasia', 'fantasy',
        'animação', 'animation', 'desenho', 'infantil', 'kids', 'criança', 'anime',
        'documentário', 'documentary', 'natureza', 'nature', 'crime', 'policial',
        'detective', 'gangster', 'máfia', 'guerra', 'war', 'militar', 'esporte',
        'sport', 'música', 'music', 'musical', 'família', 'family', 'western',
        'faroeste', 'épico', 'epic', 'história', 'historical', 'period', 'reality',
        'talk', 'show', 'teen', 'adolescent', 'novela', 'soap', 'biografia',
        'biography', 'marca', 'brand', 'notícia', 'news', 'jornal', 'culinária',
        'cooking', 'chef', 'receita', 'viagem', 'travel', 'turismo', 'religião',
        'religion', 'gospel', 'política', 'politics', 'político', 'saúde', 'health',
        'medicina', 'medical', 'tecnologia', 'technology', 'tech', 'auto', 'carro',
        'car', 'legendado', 'subtitle', 'caption', 'lançamento', 'lancamento',
        'novo', 'new', 'estreia', 'release', 'netflix', 'brasil paralelo', 'bp',
        'disney', 'amazon', 'prime', 'globoplay', 'globo play', 'looke', 'paramount',
        'discovery', 'marvel', 'apple tv', 'appletv', 'max', 'hbo max', 'crunchyroll',
        'adulto', 'adult', 'diverso', 'various', 'dorama', 'k-drama', 'kdrama', 'korean'
    ];

    const checkIfHasIcon = (categoryName: string): { hasIcon: boolean; matched: string[] } => {
        const name = categoryName.toLowerCase();
        const matched: string[] = [];

        for (const keyword of implementedKeywords) {
            if (name.includes(keyword)) {
                matched.push(keyword);
            }
        }

        return { hasIcon: matched.length > 0, matched };
    };

    const analyzeCategories = async () => {
        setAnalyzing(true);
        setReport([]);
        setSummary(null);

        try {
            // Buscar credenciais
            const result = await window.ipcRenderer.invoke('auth:get-credentials');
            if (!result.success) {
                alert('Erro ao buscar credenciais');
                return;
            }

            const { url, username, password } = result.credentials;

            // Buscar categorias
            const categoriesResponse = await fetch(
                `${url}/player_api.php?username=${username}&password=${password}&action=get_series_categories`
            );
            const categories = await categoriesResponse.json() as ProviderCategory[];

            
            const analysis: CategoryAnalysis[] = [];
            let withIcons = 0;
            let withoutIcons = 0;
            let empty = 0;

            // Analisar cada categoria
            for (const category of categories) {
                // Buscar séries da categoria
                const seriesResponse = await fetch(
                    `${url}/player_api.php?username=${username}&password=${password}&action=get_series&category_id=${category.category_id}`
                );
                const series = await seriesResponse.json();
                const seriesCount = Array.isArray(series) ? series.length : 0;

                const { hasIcon, matched } = checkIfHasIcon(category.category_name);

                analysis.push({
                    categoryName: category.category_name,
                    categoryId: category.category_id,
                    seriesCount,
                    hasIcon,
                    matchedKeywords: matched
                });

                if (hasIcon) withIcons++;
                else withoutIcons++;
                if (seriesCount === 0) empty++;
            }

            // Ordenar por categorias sem ícone primeiro, depois por nome
            analysis.sort((a, b) => {
                if (a.hasIcon !== b.hasIcon) return a.hasIcon ? 1 : -1;
                return a.categoryName.localeCompare(b.categoryName);
            });

            setReport(analysis);
            setSummary({
                total: categories.length,
                withIcons,
                withoutIcons,
                empty
            });
        } catch (error) {
            console.error('Erro na análise:', error);
            alert('Erro ao analisar categorias: ' + (error as Error).message);
        } finally {
            setAnalyzing(false);
        }
    };

    const generateReportText = (analysis: CategoryAnalysis[], stats: CategorySummary): string => {
        let text = '═══════════════════════════════════════════════════════\n';
        text += '       RELATÓRIO DE ANÁLISE DE CATEGORIAS IPTV        \n';
        text += '═══════════════════════════════════════════════════════\n\n';

        text += `📊 RESUMO:\n`;
        text += `   Total de categorias: ${stats.total}\n`;
        text += `   ✅ Com ícones customizados: ${stats.withIcons}\n`;
        text += `   ❌ Sem ícones (usando padrão): ${stats.withoutIcons}\n`;
        text += `   📁 Categorias vazias: ${stats.empty}\n\n`;

        // Categorias SEM ícone
        const withoutIcon = analysis.filter(a => !a.hasIcon && a.seriesCount > 0);
        if (withoutIcon.length > 0) {
            text += `\n❌ CATEGORIAS SEM ÍCONE CUSTOMIZADO (${withoutIcon.length}):\n`;
            text += '─────────────────────────────────────────────────────\n';
            withoutIcon.forEach(cat => {
                text += `   • ${cat.categoryName} (${cat.seriesCount} séries)\n`;
            });
        }

        // Categorias COM ícone
        const withIcon = analysis.filter(a => a.hasIcon && a.seriesCount > 0);
        if (withIcon.length > 0) {
            text += `\n✅ CATEGORIAS COM ÍCONE (${withIcon.length}):\n`;
            text += '─────────────────────────────────────────────────────\n';
            withIcon.forEach(cat => {
                text += `   • ${cat.categoryName} (${cat.seriesCount} séries) - Keywords: ${cat.matchedKeywords.join(', ')}\n`;
            });
        }

        // Categorias vazias
        const emptyCats = analysis.filter(a => a.seriesCount === 0);
        if (emptyCats.length > 0) {
            text += `\n📁 CATEGORIAS VAZIAS (${emptyCats.length}):\n`;
            text += '─────────────────────────────────────────────────────\n';
            emptyCats.forEach(cat => {
                text += `   • ${cat.categoryName} ${cat.hasIcon ? '✅' : '❌'}\n`;
            });
        }

        text += '\n═══════════════════════════════════════════════════════\n';
        return text;
    };

    const copyReportToClipboard = () => {
        if (!summary) return;
        const reportText = generateReportText(report, summary);
        navigator.clipboard.writeText(reportText);
        alert('Relatório copiado para a área de transferência!');
    };

    return (
        <div style={{
            padding: '40px',
            maxWidth: '1200px',
            margin: '0 auto',
            fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
            <h1 style={{
                fontSize: '32px',
                fontWeight: '700',
                marginBottom: '16px',
                background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
            }}>
                🔍 Analisador de Categorias IPTV
            </h1>

            <p style={{ fontSize: '16px', color: '#94a3b8', marginBottom: '32px' }}>
                Analisa todas as categorias do servidor e verifica quais têm ícones customizados
            </p>

            <button
                onClick={analyzeCategories}
                disabled={analyzing}
                style={{
                    padding: '12px 24px',
                    background: analyzing ? '#64748b' : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: analyzing ? 'not-allowed' : 'pointer',
                    marginRight: '12px'
                }}
            >
                {analyzing ? '⏳ Analisando...' : '🚀 Iniciar Análise'}
            </button>

            {summary && (
                <button
                    onClick={copyReportToClipboard}
                    style={{
                        padding: '12px 24px',
                        background: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: 'pointer'
                    }}
                >
                    📋 Copiar Relatório
                </button>
            )}

            {summary && (
                <div style={{
                    marginTop: '32px',
                    padding: '24px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '16px', color: 'white' }}>
                        📊 Resumo
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                        <div style={{ padding: '16px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px' }}>
                            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Total</div>
                            <div style={{ fontSize: '32px', fontWeight: '700', color: '#60a5fa' }}>{summary.total}</div>
                        </div>
                        <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
                            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Com Ícones</div>
                            <div style={{ fontSize: '32px', fontWeight: '700', color: '#10b981' }}>{summary.withIcons}</div>
                        </div>
                        <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
                            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Sem Ícones</div>
                            <div style={{ fontSize: '32px', fontWeight: '700', color: '#ef4444' }}>{summary.withoutIcons}</div>
                        </div>
                        <div style={{ padding: '16px', background: 'rgba(251, 191, 36, 0.1)', borderRadius: '8px' }}>
                            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Vazias</div>
                            <div style={{ fontSize: '32px', fontWeight: '700', color: '#fbbf24' }}>{summary.empty}</div>
                        </div>
                    </div>
                </div>
            )}

            {report.length > 0 && (
                <div style={{ marginTop: '32px' }}>
                    <div style={{
                        maxHeight: '600px',
                        overflowY: 'auto',
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, background: 'rgba(15, 23, 42, 0.95)', zIndex: 1 }}>
                                <tr>
                                    <th style={{ padding: '16px', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Status</th>
                                    <th style={{ padding: '16px', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Categoria</th>
                                    <th style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontWeight: '600' }}>Séries</th>
                                    <th style={{ padding: '16px', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Keywords</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.map((cat, index) => (
                                    <tr key={cat.categoryId} style={{
                                        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                                        background: index % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)'
                                    }}>
                                        <td style={{ padding: '12px', fontSize: '20px' }}>
                                            {cat.hasIcon ? '✅' : '❌'}
                                        </td>
                                        <td style={{ padding: '12px', color: 'white', fontWeight: '500' }}>
                                            {cat.categoryName}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'center', color: cat.seriesCount > 0 ? '#10b981' : '#ef4444' }}>
                                            {cat.seriesCount}
                                        </td>
                                        <td style={{ padding: '12px', color: '#94a3b8', fontSize: '14px' }}>
                                            {cat.matchedKeywords.length > 0 ? cat.matchedKeywords.join(', ') : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
