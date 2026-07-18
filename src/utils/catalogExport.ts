/**
 * 📤 Exportação da lista filtrada do catálogo como CSV (Excel-friendly:
 * BOM adicionado pelo chamador, aspas escapadas, uma linha por item).
 */
export interface ExportableItem {
    name: string;
    release_date?: string;
    genre?: string;
}

function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

export function buildCatalogCsv(items: ExportableItem[]): string {
    const lines = ['name,year,genre'];
    for (const item of items) {
        const year = item.release_date?.match(/(?:19|20)\d{2}/)?.[0] ?? '';
        lines.push([csvCell(item.name), csvCell(year), csvCell(item.genre ?? '')].join(','));
    }
    return lines.join('\r\n') + '\r\n';
}
