import { useLanguage } from '../services/languageService';
import type { CatalogSort } from '../utils/catalogSort';

interface SortSelectProps {
    value: CatalogSort;
    onChange: (value: CatalogSort) => void;
    /** Hide the rating option (live channels have no rating). */
    withRating?: boolean;
    /** Show "mais assistidos por mim" (pages that wire usage data). */
    withMyWatch?: boolean;
    /** Distance from the right edge (sits left of the search bar). */
    right?: number;
    /** Flow inline in a flex toolbar instead of floating absolutely. */
    inline?: boolean;
}

/**
 * Catalog "sort by" dropdown. By default it floats next to the page search bar;
 * with `inline` it flows in a flex toolbar (the native <select> popup still
 * opens relative to the control). "recent" means provider order for live
 * (channel numbers) and added-date for VOD/series — each page maps it accordingly.
 */
export function SortSelect({ value, onChange, withRating = true, withMyWatch = false, right = 90, inline = false }: SortSelectProps) {
    const { t } = useLanguage();
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as CatalogSort)}
            title={t('sort', 'title')}
            style={{
                position: inline ? 'relative' : 'absolute',
                ...(inline ? {} : { top: 30, right }),
                zIndex: 95,
                padding: '9px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.18)',
                background: 'rgba(15, 15, 35, 0.85)',
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                // No outline:none — the global :focus-visible ring must show
                // when tabbing to the control.
                backdropFilter: 'blur(8px)'
            }}
        >
            <option value="recent">{t('sort', 'recent')}</option>
            <option value="name">{t('sort', 'name')}</option>
            {withRating && <option value="rating">{t('sort', 'rating')}</option>}
            {withMyWatch && <option value="mywatch">{t('sort', 'myWatch')}</option>}
        </select>
    );
}

export type { CatalogSort };
