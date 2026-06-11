import { useState, useEffect } from 'react';
import { type TMDBSeriesDetails, fetchEpisodeDetails, searchSeriesByName } from '../services/tmdb';

interface SeriesMetadataSource {
    name: string;
    series_id: number;
    tmdb_id: string;
}

const extractYearFromName = (name: string): string => {
    const match = name.match(/\((\d{4})\)/);
    return match ? match[1] : '';
};

// Episode title handling
const isValidEpisodeTitle = (cleanTitle: string): boolean => {
    const genericPatterns = [
        /^s\d+\s*e\d+$/i,
        /^episode\s*\d+$/i,
        /^ep\s*\d+$/i,
        /^\d+$/,
        /^temporada\s*\d+\s*episodio\s*\d+$/i
    ];
    return !genericPatterns.some(pattern => pattern.test(cleanTitle));
};

/**
 * TMDB metadata for the currently selected series plus episode-title resolution
 * (with an in-memory cache of TMDB episode titles).
 */
export function useSeriesMetadata(selectedSeries: SeriesMetadataSource | null, selectedSeason: number) {
    const [tmdbData, setTmdbData] = useState<TMDBSeriesDetails | null>(null);
    const [loadingTmdb, setLoadingTmdb] = useState(false);
    const [tmdbEpisodeCache, setTmdbEpisodeCache] = useState<Map<string, string>>(new Map());

    // Fetch TMDB data
    useEffect(() => {
        if (!selectedSeries) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- preserves pre-extraction behavior (reset on deselect)
            setTmdbData(null);
            return;
        }

        const year = extractYearFromName(selectedSeries.name);
        setLoadingTmdb(true);
        setTmdbData(null);

        searchSeriesByName(selectedSeries.name, year)
            .then(data => { setTmdbData(data); setLoadingTmdb(false); })
            .catch(() => setLoadingTmdb(false));
    }, [selectedSeries]);

    const getEpisodeTitle = (fullTitle: string, episodeNum: number, season: number = selectedSeason): string => {
        const cleanTitle = fullTitle
            .replace(/^(.*?)[\s\-–—]*S\d+[\s\-:.]*E\d+[\s\-:.–—]*/i, '')
            .replace(/\s*(?:\[|\()?S\d+[\s.-]*E\d+(?:\]|\))?\s*/gi, '')
            .replace(/\s*-\s*Temporada\s*\d+\s*Epis[oó]dio\s*\d+\s*/gi, '')
            .replace(/\s*Temp\s*\d+\s*Ep\s*\d+\s*/gi, '')
            .trim();

        if (cleanTitle && isValidEpisodeTitle(cleanTitle)) {
            return `Episódio ${episodeNum} - ${cleanTitle}`;
        }

        // Check cache for TMDB title
        const cacheKey = `${selectedSeries?.tmdb_id || selectedSeries?.series_id}-${season}-${episodeNum}`;
        const cachedTitle = tmdbEpisodeCache.get(cacheKey);
        if (cachedTitle) {
            return `Episódio ${episodeNum} - ${cachedTitle}`;
        }

        // Fetch from TMDB if we have tmdb_id
        if (selectedSeries?.tmdb_id && tmdbData) {
            fetchEpisodeDetails(selectedSeries.tmdb_id, season, episodeNum)
                .then(epDetails => {
                    if (epDetails?.name) {
                        setTmdbEpisodeCache(prev => new Map(prev).set(cacheKey, epDetails.name));
                    }
                })
                .catch(() => { });
        }

        return `Episódio ${episodeNum}`;
    };

    return { tmdbData, loadingTmdb, getEpisodeTitle };
}
