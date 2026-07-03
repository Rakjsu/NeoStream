import { useLanguage } from '../services/languageService';
import type { CatalogSort } from '../utils/catalogSort';

interface SortSelectProps {
    value: CatalogSort;
    onChange: (value: CatalogSort) => void;
    /** Hide the rating option (live channels have no rating). */
    withRating?: boolean;
    /** Distance from the right edge (sits left of the search bar). */
    right?: number;
}

/**
 * Catalog "sort by" dropdown, floating next to the page search bar.
 * "recent" means provider order for live (channel numbers) and added-date
 * for VOD/series — each page maps it accordingly.
 */
export function SortSelect({ value, onChange, withRating = true, right = 90 }: SortSelectProps) {
    const { t } = useLanguage();
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as CatalogSort)}
            title={t('sort', 'title')}
            style={{
                position: 'absolute',
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
                outline: 'none',
                backdropFilter: 'blur(8px)'
            }}
        >
            <option value="recent">{t('sort', 'recent')}</option>
            <option value="name">{t('sort', 'name')}</option>
            {withRating && <option value="rating">{t('sort', 'rating')}</option>}
        </select>
    );
}

export type { CatalogSort };
