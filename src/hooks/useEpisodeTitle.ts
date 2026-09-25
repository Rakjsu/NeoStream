import { useState, useEffect } from 'react';
import { fetchEpisodeDetails } from '../services/tmdb';
import { episodeDisplayTitle } from '../utils/seriesEpisodes';

interface ProviderEpisode {
    episode_num: number | string;
    title?: string;
}

/**
 * Título do provedor que não diz nada ("S01E03", "Episode 3", vazio). A
 * limpeza é a MESMA da lista de episódios da ficha (`episodeDisplayTitle`):
 * quando ela cai no "Episódio N" de reserva, o nome tem que vir do TMDB.
 */
const isGenericTitle = (episode: ProviderEpisode): boolean => {
    const num = Number(episode.episode_num);
    return episodeDisplayTitle(episode.title, num) === `Episódio ${num}`;
};

/**
 * 📺 Nome do episódio que está TOCANDO, para o título do player.
 *
 * Substitui o `useSeriesMetadata` (#D047). Aquele hook resolvia a série
 * inteira no TMDB (a ficha já faz isso), e o `getEpisodeTitle` dele era
 * chamado pelo painel escondido pra CADA episódio da temporada: um GET por
 * título genérico, disparado durante o render, pra uma lista que ninguém via.
 *
 * Aqui só vão ao TMDB o episódio tocando e o PRÓXIMO da temporada. O próximo
 * não é enfeite: o player usa o título como dependência da sessão de
 * Estatísticas (que alimenta o limite diário do perfil) e do scrobble do
 * Trakt, então um título que muda DEPOIS de o episódio começar encerra a
 * sessão. Com o nome do próximo já em mãos, o "próximo episódio" abre com o
 * título final, como abria quando o painel pré-carregava a temporada.
 *
 * `tmdbId` indefinido = nada tocando: nenhuma busca. A busca mora num
 * efeito (o render não tem efeito colateral) e o resultado fica num mapa
 * por série/temporada/episódio, lido de forma síncrona. O `services/tmdb`
 * guarda o episódio em memória + localStorage, então rever não repete o GET.
 */
export function useEpisodeTitle(
    tmdbId: string | undefined,
    season: number,
    episodeNum: number,
    seasonEpisodes: ProviderEpisode[] | undefined
): string {
    const [tmdbNames, setTmdbNames] = useState<Record<string, string>>({});
    const findEpisode = (num: number) => seasonEpisodes?.find(ep => Number(ep.episode_num) === num);
    const current = findEpisode(episodeNum);
    const next = findEpisode(episodeNum + 1);

    // String estável como dependência: o array de episódios muda de
    // identidade a cada render da página.
    const wanted = [current, next]
        .filter((ep): ep is ProviderEpisode => !!ep && isGenericTitle(ep))
        .map(ep => Number(ep.episode_num))
        .join(',');

    useEffect(() => {
        if (!tmdbId || !wanted) return;
        for (const num of wanted.split(',').map(Number)) {
            const key = `${tmdbId}-${season}-${num}`;
            fetchEpisodeDetails(tmdbId, season, num)
                .then(details => {
                    const name = details?.name;
                    if (name) setTmdbNames(prev => (prev[key] === name ? prev : { ...prev, [key]: name }));
                })
                .catch(() => { });
        }
    }, [tmdbId, season, wanted]);

    if (!current) return `Episódio ${episodeNum}`;
    if (!isGenericTitle(current)) return `Episódio ${episodeNum} - ${episodeDisplayTitle(current.title, episodeNum)}`;
    const tmdbName = tmdbNames[`${tmdbId}-${season}-${episodeNum}`];
    return tmdbName ? `Episódio ${episodeNum} - ${tmdbName}` : `Episódio ${episodeNum}`;
}
