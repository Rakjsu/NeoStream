import { useState, useEffect } from 'react';
import { autoFetchSubtitle, autoFetchForcedSubtitle, cleanupSubtitleUrl, diskSubtitleToVtt, motivoDeNaoTerLegenda, openSubtitleFileFromDisk, type SubtitleWarning } from '../../services/subtitleService';
import { chaveDaMensagem } from '../../services/motivoDeLegenda';
import { useLanguage } from '../../services/languageService';

export interface UseSubtitleManagerParams {
    title?: string;
    tmdbId?: string | number;
    imdbId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

/**
 * A que conteúdo uma legenda carregada pertence. Trocar de episódio nem sempre
 * remonta o player: quando a URL do próximo sai na hora (arquivo offline), o
 * AsyncVideoPlayer liga e desliga o "carregando" no mesmo lote do React e o
 * VideoPlayer só recebe props novas. A legenda que ficou guardada (CC
 * desligado só esconde) precisa saber de quem é — senão religar o CC no
 * episódio 2 mostraria a do episódio 1.
 */
function chaveDoConteudo(c: { title?: string; tmdbId?: string | number; imdbId?: string; seasonNumber?: number; episodeNumber?: number }): string {
    return [c.title ?? '', c.tmdbId ?? '', c.imdbId ?? '', c.seasonNumber ?? '', c.episodeNumber ?? ''].join('|');
}

export function useSubtitleManager({
    title,
    tmdbId,
    imdbId,
    seasonNumber,
    episodeNumber,
    videoRef
}: UseSubtitleManagerParams) {
    const { t } = useLanguage();

    /** O serviço devolve o aviso como dado; a frase sai no idioma da interface (#D007). */
    const textoDoAviso = (aviso: SubtitleWarning): string =>
        aviso.kind === 'fallbackLanguage'
            ? t('player', 'subtitleFallbackLanguage')
                .replace('{wanted}', aviso.wanted.toUpperCase())
                .replace('{got}', aviso.got.toUpperCase())
            : t('player', 'subtitleSpecialEditionsOnly');

    const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
    const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
    const [subtitleLoading, setSubtitleLoading] = useState(false);
    const [subtitleLanguage, setSubtitleLanguage] = useState<string | null>(null);
    const [vttContent, setVttContent] = useState<string | null>(null);
    const [subtitleWarning, setSubtitleWarning] = useState<string | null>(null);
    const [isForcedSubtitle, setIsForcedSubtitle] = useState(false); // Track if current subtitle is Forced type
    // Nome do arquivo aberto do disco — separado do `subtitleLanguage`, que o
    // menu e o tooltip do CC leem como CÓDIGO de idioma ('pt-BR', 'en').
    const [diskSubtitleName, setDiskSubtitleName] = useState<string | null>(null);
    // De qual conteúdo é a legenda carregada (ver chaveDoConteudo).
    const [conteudoDaLegenda, setConteudoDaLegenda] = useState<string | null>(null);
    const conteudoAtual = chaveDoConteudo({ title, tmdbId, imdbId, seasonNumber, episodeNumber });
    // Initialize session toggle from global config (enabled = setting is ON)
    const [forcedEnabledForSession, setForcedEnabledForSession] = useState(() => {
        try {
            // Read active profile ID from neostream_profiles (correct key)
            const profilesData = localStorage.getItem('neostream_profiles');
            let profileId: string | null = null;
            if (profilesData) {
                const parsed = JSON.parse(profilesData);
                profileId = parsed.activeProfileId || null;
            }
            const configKey = profileId ? `playbackConfig_${profileId}` : 'playbackConfig';
            const saved = localStorage.getItem(configKey);
            if (saved) {
                const config = JSON.parse(saved);
                const result = config.forcedSubtitlesEnabled !== false;
                return result;
            }
        } catch (e) { console.error('Error reading forced config:', e); }
        return true; // default enabled
    });

    // Auto-load Forced subtitles when content starts (movies and series)
    useEffect(() => {
        // Skip if no title
        if (!title) return;

        // Check if title contains [L] - already subtitled, skip Forced
        if (title.includes('[L]')) {
            return;
        }

        const loadForcedSubtitles = async () => {
            try {
                // Check if Forced subtitles are disabled for this session
                if (!forcedEnabledForSession) {
                    return;
                }

                // Check if Forced subtitles are enabled in settings
                const { playbackService } = await import('../../services/playbackService');
                playbackService.reloadConfig();
                const config = playbackService.getConfig();

                if (!config.forcedSubtitlesEnabled) {
                    return;
                }

                const result = await autoFetchForcedSubtitle({
                    title,
                    tmdbId,
                    imdbId,
                    season: seasonNumber,
                    episode: episodeNumber
                });

                if (result) {
                    setSubtitleUrl(result.url);
                    setSubtitleLanguage(result.language);
                    setVttContent(result.vttContent);
                    setConteudoDaLegenda(chaveDoConteudo({ title, tmdbId, imdbId, seasonNumber, episodeNumber }));
                    setSubtitlesEnabled(true);
                    setIsForcedSubtitle(true);
                }
            } catch (error) {
                console.error('Error auto-loading forced subtitles:', error);
            }
        };

        // Small delay to let video player initialize
        const timer = setTimeout(loadForcedSubtitles, 1000);
        return () => clearTimeout(timer);
    }, [title, tmdbId, imdbId, seasonNumber, episodeNumber, forcedEnabledForSession]);

    // Cleanup subtitle blob URL on unmount
    useEffect(() => {
        return () => {
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
            }
        };
    }, [subtitleUrl]);

