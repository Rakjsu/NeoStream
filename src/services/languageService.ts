// Language Service - Simple i18n system
// To add a new language, simply create a new JSON file in /src/locales/ and add it here

const STORAGE_KEY = 'neostream_language';

export type SupportedLanguage = 'pt' | 'en' | 'es';

export interface LanguageOption {
    code: SupportedLanguage;
    name: string;
    flag: string;
}

export const AVAILABLE_LANGUAGES: LanguageOption[] = [
    { code: 'pt', name: 'Português', flag: '🇧🇷' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Español', flag: '🇪🇸' }
];

// Translation dictionaries
const translations: Record<SupportedLanguage, Record<string, Record<string, string>>> = {
    pt: {
        // Sidebar / Navigation
        nav: {
            updates: 'Atualizações',
            playback: 'Reprodução',
            stats: 'Estatísticas',
            parental: 'Controle Parental',
            about: 'Sobre',
            // Sidebar menu items
            home: 'Início',
            liveTV: 'TV ao Vivo',
            movies: 'Filmes',
            series: 'Séries',
            myList: 'Minha Lista',
            favorites: 'Favoritos',
            downloads: 'Baixados',
            settings: 'Configurações',
            // Profile
            switchProfile: 'Trocar Perfil',
            manageProfiles: 'Gerenciar Perfis',
            switchingProfile: 'Trocando perfil...',
            // PIN
            enterPin: 'Digite o PIN',
            profile: 'Perfil',
            incorrectPin: 'PIN incorreto',
            cancel: 'Cancelar',
            enter: 'Entrar',
            // Logout
            logout: 'Sair'
        },
        // Login page
        login: {
            serverAddress: 'Endereço do servidor',
            username: 'Usuário',
            password: 'Senha',
            includeTV: 'Incluir canais de TV',
            includeVOD: 'Incluir VOD (Filmes e Séries)',
            back: 'Voltar',
            loginButton: 'Login',
            authenticating: 'Autenticando...',
            continueButton: 'Continuar',
            playlistNameLabel: 'Digite o nome da playlist',
            playlistPlaceholder: 'Minha Playlist',
            library: 'Biblioteca',
            iptvLogin: 'Login IPTV',
            channels: 'Canais',
            moviesCount: 'Filmes',
            seriesCount: 'Séries',
            // Search placeholders
            searchMovies: 'Buscar filmes...',
            searchSeries: 'Buscar séries...',
            searchChannels: 'Buscar canais...',
            // Error messages
            connectionError: 'Não foi possível conectar ao servidor',
            connectionErrorDetails: 'Verifique: URL do servidor, servidor online, sua conexão',
            authError: 'Usuário ou senha incorretos',
            timeoutError: 'Tempo esgotado. O servidor demorou muito para responder.',
            unexpectedError: 'Erro inesperado. Verifique as configurações.',
            notAuthenticated: 'Não autenticado. Faça login novamente.',
            loadChannelsError: 'Erro ao carregar canais',
            loadMoviesError: 'Erro ao carregar filmes',
            loadSeriesError: 'Erro ao carregar séries',
            invalidUrl: 'URL inválida. Verifique o endereço do servidor.'
        },
        // Profile creation/management
        profile: {
            createNewProfile: 'Criar Novo Perfil',
            name: 'Nome',
            enterName: 'Digite o nome',
            avatar: 'Avatar',
            emoji: 'Emoji',
            image: 'Imagem',
            changeImage: 'Alterar Imagem',
            protectWithPin: 'Proteger com PIN (4 dígitos)',
            pin: 'PIN',
            confirmPin: 'Confirmar PIN',
            cancel: 'Cancelar',
            createProfile: 'Criar Perfil',
            addProfile: 'Adicionar Perfil',
            manageProfiles: 'Gerenciar Perfis',
            whoIsWatching: 'Quem está assistindo?',
            deleteProfile: 'Excluir Perfil',
            confirmDelete: 'Tem certeza que deseja excluir este perfil?',
            delete: 'Excluir',
            // Error messages
            imageTooBig: 'Imagem muito grande! Máximo 50KB.',
            nameRequired: 'Nome é obrigatório',
            nameMaxLength: 'Nome deve ter no máximo 20 caracteres',
            pinMustBe4Digits: 'PIN deve ter exatamente 4 dígitos',
            pinsDoNotMatch: 'PINs não conferem',
            profileCreationError: 'Erro ao criar perfil. Limite de 5 perfis atingido?',
            editProfile: 'Editar Perfil',
            save: 'Salvar',
            profileName: 'Nome do perfil',
            protectedProfile: 'Perfil protegido',
            done: 'Concluído',
            tryAgain: 'Tente novamente',
            needOneProfile: 'Você precisa ter pelo menos um perfil!',
            enterPin: 'Digite o PIN',
            active: 'Ativo',
            edit: 'Editar',
            addPin: 'Adicionar PIN',
            currentPin: 'PIN Atual',
            newPin: 'Novo PIN',
            enterCurrentPin: 'Digite seu PIN atual',
            enterNewPin: 'Digite o novo PIN de 4 dígitos',
            reenterNewPin: 'Digite o novo PIN novamente',
            removePin: 'Remover PIN',
            continue: 'Continuar',
            enter: 'Entrar',
            cannotDeleteActive: 'Não é possível deletar o perfil ativo!',
            cannotDeleteLast: 'Não é possível deletar o último perfil!',
            cannotDeleteKids: 'O perfil Kids não pode ser deletado!',
            confirmDeletion: 'Confirmar Exclusão',
            enterPinToDelete: 'Digite o PIN para deletar',
            actionCannotBeUndone: 'Esta ação não pode ser desfeita.',
            pinActive: 'PIN Ativo',
            currentPinIncorrect: 'PIN atual incorreto'
        },
        // Cast device selector
        cast: {
            title: 'Transmitir para TV',
            selectDevice: 'Selecione um dispositivo',
            searchNetwork: 'Buscar na rede',
            searching: 'Buscando dispositivos...',
            noDevices: 'Nenhum dispositivo encontrado',
            addManually: 'Adicione sua TV manualmente ou busque na rede',
            addTVManually: 'Adicionar TV manualmente',
            tip: 'Dica:',
            tipText: 'A TV deve estar ligada e conectada na mesma rede Wi-Fi',
            back: 'Voltar',
            addSmartTV: 'Adicionar Smart TV',
            nameOptional: 'Nome (opcional)',
            ipAddress: 'Endereço IP',
            port: 'Porta',
            addTV: 'Adicionar TV',
            howToFindIP: 'Como encontrar o IP:',
            howToFindIPText: 'TV → Configurações → Rede → Status da Rede',
            enterIP: 'Digite o IP da sua Smart TV',
            failedToTransmit: 'Falha ao transmitir',
            errorAddingDevice: 'Erro ao adicionar dispositivo',
            connected: 'Conectado',
            discovered: 'Descoberto'
        },
        // Category menu
        categories: {
            title: 'Categorias',
            exploreByGenre: 'Explore por gênero',
            loadingCategories: 'Carregando categorias...',
            loadingChannels: 'Carregando canais',
            allMovies: 'Todos os Filmes',
            allChannels: 'Todos os Canais',
            allSeries: 'Todas as Séries',
            continueWatching: 'Continue Assistindo',
            completedSeries: 'Séries Finalizadas',
            watchedMovies: 'Filmes Assistidos'
        },
        // Live TV
        liveTV: {
            scheduleTitle: 'Grade Horária',
            live: 'AO VIVO',
            watchNow: 'Assistir Agora',
            close: 'Fechar',
            nowPlaying: 'AGORA',
            upNext: 'A Seguir',
            noScheduleInfo: 'Sem informações de programação'
        },
        // Content Modal (Movies/Series)
        contentModal: {
            // Watch buttons
            watchOffline: 'Assistir Offline',
            continueWatching: 'Continuar Assistindo',
            watchMovie: 'Assistir Filme',
            offlineSeason: 'Offline T',
            watchSeason: 'Assistir T',
            episode: 'E',
            // Watch Later
            saved: 'Salvo',
            watchLater: 'Assistir Depois',
            // Download
            downloaded: 'Baixado',
            download: 'Baixar',
            downloadTooltip: 'Baixar para assistir offline',
            // Trailer
            watchTrailer: 'Ver Trailer',
            trailerTooltip: 'Assistir trailer',
            // Favorites
            removeFromFavorites: 'Remover dos Favoritos',
            addToFavorites: 'Adicionar aos Favoritos',
            // Content type badges
            movie: 'Filme',
            series: 'Série',
            seasons: 'Temporada',
            seasonsPlural: 'Temporadas',
            noDescription: 'Sem descrição disponível.',
            // Download Modal
            whatToDownload: 'O que deseja baixar?',
            season: 'Temporada',
            seasonComplete: 'Temporada {season} completa ({count} eps em download)',
            downloadRemaining: 'Baixar {count} episódios restantes ({downloaded} já na fila)',
            downloadSeason: 'Temporada {season} ({count} episódios)',
            episodeAlreadyDownloading: 'Episódio {episode} já está em download',
            onlyEpisode: 'Apenas Episódio {episode}',
            cancel: 'Cancelar'
        },
        // Settings page
        settings: {
            title: 'Configurações',
            subtitle: 'Personalize sua experiência',
            saved: '✓ Salvo'
        },
        // Updates section
        updates: {
            title: 'Atualizações Automáticas',
            description: 'Mantenha seu aplicativo sempre atualizado',
            checkFrequency: 'Verificar atualizações',
            checkFrequencyDesc: 'Define com que frequência o app verifica por novas versões',
            onOpen: 'Ao abrir o app',
            daily: 'A cada 1 dia',
            weekly: 'A cada 1 semana',
            monthly: 'A cada 1 mês',
            autoInstall: 'Instalar automaticamente',
            autoInstallDesc: 'Atualizações serão instaladas sem pedir confirmação',
            language: 'Idioma',
            languageDesc: 'Idioma da interface',
            lastCheck: 'Última verificação',
            checkNow: 'Verificar Atualizações Agora',
            checking: 'Verificando...'
        },
        // Playback section
        playback: {
            title: 'Reprodução',
            description: 'Ajuste a reprodução de vídeo e áudio',
            bufferSize: 'Tamanho do Buffer',
            bufferSizeDesc: 'Tempo de buffer antes de iniciar a reprodução',
            intelligent: '🧠 Inteligente (Adaptativo)',
            seconds: 'segundos',
            videoCodec: 'Codificador de Vídeo',
            videoCodecDesc: 'Codec de vídeo preferencial',
            autoPlayNext: 'Auto-play próximo episódio',
            autoPlayNextDesc: 'Reproduzir automaticamente o próximo episódio',
            skipIntro: 'Pular intro automaticamente',
            skipIntroDesc: 'Pular abertura de séries quando disponível',
            subtitleLanguage: 'Idioma das Legendas',
            subtitleLanguageDesc: 'Idioma preferido para download automático de legendas'
        },
        // Stats section
        stats: {
            title: 'Suas Estatísticas',
            description: 'Acompanhe seu tempo de visualização',
            thisMonth: 'este mês',
            currentStreak: 'sequência atual',
            timeByType: 'Tempo por Tipo',
            movies: 'Filmes',
            series: 'Séries',
            liveTV: 'TV ao Vivo',
            last7Days: 'Últimos 7 Dias',
            totalAccumulated: 'Total acumulado',
            longestStreak: 'Maior sequência',
            days: 'dias'
        },
        // Parental section
        parental: {
            title: 'Controle Parental',
            description: 'Gerencie o acesso ao conteúdo',
            enable: 'Ativar Controle Parental',
            enableDesc: 'Restringir acesso a conteúdo adulto',
            maxRating: 'Classificação Máxima',
            maxRatingDesc: 'Limite de classificação indicativa',
            free: 'Livre',
            years: 'anos',
            pin: 'PIN de Acesso',
            pinConfigured: 'PIN configurado ✓',
            pinDefine: 'Definir PIN para desbloquear conteúdo',
            changePin: 'Alterar',
            setPin: 'Definir',
            blockAdult: 'Bloquear Categorias Adultas',
            blockAdultDesc: 'Ocultar automaticamente categorias adultas',
            filterTMDB: 'Filtrar por TMDB',
            filterTMDBDesc: 'Verificar classificação no TMDB automaticamente',
            enterPin: 'Digite seu PIN',
            confirmPin: 'Confirme seu PIN',
            verifyPin: 'Digite o PIN para desativar',
            pinError4Digits: 'Digite 4 dígitos',
            pinIncorrect: 'PIN incorreto',
            pinMismatch: 'Os PINs não coincidem',
            confirm: 'Confirmar',
            cancel: 'Cancelar'
        },
        // About section
        about: {
            title: 'Sobre o Aplicativo',
            description: 'Informações e créditos',
            appDescription: 'Sua experiência de streaming completa com TV ao vivo, filmes e séries.',
            termsOfUse: 'Termos de Uso',
            privacyPolicy: 'Política de Privacidade',
            support: 'Suporte',
            version: 'Versão'
        },
        // Playback section
        playback: {
            title: 'Reprodução',
            description: 'Ajuste a reprodução de vídeo e áudio',
            bufferSize: 'Tamanho do Buffer',
            bufferSizeDesc: 'Tempo de buffer antes de iniciar a reprodução',
            intelligent: '🧠 Inteligente (Adaptativo)',
            seconds: 'segundos',
            videoCodec: 'Codificador de Vídeo',
            videoCodecDesc: 'Codec de vídeo preferido',
            autoPlayNext: 'Reproduzir próximo episódio',
            autoPlayNextDesc: 'Reproduzir automaticamente o próximo episódio',
            skipIntro: 'Pular intro automaticamente',
            skipIntroDesc: 'Pular abertura de séries quando disponível',
            subtitleLanguage: 'Idioma das Legendas',
            subtitleLanguageDesc: 'Idioma preferido para download automático de legendas',
            forcedSubtitles: 'Legendas Forçadas',
            forcedSubtitlesDesc: 'Carregar automaticamente legendas de placas e diálogos estrangeiros (não funciona em conteúdo [L] já legendado)'
        },
        // Dashboard / Main navigation
        dashboard: {
            live: 'TV Ao Vivo',
            vod: 'Filmes',
            series: 'Séries',
            settings: 'Configurações',
            downloads: 'Downloads',
            favorites: 'Favoritos',
            watchLater: 'Assistir Depois'
        },
        // Common
        common: {
            search: 'Buscar',
            loading: 'Carregando...',
            error: 'Erro',
            retry: 'Tentar novamente',
            close: 'Fechar',
            save: 'Salvar',
            yes: 'Sim',
            no: 'Não',
            play: 'Assistir',
            pause: 'Pausar',
            resume: 'Continuar',
            download: 'Baixar',
            delete: 'Excluir',
            season: 'Temporada',
            episode: 'Episódio',
            minutes: 'min',
            hours: 'h'
        },
        // Video Player
        player: {
            quality: 'Qualidade',
            speed: 'Velocidade',
            version: 'Versão',
            subtitles: 'Legendas',
            audio: 'Áudio',
            fullscreen: 'Tela cheia',
            exitFullscreen: 'Sair da tela cheia',
            nextEpisode: 'Próximo episódio',
            previousEpisode: 'Episódio anterior'
        },
        // Notifications
        notifications: {
            title: 'Notificações',
            tooltip: 'Notificações',
            new: 'nova',
            newPlural: 'novas',
            newSeason: 'Nova Temporada',
            newEpisodes: 'Novos Episódios',
            downloadComplete: 'Download Concluído',
            downloadFailed: 'Download Falhou',
            downloadStarted: 'Download Iniciado',
            notification: 'Notificação',
            markAsRead: 'Marcar como lida',
            markAllAsRead: 'Marcar todas como lidas',
            clearAll: 'Limpar todas',
            noNotifications: 'Nenhuma notificação',
            newNotifications: 'Novidades aparecerão aqui',
            ago: 'atrás',
            now: 'agora'
        },
        // Changelog / Post Update
        changelog: {
            updateInstalled: 'Atualização Instalada!',
            whatsNew: 'Novidades na',
            gotIt: 'Entendi, vamos lá!',
            // Version 2.9.0
            i18nTitle: 'Redesign de Interface',
            i18nItems: 'Página Welcome redesenhada com animações|Página de Login premium com gradientes|Painel de Configurações deslizante|Telas de erro estilizadas para TV, Filmes e Séries',
            profilesTitle: 'Traduções Aprimoradas',
            profilesItems: 'Todas mensagens de erro traduzidas|Tradução de URL inválida|Badge de login traduzido',
            fixesTitle: 'Correções',
            fixesItems: 'Notificações removidas ao marcar como lida|Erros de escape em strings corrigidos'
        },
        // Welcome page
        welcome: {
            noChannels: 'Nenhuma playlist configurada',
            addPlaylistHint: 'Adicione uma playlist do seu provedor IPTV para começar a assistir',
            addPlaylist: 'Adicionar Playlist',
            addPlaylistDesc: 'Conecte sua conta IPTV',
            settings: 'Configurações',
            settingsDesc: 'Personalize o aplicativo',
            disclaimer: 'NeoStream não fornece conteúdo. Use sua própria assinatura IPTV.'
        },
        // Home page
        home: {
            goodMorning: 'Bom dia',
            goodAfternoon: 'Boa tarde',
            goodEvening: 'Boa noite',
            continueWatching: 'Continue Assistindo',
            recommendations: 'Recomendados Para Você',
            recentSeries: 'Séries Recentes',
            recentMovies: 'Filmes Recentes',
            series: 'SÉRIE',
            movie: 'FILME',
            newEpisode: 'Novo Ep!',
            removeFromContinue: 'Remover de Continue Assistindo',
            notAvailableForProfile: 'não está disponível para este perfil',
            notSuitableForKids: 'não é adequado para crianças',
            minRemaining: 'min restantes',
            hRemaining: 'h restantes',
            channels: 'Canais',
            movies: 'Filmes',
            seriesCount: 'Séries',
            quickAccess: 'Acesso Rápido',
            liveTV: 'TV ao Vivo',
            myList: 'Minha Lista',
            favorites: 'Favoritos',
            downloaded: 'Baixados',
            settings: 'Configurações',
            whatToWatch: 'O que você quer assistir hoje?',
            locale: 'pt-BR'
        },
        // Watch Later / My List page
        watchLater: {
            title: 'Minha Lista',
            emptyTitle: 'Sua lista está vazia',
            emptyText: 'Adicione filmes e séries para assistir depois clicando no botão',
            emptyButton: '+ Minha Lista',
            itemsSaved: 'itens salvos',
            itemSaved: 'item salvo',
            clearAll: 'Limpar Tudo',
            all: 'Todos',
            movies: 'Filmes',
            series: 'Séries',
            noMovies: 'Nenhum filme salvo',
            noSeries: 'Nenhuma série salva',
            removeFromList: 'Remover da lista',
            movie: 'Filme',
            serie: 'Série',
            exploreMovies: 'Explorar Filmes',
            exploreSeries: 'Explorar Séries'
        },
        // Favorites page
        favoritesPage: {
            title: 'Favoritos',
            emptyTitle: 'Nenhum favorito ainda',
            emptyText: 'Adicione filmes e séries aos favoritos clicando no',
            emptyButton: '❤️',
            itemCount: 'itens',
            clearAll: 'Limpar Favoritos',
            all: 'Todos',
            movies: 'Filmes',
            series: 'Séries',
            noMovies: 'Nenhum filme favorito',
            noSeries: 'Nenhuma série favorita',
            removeFromFavorites: 'Remover dos favoritos',
            movie: 'Filme',
            serie: 'Série',
            exploreMovies: 'Explorar Filmes',
            exploreSeries: 'Explorar Séries'
        },
        // Downloads page
        downloads: {
            title: 'Downloads',
            emptyTitle: 'Nenhum download ainda',
            emptyText: 'Baixe filmes e séries para assistir offline',
            storageUsed: 'Usado',
            storageFree: 'Livre',
            openFolder: 'Abrir Pasta',
            all: 'Todos',
            movies: 'Filmes',
            series: 'Séries',
            pending: 'Pendente',
            downloading: 'Baixando',
            completed: 'Concluído',
            downloaded: 'Baixado',
            paused: 'Pausado',
            failed: 'Falhou',
            noDownloads: 'Nenhum download',
            deleteConfirm: 'Tem certeza que deseja excluir',
            deleteConfirmText: 'Este arquivo será removido permanentemente.',
            cancel: 'Cancelar',
            delete: 'Excluir',
            resume: 'Retomar',
            resumeDownload: 'Retomar Download',
            continueDownload: 'Continuar',
            waitingInQueue: 'Aguardando na fila...',
            play: 'Assistir',
            watchEpisode: 'Assistir Episódio',
            episodeNotDownloaded: 'ainda não foi baixado',
            removeDownload: 'Remover download',
            removeSeries: 'Remover série',
            movie: 'Filme',
            serie: 'Série',
            episode: 'Episódio',
            season: 'Temporada',
            seasons: 'Temporadas',
            episodes: 'episódios',
            offline: 'Offline',
            exploreMovies: 'Explorar Filmes',
            exploreSeries: 'Explorar Séries',
            availableOffline: 'está disponível offline!',
            failedTo: 'Falha ao baixar'
        }
    },
    en: {
        nav: {
            updates: 'Updates',
            playback: 'Playback',
            stats: 'Statistics',
            parental: 'Parental Control',
            about: 'About',
            // Sidebar menu items
            home: 'Home',
            liveTV: 'Live TV',
            movies: 'Movies',
            series: 'Series',
            myList: 'My List',
            favorites: 'Favorites',
            downloads: 'Downloads',
            settings: 'Settings',
            // Profile
            switchProfile: 'Switch Profile',
            manageProfiles: 'Manage Profiles',
            switchingProfile: 'Switching profile...',
            // PIN
            enterPin: 'Enter PIN',
            profile: 'Profile',
            incorrectPin: 'Incorrect PIN',
            cancel: 'Cancel',
            enter: 'Enter',
            // Logout
            logout: 'Logout'
        },
        // Login page
        login: {
            serverAddress: 'Server address',
            username: 'Username',
            password: 'Password',
            includeTV: 'Include TV channels',
            includeVOD: 'Include VOD (Movies and Series)',
            back: 'Back',
            loginButton: 'Login',
            authenticating: 'Authenticating...',
            continueButton: 'Continue',
            playlistNameLabel: 'Enter playlist name',
            playlistPlaceholder: 'My Playlist',
            library: 'Library',
            iptvLogin: 'IPTV Login',
            channels: 'Channels',
            moviesCount: 'Movies',
            seriesCount: 'Series',
            // Search placeholders
            searchMovies: 'Search movies...',
            searchSeries: 'Search series...',
            searchChannels: 'Search channels...',
            // Error messages
            connectionError: 'Could not connect to server',
            connectionErrorDetails: 'Check: Server URL, server online, your connection',
            authError: 'Incorrect username or password',
            timeoutError: 'Timeout. Server took too long to respond.',
            unexpectedError: 'Unexpected error. Check settings.',
            notAuthenticated: 'Not authenticated. Please login again.',
            loadChannelsError: 'Error loading channels',
            loadMoviesError: 'Error loading movies',
            loadSeriesError: 'Error loading series',
            invalidUrl: 'Invalid URL. Check the server address.'
        },
        // Profile creation/management
        profile: {
            createNewProfile: 'Create New Profile',
            name: 'Name',
            enterName: 'Enter name',
            avatar: 'Avatar',
            emoji: 'Emoji',
            image: 'Image',
            changeImage: 'Change Image',
            protectWithPin: 'Protect with PIN (4 digits)',
            pin: 'PIN',
            confirmPin: 'Confirm PIN',
            cancel: 'Cancel',
            createProfile: 'Create Profile',
            addProfile: 'Add Profile',
            manageProfiles: 'Manage Profiles',
            whoIsWatching: 'Who is watching?',
            deleteProfile: 'Delete Profile',
            confirmDelete: 'Are you sure you want to delete this profile?',
            delete: 'Delete',
            // Error messages
            imageTooBig: 'Image too large! Maximum 50KB.',
            nameRequired: 'Name is required',
            nameMaxLength: 'Name must be at most 20 characters',
            pinMustBe4Digits: 'PIN must be exactly 4 digits',
            pinsDoNotMatch: 'PINs do not match',
            profileCreationError: 'Error creating profile. Profile limit reached?',
            editProfile: 'Edit Profile',
            save: 'Save',
            profileName: 'Profile name',
            protectedProfile: 'Protected profile',
            done: 'Done',
            tryAgain: 'Try again',
            needOneProfile: 'You need at least one profile!',
            enterPin: 'Enter PIN',
            active: 'Active',
            edit: 'Edit',
            addPin: 'Add PIN',
            currentPin: 'Current PIN',
            newPin: 'New PIN',
            enterCurrentPin: 'Enter your current PIN',
            enterNewPin: 'Enter the new 4-digit PIN',
            reenterNewPin: 'Enter the new PIN again',
            removePin: 'Remove PIN',
            continue: 'Continue',
            enter: 'Enter',
            cannotDeleteActive: 'Cannot delete active profile!',
            cannotDeleteLast: 'Cannot delete the last profile!',
            cannotDeleteKids: 'Kids profile cannot be deleted!',
            confirmDeletion: 'Confirm Deletion',
            enterPinToDelete: 'Enter PIN to delete',
            actionCannotBeUndone: 'This action cannot be undone.',
            pinActive: 'PIN Active',
            currentPinIncorrect: 'Current PIN is incorrect'
        },
        // Cast device selector
        cast: {
            title: 'Cast to TV',
            selectDevice: 'Select a device',
            searchNetwork: 'Search network',
            searching: 'Searching for devices...',
            noDevices: 'No devices found',
            addManually: 'Add your TV manually or search the network',
            addTVManually: 'Add TV manually',
            tip: 'Tip:',
            tipText: 'The TV must be on and connected to the same Wi-Fi network',
            back: 'Back',
            addSmartTV: 'Add Smart TV',
            nameOptional: 'Name (optional)',
            ipAddress: 'IP Address',
            port: 'Port',
            addTV: 'Add TV',
            howToFindIP: 'How to find IP:',
            howToFindIPText: 'TV → Settings → Network → Network Status',
            enterIP: 'Enter your Smart TV IP',
            failedToTransmit: 'Failed to transmit',
            errorAddingDevice: 'Error adding device',
            connected: 'Connected',
            discovered: 'Discovered'
        },
        // Category menu
        categories: {
            title: 'Categories',
            exploreByGenre: 'Explore by genre',
            loadingCategories: 'Loading categories...',
            loadingChannels: 'Loading channels',
            allMovies: 'All Movies',
            allChannels: 'All Channels',
            allSeries: 'All Series',
            continueWatching: 'Continue Watching',
            completedSeries: 'Completed Series',
            watchedMovies: 'Watched Movies'
        },
        // Live TV
        liveTV: {
            scheduleTitle: 'TV Schedule',
            live: 'LIVE',
            watchNow: 'Watch Now',
            close: 'Close',
            nowPlaying: 'NOW',
            upNext: 'Up Next',
            noScheduleInfo: 'No schedule information available'
        },
        // Content Modal (Movies/Series)
        contentModal: {
            // Watch buttons
            watchOffline: 'Watch Offline',
            continueWatching: 'Continue Watching',
            watchMovie: 'Watch Movie',
            offlineSeason: 'Offline S',
            watchSeason: 'Watch S',
            episode: 'E',
            // Watch Later
            saved: 'Saved',
            watchLater: 'Watch Later',
            // Download
            downloaded: 'Downloaded',
            download: 'Download',
            downloadTooltip: 'Download to watch offline',
            // Trailer
            watchTrailer: 'Watch Trailer',
            trailerTooltip: 'Watch trailer',
            // Favorites
            removeFromFavorites: 'Remove from Favorites',
            addToFavorites: 'Add to Favorites',
            // Content type badges
            movie: 'Movie',
            series: 'Series',
            seasons: 'Season',
            seasonsPlural: 'Seasons',
            noDescription: 'No description available.',
            // Download Modal
            whatToDownload: 'What would you like to download?',
            season: 'Season',
            seasonComplete: 'Season {season} complete ({count} eps downloading)',
            downloadRemaining: 'Download {count} remaining episodes ({downloaded} already queued)',
            downloadSeason: 'Season {season} ({count} episodes)',
            episodeAlreadyDownloading: 'Episode {episode} is already downloading',
            onlyEpisode: 'Only Episode {episode}',
            cancel: 'Cancel'
        },
        settings: {
            title: 'Settings',
            subtitle: 'Customize your experience',
            saved: '✓ Saved'
        },
        // Notifications
        notifications: {
            title: 'Notifications',
            tooltip: 'Notifications',
            new: 'new',
            newPlural: 'new',
            newSeason: 'New Season',
            newEpisodes: 'New Episodes',
            downloadComplete: 'Download Complete',
            downloadFailed: 'Download Failed',
            downloadStarted: 'Download Started',
            notification: 'Notification',
            markAsRead: 'Mark as read',
            markAllAsRead: 'Mark all as read',
            clearAll: 'Clear all',
            noNotifications: 'No notifications',
            newNotifications: 'New updates will appear here',
            ago: 'ago',
            now: 'now'
        },
        // Changelog / Post Update
        changelog: {
            updateInstalled: 'Update Installed!',
            whatsNew: "What's New in",
            gotIt: "Got it, let's go!",
            // Version 2.9.0
            i18nTitle: 'Interface Redesign',
            i18nItems: 'Redesigned Welcome page with animations|Premium Login page with gradients|Slide-in Settings panel|Styled error screens for TV, Movies and Series',
            profilesTitle: 'Enhanced Translations',
            profilesItems: 'All error messages translated|Invalid URL translation|Login badge translated',
            fixesTitle: 'Fixes',
            fixesItems: 'Notifications removed when marked as read|Escape errors in strings fixed'
        },
        // Welcome page
        welcome: {
            noChannels: 'No playlist configured',
            addPlaylistHint: 'Add a playlist from your IPTV provider to start watching',
            addPlaylist: 'Add Playlist',
            addPlaylistDesc: 'Connect your IPTV account',
            settings: 'Settings',
            settingsDesc: 'Customize the app',
            disclaimer: 'NeoStream does not provide content. Use your own IPTV subscription.'
        },
        updates: {
            title: 'Automatic Updates',
            description: 'Keep your app always up to date',
            checkFrequency: 'Check for updates',
            checkFrequencyDesc: 'Defines how often the app checks for new versions',
            onOpen: 'On app open',
            daily: 'Every day',
            weekly: 'Every week',
            monthly: 'Every month',
            autoInstall: 'Install automatically',
            autoInstallDesc: 'Updates will be installed without asking for confirmation',
            language: 'Language',
            languageDesc: 'Interface language',
            lastCheck: 'Last check',
            checkNow: 'Check for Updates Now',
            checking: 'Checking...'
        },
        playback: {
            title: 'Playback',
            description: 'Adjust video and audio playback',
            bufferSize: 'Buffer Size',
            bufferSizeDesc: 'Buffer time before starting playback',
            intelligent: '🧠 Intelligent (Adaptive)',
            seconds: 'seconds',
            videoCodec: 'Video Encoder',
            videoCodecDesc: 'Preferred video codec',
            autoPlayNext: 'Auto-play next episode',
            autoPlayNextDesc: 'Automatically play the next episode',
            skipIntro: 'Skip intro automatically',
            skipIntroDesc: 'Skip series opening when available',
            subtitleLanguage: 'Subtitle Language',
            subtitleLanguageDesc: 'Preferred language for automatic subtitle download',
            forcedSubtitles: 'Forced Subtitles',
            forcedSubtitlesDesc: 'Automatically load sign and foreign dialogue subtitles (does not work on [L] content already subtitled)'
        },
        stats: {
            title: 'Your Statistics',
            description: 'Track your viewing time',
            thisMonth: 'this month',
            currentStreak: 'current streak',
            timeByType: 'Time by Type',
            movies: 'Movies',
            series: 'Series',
            liveTV: 'Live TV',
            last7Days: 'Last 7 Days',
            totalAccumulated: 'Total accumulated',
            longestStreak: 'Longest streak',
            days: 'days'
        },
        parental: {
            title: 'Parental Control',
            description: 'Manage content access',
            enable: 'Enable Parental Control',
            enableDesc: 'Restrict access to adult content',
            maxRating: 'Maximum Rating',
            maxRatingDesc: 'Age rating limit',
            free: 'All ages',
            years: 'years',
            pin: 'Access PIN',
            pinConfigured: 'PIN configured ✓',
            pinDefine: 'Set PIN to unlock content',
            changePin: 'Change',
            setPin: 'Set',
            blockAdult: 'Block Adult Categories',
            blockAdultDesc: 'Automatically hide adult categories',
            filterTMDB: 'Filter by TMDB',
            filterTMDBDesc: 'Automatically check rating on TMDB',
            enterPin: 'Enter your PIN',
            confirmPin: 'Confirm your PIN',
            verifyPin: 'Enter PIN to disable',
            pinError4Digits: 'Enter 4 digits',
            pinIncorrect: 'Incorrect PIN',
            pinMismatch: 'PINs do not match',
            confirm: 'Confirm',
            cancel: 'Cancel'
        },
        about: {
            title: 'About the App',
            description: 'Information and credits',
            appDescription: 'Your complete streaming experience with live TV, movies and series.',
            termsOfUse: 'Terms of Use',
            privacyPolicy: 'Privacy Policy',
            support: 'Support',
            version: 'Version'
        },
        dashboard: {
            live: 'Live TV',
            vod: 'Movies',
            series: 'Series',
            settings: 'Settings',
            downloads: 'Downloads',
            favorites: 'Favorites',
            watchLater: 'Watch Later'
        },
        common: {
            search: 'Search',
            loading: 'Loading...',
            error: 'Error',
            retry: 'Try again',
            close: 'Close',
            save: 'Save',
            yes: 'Yes',
            no: 'No',
            play: 'Play',
            pause: 'Pause',
            resume: 'Resume',
            download: 'Download',
            delete: 'Delete',
            season: 'Season',
            episode: 'Episode',
            minutes: 'min',
            hours: 'h'
        },
        player: {
            quality: 'Quality',
            speed: 'Speed',
            version: 'Version',
            subtitles: 'Subtitles',
            audio: 'Audio',
            fullscreen: 'Fullscreen',
            exitFullscreen: 'Exit fullscreen',
            nextEpisode: 'Next episode',
            previousEpisode: 'Previous episode'
        },
        home: {
            goodMorning: 'Good morning',
            goodAfternoon: 'Good afternoon',
            goodEvening: 'Good evening',
            continueWatching: 'Continue Watching',
            recommendations: 'Recommended For You',
            recentSeries: 'Recent Series',
            recentMovies: 'Recent Movies',
            series: 'SERIES',
            movie: 'MOVIE',
            newEpisode: 'New Ep!',
            removeFromContinue: 'Remove from Continue Watching',
            notAvailableForProfile: 'is not available for this profile',
            notSuitableForKids: 'is not suitable for kids',
            minRemaining: 'min remaining',
            hRemaining: 'h remaining',
            channels: 'Channels',
            movies: 'Movies',
            seriesCount: 'Series',
            quickAccess: 'Quick Access',
            liveTV: 'Live TV',
            myList: 'My List',
            favorites: 'Favorites',
            downloaded: 'Downloaded',
            settings: 'Settings',
            whatToWatch: 'What do you want to watch today?',
            locale: 'en-US'
        },
        watchLater: {
            title: 'My List',
            emptyTitle: 'Your list is empty',
            emptyText: 'Add movies and series to watch later by clicking the',
            emptyButton: '+ My List',
            itemsSaved: 'items saved',
            itemSaved: 'item saved',
            clearAll: 'Clear All',
            all: 'All',
            movies: 'Movies',
            series: 'Series',
            noMovies: 'No movies saved',
            noSeries: 'No series saved',
            removeFromList: 'Remove from list',
            movie: 'Movie',
            serie: 'Series',
            exploreMovies: 'Explore Movies',
            exploreSeries: 'Explore Series'
        },
        favoritesPage: {
            title: 'Favorites',
            emptyTitle: 'No favorites yet',
            emptyText: 'Add movies and series to favorites by clicking the',
            emptyButton: '❤️',
            itemCount: 'items',
            clearAll: 'Clear Favorites',
            all: 'All',
            movies: 'Movies',
            series: 'Series',
            noMovies: 'No favorite movies',
            noSeries: 'No favorite series',
            removeFromFavorites: 'Remove from favorites',
            movie: 'Movie',
            serie: 'Series',
            exploreMovies: 'Explore Movies',
            exploreSeries: 'Explore Series'
        },
        downloads: {
            title: 'Downloads',
            emptyTitle: 'No downloads yet',
            emptyText: 'Download movies and series to watch offline',
            storageUsed: 'Used',
            storageFree: 'Free',
            openFolder: 'Open Folder',
            all: 'All',
            movies: 'Movies',
            series: 'Series',
            pending: 'Pending',
            downloading: 'Downloading',
            completed: 'Completed',
            downloaded: 'Downloaded',
            paused: 'Paused',
            failed: 'Failed',
            noDownloads: 'No downloads',
            deleteConfirm: 'Are you sure you want to delete',
            deleteConfirmText: 'This file will be permanently removed.',
            cancel: 'Cancel',
            delete: 'Delete',
            resume: 'Resume',
            resumeDownload: 'Resume Download',
            continueDownload: 'Continue',
            waitingInQueue: 'Waiting in queue...',
            play: 'Play',
            watchEpisode: 'Watch Episode',
            episodeNotDownloaded: 'not yet downloaded',
            removeDownload: 'Remove download',
            removeSeries: 'Remove series',
            movie: 'Movie',
            serie: 'Series',
            episode: 'Episode',
            season: 'Season',
            seasons: 'Seasons',
            episodes: 'episodes',
            offline: 'Offline',
            exploreMovies: 'Explore Movies',
            exploreSeries: 'Explore Series',
            availableOffline: 'is available offline!',
            failedTo: 'Failed to download'
        }
    },
    es: {
        nav: {
            updates: 'Actualizaciones',
            playback: 'Reproducción',
            stats: 'Estadísticas',
            parental: 'Control Parental',
            about: 'Acerca de',
            // Sidebar menu items
            home: 'Inicio',
            liveTV: 'TV en Vivo',
            movies: 'Películas',
            series: 'Series',
            myList: 'Mi Lista',
            favorites: 'Favoritos',
            downloads: 'Descargas',
            settings: 'Configuración',
            // Profile
            switchProfile: 'Cambiar Perfil',
            manageProfiles: 'Gestionar Perfiles',
            switchingProfile: 'Cambiando perfil...',
            // PIN
            enterPin: 'Ingresa el PIN',
            profile: 'Perfil',
            incorrectPin: 'PIN incorrecto',
            cancel: 'Cancelar',
            enter: 'Entrar',
            // Logout
            logout: 'Salir'
        },
        // Login page
        login: {
            serverAddress: 'Dirección del servidor',
            username: 'Usuario',
            password: 'Contraseña',
            includeTV: 'Incluir canales de TV',
            includeVOD: 'Incluir VOD (Películas y Series)',
            back: 'Volver',
            loginButton: 'Iniciar sesión',
            authenticating: 'Autenticando...',
            continueButton: 'Continuar',
            playlistNameLabel: 'Ingresa el nombre de la playlist',
            playlistPlaceholder: 'Mi Playlist',
            library: 'Biblioteca',
            iptvLogin: 'Inicio IPTV',
            channels: 'Canales',
            moviesCount: 'Películas',
            seriesCount: 'Series',
            // Search placeholders
            searchMovies: 'Buscar películas...',
            searchSeries: 'Buscar series...',
            searchChannels: 'Buscar canales...',
            // Error messages
            connectionError: 'No se pudo conectar al servidor',
            connectionErrorDetails: 'Verifica: URL del servidor, servidor en línea, tu conexión',
            authError: 'Usuario o contraseña incorrectos',
            timeoutError: 'Tiempo agotado. El servidor tardó mucho en responder.',
            unexpectedError: 'Error inesperado. Verifica la configuración.',
            notAuthenticated: 'No autenticado. Inicia sesión de nuevo.',
            loadChannelsError: 'Error al cargar canales',
            loadMoviesError: 'Error al cargar películas',
            loadSeriesError: 'Error al cargar series',
            invalidUrl: 'URL inválida. Verifica la dirección del servidor.'
        },
        // Profile creation/management
        profile: {
            createNewProfile: 'Crear Nuevo Perfil',
            name: 'Nombre',
            enterName: 'Ingresa el nombre',
            avatar: 'Avatar',
            emoji: 'Emoji',
            image: 'Imagen',
            changeImage: 'Cambiar Imagen',
            protectWithPin: 'Proteger con PIN (4 dígitos)',
            pin: 'PIN',
            confirmPin: 'Confirmar PIN',
            cancel: 'Cancelar',
            createProfile: 'Crear Perfil',
            addProfile: 'Añadir Perfil',
            manageProfiles: 'Gestionar Perfiles',
            whoIsWatching: '¿Quién está viendo?',
            deleteProfile: 'Eliminar Perfil',
            confirmDelete: '¿Estás seguro de que deseas eliminar este perfil?',
            delete: 'Eliminar',
            // Error messages
            imageTooBig: '¡Imagen muy grande! Máximo 50KB.',
            nameRequired: 'El nombre es obligatorio',
            nameMaxLength: 'El nombre debe tener como máximo 20 caracteres',
            pinMustBe4Digits: 'El PIN debe tener exactamente 4 dígitos',
            pinsDoNotMatch: 'Los PINs no coinciden',
            profileCreationError: 'Error al crear perfil. ¿Límite de 5 perfiles alcanzado?',
            editProfile: 'Editar Perfil',
            save: 'Guardar',
            profileName: 'Nombre del perfil',
            protectedProfile: 'Perfil protegido',
            done: 'Listo',
            tryAgain: 'Inténtalo de nuevo',
            needOneProfile: '¡Necesitas al menos un perfil!',
            enterPin: 'Ingresa el PIN',
            active: 'Activo',
            edit: 'Editar',
            addPin: 'Añadir PIN',
            currentPin: 'PIN Actual',
            newPin: 'Nuevo PIN',
            enterCurrentPin: 'Ingresa tu PIN actual',
            enterNewPin: 'Ingresa el nuevo PIN de 4 dígitos',
            reenterNewPin: 'Ingresa el nuevo PIN otra vez',
            removePin: 'Eliminar PIN',
            continue: 'Continuar',
            enter: 'Entrar',
            cannotDeleteActive: '¡No se puede eliminar el perfil activo!',
            cannotDeleteLast: '¡No se puede eliminar el último perfil!',
            cannotDeleteKids: '¡El perfil Kids no puede ser eliminado!',
            confirmDeletion: 'Confirmar Eliminación',
            enterPinToDelete: 'Ingresa el PIN para eliminar',
            actionCannotBeUndone: 'Esta acción no se puede deshacer.',
            pinActive: 'PIN Activo',
            currentPinIncorrect: 'El PIN actual es incorrecto'
        },
        // Cast device selector
        cast: {
            title: 'Transmitir a TV',
            selectDevice: 'Selecciona un dispositivo',
            searchNetwork: 'Buscar en la red',
            searching: 'Buscando dispositivos...',
            noDevices: 'No se encontraron dispositivos',
            addManually: 'Añade tu TV manualmente o busca en la red',
            addTVManually: 'Añadir TV manualmente',
            tip: 'Consejo:',
            tipText: 'La TV debe estar encendida y conectada a la misma red Wi-Fi',
            back: 'Volver',
            addSmartTV: 'Añadir Smart TV',
            nameOptional: 'Nombre (opcional)',
            ipAddress: 'Dirección IP',
            port: 'Puerto',
            addTV: 'Añadir TV',
            howToFindIP: 'Cómo encontrar la IP:',
            howToFindIPText: 'TV → Ajustes → Red → Estado de la Red',
            enterIP: 'Ingresa la IP de tu Smart TV',
            failedToTransmit: 'Error al transmitir',
            errorAddingDevice: 'Error al añadir dispositivo',
            connected: 'Conectado',
            discovered: 'Descubierto'
        },
        // Category menu
        categories: {
            title: 'Categorías',
            exploreByGenre: 'Explorar por género',
            loadingCategories: 'Cargando categorías...',
            loadingChannels: 'Cargando canales',
            allMovies: 'Todas las Películas',
            allChannels: 'Todos los Canales',
            allSeries: 'Todas las Series',
            continueWatching: 'Continuar Viendo',
            completedSeries: 'Series Finalizadas',
            watchedMovies: 'Películas Vistas'
        },
        // Live TV
        liveTV: {
            scheduleTitle: 'Programación',
            live: 'EN VIVO',
            watchNow: 'Ver Ahora',
            close: 'Cerrar',
            nowPlaying: 'AHORA',
            upNext: 'A Continuación',
            noScheduleInfo: 'Sin información de programación'
        },
        // Content Modal (Movies/Series)
        contentModal: {
            // Watch buttons
            watchOffline: 'Ver Sin Conexión',
            continueWatching: 'Continuar Viendo',
            watchMovie: 'Ver Película',
            offlineSeason: 'Sin conexión T',
            watchSeason: 'Ver T',
            episode: 'E',
            // Watch Later
            saved: 'Guardado',
            watchLater: 'Ver Después',
            // Download
            downloaded: 'Descargado',
            download: 'Descargar',
            downloadTooltip: 'Descargar para ver sin conexión',
            // Trailer
            watchTrailer: 'Ver Tráiler',
            trailerTooltip: 'Ver tráiler',
            // Favorites
            removeFromFavorites: 'Quitar de Favoritos',
            addToFavorites: 'Añadir a Favoritos',
            // Content type badges
            movie: 'Película',
            series: 'Serie',
            seasons: 'Temporada',
            seasonsPlural: 'Temporadas',
            noDescription: 'Sin descripción disponible.',
            // Download Modal
            whatToDownload: '¿Qué deseas descargar?',
            season: 'Temporada',
            seasonComplete: 'Temporada {season} completa ({count} eps descargando)',
            downloadRemaining: 'Descargar {count} episodios restantes ({downloaded} en cola)',
            downloadSeason: 'Temporada {season} ({count} episodios)',
            episodeAlreadyDownloading: 'Episodio {episode} ya está descargando',
            onlyEpisode: 'Solo Episodio {episode}',
            cancel: 'Cancelar'
        },
        // Notifications
        notifications: {
            title: 'Notificaciones',
            tooltip: 'Notificaciones',
            new: 'nueva',
            newPlural: 'nuevas',
            newSeason: 'Nueva Temporada',
            newEpisodes: 'Nuevos Episodios',
            downloadComplete: 'Descarga Completa',
            downloadFailed: 'Descarga Fallida',
            downloadStarted: 'Descarga Iniciada',
            notification: 'Notificación',
            markAsRead: 'Marcar como leída',
            markAllAsRead: 'Marcar todas como leídas',
            clearAll: 'Limpiar todas',
            noNotifications: 'Sin notificaciones',
            newNotifications: 'Novedades aparecerán aquí',
            ago: 'atrás',
            now: 'ahora'
        },
        // Changelog / Post Update
        changelog: {
            updateInstalled: '¡Actualización Instalada!',
            whatsNew: 'Novedades en',
            gotIt: '¡Entendido, vamos!',
            // Version 2.9.0
            i18nTitle: 'Rediseño de Interfaz',
            i18nItems: 'Página Welcome rediseñada con animaciones|Página de Login premium con degradados|Panel de Configuración deslizante|Pantallas de error estilizadas para TV, Películas y Series',
            profilesTitle: 'Traducciones Mejoradas',
            profilesItems: 'Todos los mensajes de error traducidos|Traducción de URL inválida|Badge de login traducido',
            fixesTitle: 'Correcciones',
            fixesItems: 'Notificaciones eliminadas al marcar como leída|Errores de escape en cadenas corregidos'
        },
        // Welcome page
        welcome: {
            noChannels: 'Ninguna playlist configurada',
            addPlaylistHint: 'Añade una playlist de tu proveedor IPTV para empezar a ver',
            addPlaylist: 'Añadir Playlist',
            addPlaylistDesc: 'Conecta tu cuenta IPTV',
            settings: 'Configuración',
            settingsDesc: 'Personaliza la aplicación',
            disclaimer: 'NeoStream no proporciona contenido. Usa tu propia suscripción IPTV.'
        },
        settings: {
            title: 'Configuración',
            subtitle: 'Personaliza tu experiencia',
            saved: '✓ Guardado'
        },
        updates: {
            title: 'Actualizaciones Automáticas',
            description: 'Mantén tu aplicación siempre actualizada',
            checkFrequency: 'Verificar actualizaciones',
            checkFrequencyDesc: 'Define con qué frecuencia la app verifica nuevas versiones',
            onOpen: 'Al abrir la app',
            daily: 'Cada día',
            weekly: 'Cada semana',
            monthly: 'Cada mes',
            autoInstall: 'Instalar automáticamente',
            autoInstallDesc: 'Las actualizaciones se instalarán sin pedir confirmación',
            language: 'Idioma',
            languageDesc: 'Idioma de la interfaz',
            lastCheck: 'Última verificación',
            checkNow: 'Verificar Actualizaciones Ahora',
            checking: 'Verificando...'
        },
        playback: {
            title: 'Reproducción',
            description: 'Ajusta la reproducción de video y audio',
            bufferSize: 'Tamaño del Buffer',
            bufferSizeDesc: 'Tiempo de buffer antes de iniciar la reproducción',
            intelligent: '🧠 Inteligente (Adaptativo)',
            seconds: 'segundos',
            videoCodec: 'Codificador de Video',
            videoCodecDesc: 'Codec de video preferido',
            autoPlayNext: 'Reproducir siguiente episodio',
            autoPlayNextDesc: 'Reproducir automáticamente el siguiente episodio',
            skipIntro: 'Saltar intro automáticamente',
            skipIntroDesc: 'Saltar apertura de series cuando esté disponible',
            subtitleLanguage: 'Idioma de Subtítulos',
            subtitleLanguageDesc: 'Idioma preferido para descarga automática de subtítulos',
            forcedSubtitles: 'Subtítulos Forzados',
            forcedSubtitlesDesc: 'Cargar automáticamente subtítulos de carteles y diálogos extranjeros (no funciona en contenido [L] ya subtitulado)'
        },
        stats: {
            title: 'Tus Estadísticas',
            description: 'Sigue tu tiempo de visualización',
            thisMonth: 'este mes',
            currentStreak: 'racha actual',
            timeByType: 'Tiempo por Tipo',
            movies: 'Películas',
            series: 'Series',
            liveTV: 'TV en Vivo',
            last7Days: 'Últimos 7 Días',
            totalAccumulated: 'Total acumulado',
            longestStreak: 'Mayor racha',
            days: 'días'
        },
        parental: {
            title: 'Control Parental',
            description: 'Administra el acceso al contenido',
            enable: 'Activar Control Parental',
            enableDesc: 'Restringir acceso a contenido adulto',
            maxRating: 'Clasificación Máxima',
            maxRatingDesc: 'Límite de clasificación por edad',
            free: 'Libre',
            years: 'años',
            pin: 'PIN de Acceso',
            pinConfigured: 'PIN configurado ✓',
            pinDefine: 'Definir PIN para desbloquear contenido',
            changePin: 'Cambiar',
            setPin: 'Definir',
            blockAdult: 'Bloquear Categorías Adultas',
            blockAdultDesc: 'Ocultar automáticamente categorías adultas',
            filterTMDB: 'Filtrar por TMDB',
            filterTMDBDesc: 'Verificar clasificación en TMDB automáticamente',
            enterPin: 'Ingresa tu PIN',
            confirmPin: 'Confirma tu PIN',
            verifyPin: 'Ingresa el PIN para desactivar',
            pinError4Digits: 'Ingresa 4 dígitos',
            pinIncorrect: 'PIN incorrecto',
            pinMismatch: 'Los PINs no coinciden',
            confirm: 'Confirmar',
            cancel: 'Cancelar'
        },
        about: {
            title: 'Acerca de la Aplicación',
            description: 'Información y créditos',
            appDescription: 'Tu experiencia de streaming completa con TV en vivo, películas y series.',
            termsOfUse: 'Términos de Uso',
            privacyPolicy: 'Política de Privacidad',
            support: 'Soporte',
            version: 'Versión'
        },
        dashboard: {
            live: 'TV en Vivo',
            vod: 'Películas',
            series: 'Series',
            settings: 'Configuración',
            downloads: 'Descargas',
            favorites: 'Favoritos',
            watchLater: 'Ver Más Tarde'
        },
        common: {
            search: 'Buscar',
            loading: 'Cargando...',
            error: 'Error',
            retry: 'Intentar de nuevo',
            close: 'Cerrar',
            save: 'Guardar',
            yes: 'Sí',
            no: 'No',
            play: 'Ver',
            pause: 'Pausar',
            resume: 'Continuar',
            download: 'Descargar',
            delete: 'Eliminar',
            season: 'Temporada',
            episode: 'Episodio',
            minutes: 'min',
            hours: 'h'
        },
        player: {
            quality: 'Calidad',
            speed: 'Velocidad',
            version: 'Versión',
            subtitles: 'Subtítulos',
            audio: 'Audio',
            fullscreen: 'Pantalla completa',
            exitFullscreen: 'Salir de pantalla completa',
            nextEpisode: 'Siguiente episodio',
            previousEpisode: 'Episodio anterior'
        },
        home: {
            goodMorning: 'Buenos días',
            goodAfternoon: 'Buenas tardes',
            goodEvening: 'Buenas noches',
            continueWatching: 'Seguir Viendo',
            recommendations: 'Recomendados Para Ti',
            recentSeries: 'Series Recientes',
            recentMovies: 'Películas Recientes',
            series: 'SERIE',
            movie: 'PELÍCULA',
            newEpisode: '¡Nuevo Ep!',
            removeFromContinue: 'Eliminar de Seguir Viendo',
            notAvailableForProfile: 'no está disponible para este perfil',
            notSuitableForKids: 'no es adecuado para niños',
            minRemaining: 'min restantes',
            hRemaining: 'h restantes',
            channels: 'Canales',
            movies: 'Películas',
            seriesCount: 'Series',
            quickAccess: 'Acceso Rápido',
            liveTV: 'TV en Vivo',
            myList: 'Mi Lista',
            favorites: 'Favoritos',
            downloaded: 'Descargados',
            settings: 'Configuración',
            whatToWatch: '¿Qué quieres ver hoy?',
            locale: 'es-ES'
        },
        watchLater: {
            title: 'Mi Lista',
            emptyTitle: 'Tu lista está vacía',
            emptyText: 'Agrega películas y series para ver después haciendo clic en',
            emptyButton: '+ Mi Lista',
            itemsSaved: 'elementos guardados',
            itemSaved: 'elemento guardado',
            clearAll: 'Limpiar Todo',
            all: 'Todos',
            movies: 'Películas',
            series: 'Series',
            noMovies: 'Ninguna película guardada',
            noSeries: 'Ninguna serie guardada',
            removeFromList: 'Eliminar de la lista',
            movie: 'Película',
            serie: 'Serie',
            exploreMovies: 'Explorar Películas',
            exploreSeries: 'Explorar Series'
        },
        favoritesPage: {
            title: 'Favoritos',
            emptyTitle: 'Ningún favorito aún',
            emptyText: 'Agrega películas y series a favoritos haciendo clic en el',
            emptyButton: '❤️',
            itemCount: 'elementos',
            clearAll: 'Limpiar Favoritos',
            all: 'Todos',
            movies: 'Películas',
            series: 'Series',
            noMovies: 'Ninguna película favorita',
            noSeries: 'Ninguna serie favorita',
            removeFromFavorites: 'Eliminar de favoritos',
            movie: 'Película',
            serie: 'Serie',
            exploreMovies: 'Explorar Películas',
            exploreSeries: 'Explorar Series'
        },
        downloads: {
            title: 'Descargas',
            emptyTitle: 'Ninguna descarga aún',
            emptyText: 'Descarga películas y series para ver sin conexión',
            storageUsed: 'Usado',
            storageFree: 'Libre',
            openFolder: 'Abrir Carpeta',
            all: 'Todos',
            movies: 'Películas',
            series: 'Series',
            pending: 'Pendiente',
            downloading: 'Descargando',
            completed: 'Completado',
            downloaded: 'Descargado',
            paused: 'Pausado',
            failed: 'Fallido',
            noDownloads: 'Sin descargas',
            deleteConfirm: '¿Estás seguro de que deseas eliminar',
            deleteConfirmText: 'Este archivo se eliminará permanentemente.',
            cancel: 'Cancelar',
            delete: 'Eliminar',
            resume: 'Reanudar',
            resumeDownload: 'Reanudar Descarga',
            continueDownload: 'Continuar',
            waitingInQueue: 'Esperando en cola...',
            play: 'Reproducir',
            watchEpisode: 'Ver Episodio',
            episodeNotDownloaded: 'aún no descargado',
            removeDownload: 'Eliminar descarga',
            removeSeries: 'Eliminar serie',
            movie: 'Película',
            serie: 'Serie',
            episode: 'Episodio',
            season: 'Temporada',
            seasons: 'Temporadas',
            episodes: 'episodios',
            offline: 'Sin conexión',
            exploreMovies: 'Explorar Películas',
            exploreSeries: 'Explorar Series',
            availableOffline: '¡está disponible sin conexión!',
            failedTo: 'Error al descargar'
        }
    }
};

class LanguageService {
    private currentLanguage: SupportedLanguage;
    private listeners: Set<() => void> = new Set();

    constructor() {
        this.currentLanguage = this.loadLanguage();
    }

    private loadLanguage(): SupportedLanguage {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved && ['pt', 'en', 'es'].includes(saved)) {
                return saved as SupportedLanguage;
            }
        } catch (e) {
            console.warn('Failed to load language preference:', e);
        }
        // Default to Portuguese
        return 'pt';
    }

    getLanguage(): SupportedLanguage {
        return this.currentLanguage;
    }

    setLanguage(lang: SupportedLanguage): void {
        if (this.currentLanguage === lang) return;

        this.currentLanguage = lang;
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch (e) {
            console.warn('Failed to save language preference:', e);
        }

        // Notify all listeners
        this.listeners.forEach(listener => listener());
    }

    // Main translation function
    t(section: string, key: string): string {
        const langData = translations[this.currentLanguage];
        const sectionData = langData?.[section];
        const translation = sectionData?.[key];

        if (translation) return translation;

        // Fallback to Portuguese
        const fallback = translations.pt?.[section]?.[key];
        if (fallback) return fallback;

        // Return key if not found
        console.warn(`Missing translation: ${section}.${key}`);
        return key;
    }

    // Subscribe to language changes
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // Get available languages
    getAvailableLanguages(): LanguageOption[] {
        return AVAILABLE_LANGUAGES;
    }

    // Get current language info
    getCurrentLanguageInfo(): LanguageOption {
        return AVAILABLE_LANGUAGES.find(l => l.code === this.currentLanguage) || AVAILABLE_LANGUAGES[0];
    }
}

export const languageService = new LanguageService();

// React hook for using translations
export function useLanguage() {
    const [, forceUpdate] = useState({});

    useEffect(() => {
        const unsubscribe = languageService.subscribe(() => forceUpdate({}));
        return unsubscribe;
    }, []);

    return {
        language: languageService.getLanguage(),
        setLanguage: (lang: SupportedLanguage) => languageService.setLanguage(lang),
        t: (section: string, key: string) => languageService.t(section, key),
        languages: languageService.getAvailableLanguages(),
        currentLanguageInfo: languageService.getCurrentLanguageInfo()
    };
}

// Import for hook
import { useState, useEffect } from 'react';
