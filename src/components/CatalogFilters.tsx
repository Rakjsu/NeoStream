import { useMemo } from 'react';
import { useLanguage } from '../services/languageService';
import { listDecades, listGenres, type FilterableItem } from '../utils/catalogFilter';

interface CatalogFiltersProps {
    items: FilterableItem[];
    decade: number | null;
    genre: string | null;
    onDecade: (decade: number | null) => void;
    onGenre: (genre: string | null) => void;
    /** Borda direita do select de década (o de gênero fica à esquerda dele). */
    right?: number;
}

function selectStyle(right: number) {
    return {
        position: 'absolute' as const,
        top: 30,
        right,
        zIndex: 95,
        padding: '9px 12px',
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.18)',
        background: 'rgba(15, 15, 35, 0.85)',
        color: 'rgba(255, 255, 255, 0.85)',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        backdropFilter: 'blur(8px)'
    };
}

/** Filtros de década e gênero das grades de catálogo — par visual do SortSelect. */
export function CatalogFilters({ items, decade, genre, onDecade, onGenre, right = 215 }: CatalogFiltersProps) {
    const { t } = useLanguage();
    const decades = useMemo(() => listDecades(items), [items]);
    const genres = useMemo(() => listGenres(items), [items]);
    return (
        <>
            {decades.length >= 2 && (
                <select
                    value={decade ?? ''}
                    onChange={(e) => onDecade(e.target.value ? Number(e.target.value) : null)}
                    title={t('sort', 'decade')}
                    style={selectStyle(right)}
                >
                    <option value="">{t('sort', 'allDecades')}</option>
                    {decades.map(item => <option key={item} value={item}>{item}s</option>)}
                </select>
            )}
            {genres.length >= 2 && (
                <select
                    value={genre ?? ''}
                    onChange={(e) => onGenre(e.target.value || null)}
                    title={t('sort', 'genre')}
                    style={selectStyle(right + 128)}
                >
                    <option value="">{t('sort', 'allGenres')}</option>
                    {genres.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
            )}
        </>
    );
}