    // CC button: toggles subtitles, fetching full subtitles on demand
    const handleSubtitleToggle = async () => {
        // If currently showing Forced subtitles, switch to full subtitles
        if (subtitlesEnabled && isForcedSubtitle) {
            // Cleanup Forced subtitle
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
            }
            setSubtitleLoading(true);
            setIsForcedSubtitle(false);

            try {
                const result = await autoFetchSubtitle({
                    title: title || '',
                    tmdbId,
                    imdbId,
                    season: seasonNumber,
                    episode: episodeNumber
                });
                if (result) {
                    setSubtitleUrl(result.url);
                    setSubtitleLanguage(result.language);
                    setVttContent(result.vttContent);
                    setConteudoDaLegenda(conteudoAtual);
                    if (result.warning) {
                        setSubtitleWarning(textoDoAviso(result.warning));
                        setTimeout(() => setSubtitleWarning(null), 5000);
                    }
                } else {
                    setSubtitleWarning(t('player', 'noFullSubtitlesFound'));
                    setTimeout(() => setSubtitleWarning(null), 4000);
                }
            } catch (error) {
                console.error('Error fetching full subtitles:', error);
            } finally {
                setSubtitleLoading(false);
            }
            return;
        }

        if (subtitlesEnabled) {
            // Só ESCONDE, como o atalho "C" já fazia. A legenda fica carregada:
            // religar o CC não pode custar outro `/download` na cota diária do
            // OpenSubtitles do usuário (D008), nem trocar a legenda aberta do
            // disco por uma baixada. Esquecer de verdade é o "Desligada" do
            // menu (handleSubtitlesOff).
            setSubtitlesEnabled(false);
            setIsForcedSubtitle(false);

            const video = videoRef.current;
            if (video && video.textTracks.length > 0) {
                for (let i = 0; i < video.textTracks.length; i++) {
                    video.textTracks[i].mode = 'hidden';
                }
            }
        } else {
            // Enable subtitles - fetch if not already loaded (for THIS content)
            const legendaDesteConteudo = !!subtitleUrl && conteudoDaLegenda === conteudoAtual;
            if (!legendaDesteConteudo && title) {
                if (subtitleUrl) {
                    // Sobrou a de outro episódio/filme: não serve.
                    cleanupSubtitleUrl(subtitleUrl);
                    setSubtitleUrl(null);
                    setSubtitleLanguage(null);
                    setVttContent(null);
                    setDiskSubtitleName(null);
                }
                setSubtitleLoading(true);
                try {
                    const result = await autoFetchSubtitle({
                        title,
                        tmdbId,
                        imdbId,
                        season: seasonNumber,
                        episode: episodeNumber
                    });
                    if (result) {
                        setSubtitleUrl(result.url);
                        setSubtitleLanguage(result.language);
                        setVttContent(result.vttContent);
                        setConteudoDaLegenda(conteudoAtual);
                        setSubtitlesEnabled(true);
                        // Show warning if using fallback language
                        if (result.warning) {
                            setSubtitleWarning(textoDoAviso(result.warning));
                            // Clear warning after 5 seconds
                            setTimeout(() => setSubtitleWarning(null), 5000);
                        }
                    } else {
                        // Pode não ser "esse filme não tem legenda": sem chave
                        // do OpenSubtitles nada é sequer buscado.
                        setSubtitleWarning(t('player', chaveDaMensagem(await motivoDeNaoTerLegenda())));
                        setTimeout(() => setSubtitleWarning(null), 6000);
                    }
                } catch (error) {
                    console.error('Error fetching subtitles:', error);
                } finally {
                    setSubtitleLoading(false);
                }
            } else {
                setSubtitlesEnabled(true);
                const video = videoRef.current;
                if (video && video.textTracks.length > 0) {
                    for (let i = 0; i < video.textTracks.length; i++) {
                        video.textTracks[i].mode = 'showing';
                    }
                }
            }
        }
    };

    // Explicit language pick from the settings menu (strict — no fallback chain).
    const handleSubtitleLanguageSelect = async (lang: string) => {
        if (!title) return;
        if (subtitleUrl) cleanupSubtitleUrl(subtitleUrl);
        setSubtitleLoading(true);
        setIsForcedSubtitle(false);
        try {
            const result = await autoFetchSubtitle({
                title,
                tmdbId,
                imdbId,
                season: seasonNumber,
                episode: episodeNumber,
                language: lang
            });
            if (result) {
                setSubtitleUrl(result.url);
                setSubtitleLanguage(result.language);
                setVttContent(result.vttContent);
                setConteudoDaLegenda(conteudoAtual);
                setSubtitlesEnabled(true);
            } else {
                const motivo = await motivoDeNaoTerLegenda();
                // O idioma só entra na frase quando a busca de fato aconteceu —
                // "(PT-BR)" ao lado de "configure a chave" confundiria.
                setSubtitleWarning(motivo === 'nada-encontrado'
                    ? `${t('player', 'noSubtitlesFound')} (${lang.toUpperCase()})`
                    : t('player', chaveDaMensagem(motivo)));
                setTimeout(() => setSubtitleWarning(null), 6000);
            }
        } catch (error) {
            console.error('Error fetching subtitles for language:', error);
        } finally {
            setSubtitleLoading(false);
        }
    };

    // Turn subtitles fully off (settings menu "Desligada").
    /**
     * Legenda de um arquivo do computador.
     *
     * Guarda o resultado num blob em `subtitleUrl`, como os outros caminhos
     * fazem, por um motivo concreto: com `subtitleUrl` vazio, o próximo clique
     * no CC cai em `if (!subtitleUrl && title)` e BAIXA uma legenda do
     * OpenSubtitles por cima da que o usuário acabou de escolher.
     */
    const handleOpenSubtitleFile = async () => {
        try {
            const arquivo = await openSubtitleFileFromDisk();
            if (!arquivo?.content) return; // cancelou o diálogo
            const vtt = diskSubtitleToVtt(arquivo.content);
            if (subtitleUrl) cleanupSubtitleUrl(subtitleUrl);
            const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
            setSubtitleUrl(blobUrl);
            setVttContent(vtt);
            setConteudoDaLegenda(conteudoAtual);
            setSubtitleLanguage(null);
            setDiskSubtitleName(arquivo.name);
            setIsForcedSubtitle(false);
            setSubtitlesEnabled(true);
        } catch (error) {
            console.error('Failed to open subtitle from disk:', error);
            setSubtitleWarning(t('player', 'subtitleFileError'));
            setTimeout(() => setSubtitleWarning(null), 4000);
        }
    };

    const handleSubtitlesOff = () => {
        setSubtitlesEnabled(false);
        setIsForcedSubtitle(false);
        setDiskSubtitleName(null);
        if (subtitleUrl) {
            cleanupSubtitleUrl(subtitleUrl);
            setSubtitleUrl(null);
            setSubtitleLanguage(null);
            setVttContent(null);
        }
        const video = videoRef.current;
        if (video && video.textTracks.length > 0) {
            for (let i = 0; i < video.textTracks.length; i++) {
                video.textTracks[i].mode = 'hidden';
            }
        }
    };

    // Forced-subtitles session toggle (settings dropdown row)
    const handleForcedSessionToggle = async () => {
        const newValue = !forcedEnabledForSession;
        setForcedEnabledForSession(newValue);

        if (!newValue && isForcedSubtitle) {
            // Disabling: remove current forced subtitle
            setSubtitlesEnabled(false);
            setIsForcedSubtitle(false);
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
                setSubtitleUrl(null);
                setVttContent(null);
            }
        } else if (newValue && !subtitlesEnabled) {
            // Enabling: load forced subtitles now
            try {
                const { autoFetchForcedSubtitle } = await import('../../services/subtitleService');
                const result = await autoFetchForcedSubtitle({
                    title: title || '',
                    tmdbId,
                    imdbId,
                    season: seasonNumber,
                    episode: episodeNumber
                });
                if (result && result.warning) {
                    // Show warning toast for rejected special editions
                    setSubtitleWarning(textoDoAviso(result.warning));
                    setTimeout(() => setSubtitleWarning(null), 4000);
                } else if (result && result.vttContent) {
                    const blob = new Blob([result.vttContent], { type: 'text/vtt' });
                    const blobUrl = URL.createObjectURL(blob);
                    setSubtitleUrl(blobUrl);
                    setVttContent(result.vttContent);
                    setConteudoDaLegenda(conteudoAtual);
                    setSubtitlesEnabled(true);
                    setIsForcedSubtitle(true);
                } else {
                    setSubtitleWarning(t('player', 'noForcedSubtitlesFound'));
                    setTimeout(() => setSubtitleWarning(null), 4000);
                }
            } catch (e) {
                console.error('Failed to load forced subtitles:', e);
                setSubtitleWarning(t('player', 'errorLoadingSubtitles'));
                setTimeout(() => setSubtitleWarning(null), 4000);
            }
        }
    };

    // Legenda guardada de OUTRO conteúdo, com o CC desligado, não existe para
    // quem está de fora: o atalho "C" só alterna a visibilidade quando há
    // `vttContent`, e ressuscitaria a do episódio anterior.
    const vttExposto = !subtitlesEnabled && conteudoDaLegenda !== conteudoAtual ? null : vttContent;

    return {
        subtitlesEnabled,
        setSubtitlesEnabled,
        subtitleLoading,
        subtitleLanguage,
        vttContent: vttExposto,
        /**
         * A legenda que está NA TELA — é ela que vai junto quando o vídeo é
         * mandado para a TV. Com o CC desligado a legenda continua carregada,
         * mas quem desligou não quer vê-la na TV.
         */
        legendaNaTela: subtitlesEnabled ? vttExposto : null,
        subtitleWarning,
        isForcedSubtitle,
        forcedEnabledForSession,
        handleSubtitleToggle,
        handleSubtitleLanguageSelect,
        handleSubtitlesOff,
        handleOpenSubtitleFile,
        diskSubtitleName,
        handleForcedSessionToggle
    };
}
