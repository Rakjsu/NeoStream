interface EPGProgram {
    id: string;
    start: string; // ISO timestamp
    end: string; // ISO timestamp
    title: string;
    description?: string;
    channel_id: string;
}

// Channel name mappings for meuguia.tv
const channelMappings: Record<string, string> = {
    // Common variations -> meuguia.tv URL slug
    'globo': 'TV-Globo',
    'tv globo': 'TV-Globo',
    'globo sp': 'TV-Globo',
    'globo rj': 'TV-Globo',
    'sbt': 'SBT',
    'record': 'Record-TV',
    'band': 'Band',
    'bandeirantes': 'Band',
    'redetv': 'RedeTV',
    'rede tv': 'RedeTV',
    'hbo': 'HBO',
    'hbo max': 'HBO',
    'hbo 2': 'HBO-2',
    'hbo plus': 'HBO-Plus',
    'hbo family': 'HBO-Family',
    'hbo signature': 'HBO-Signature',
    'telecine': 'Telecine-Premium',
    'telecine premium': 'Telecine-Premium',
    'telecine action': 'Telecine-Action',
    'telecine pipoca': 'Telecine-Pipoca',
    'telecine fun': 'Telecine-Fun',
    'telecine touch': 'Telecine-Touch',
    'telecine cult': 'Telecine-Cult',
    'globonews': 'GloboNews',
    'globo news': 'GloboNews',
    'sportv': 'SporTV',
    'sportv 2': 'SporTV-2',
    'sportv 3': 'SporTV-3',
    'espn': 'ESPN',
    'espn 2': 'ESPN-2',
    'espn 3': 'ESPN-3',
    'espn 4': 'ESPN-4',
    'fox sports': 'Fox-Sports',
    'fox sports 2': 'Fox-Sports-2',
    'discovery': 'Discovery-Channel',
    'discovery channel': 'Discovery-Channel',
    'discovery kids': 'Discovery-Kids',
    'animal planet': 'Animal-Planet',
    'history': 'History-Channel',
    'history channel': 'History-Channel',
    'nat geo': 'National-Geographic',
    'national geographic': 'National-Geographic',
    'natgeo': 'National-Geographic',
    'cartoon': 'Cartoon-Network',
    'cartoon network': 'Cartoon-Network',
    'disney': 'Disney-Channel',
    'disney channel': 'Disney-Channel',
    'disney xd': 'Disney-XD',
    'disney junior': 'Disney-Junior',
    'nick': 'Nickelodeon',
    'nickelodeon': 'Nickelodeon',
    'nick jr': 'Nick-Jr',
    'multishow': 'Multishow',
    'gnt': 'GNT',
    'viva': 'Viva',
    'canal brasil': 'Canal-Brasil',
    'arte1': 'Arte-1',
    'bis': 'BIS',
    'cnn': 'CNN-Brasil',
    'cnn brasil': 'CNN-Brasil',
    'band news': 'BandNews-TV',
    'record news': 'Record-News',
    'warner': 'Warner-Channel',
    'warner channel': 'Warner-Channel',
    'tnt': 'TNT',
    'tnt series': 'TNT-Series',
    'space': 'Space',
    'i.sat': 'I.Sat',
    'axn': 'AXN',
    'sony': 'Sony-Channel',
    'sony channel': 'Sony-Channel',
    'fox': 'Fox-Channel',
    'fx': 'FX',
    'paramount': 'Paramount-Channel',
    'paramount channel': 'Paramount-Channel',
    'universal': 'Universal-TV',
    'universal tv': 'Universal-TV',
    'comedy central': 'Comedy-Central',
    'mtv': 'MTV',
    'vh1': 'VH1',
    'a&e': 'AeE',
    'lifetime': 'Lifetime',
    'tlc': 'TLC',
    'home & health': 'Home-e-Health',
    'food network': 'Food-Network',
    'travel': 'Travel-Box-Brazil',
    'megapix': 'Megapix',
    'max': 'Max-Prime',
    'max prime': 'Max-Prime',
    'premiere': 'Premiere-FC',
    'combate': 'Combate',
    'woohoo': 'Woohoo',
    'gloob': 'Gloob',
    'gloobinho': 'Gloobinho',
    'off': 'OFF',
    'canal off': 'OFF',
    'boomerang': 'Boomerang',
    'cidade alerta': 'Record-TV',
    'cinemax': 'Cinemax',
    'mgm': 'MGM'
};

export const epgService = {
    // Fetch EPG data - try meuguia.tv first (primary), then XC API (fallback)
    async fetchChannelEPG(epgChannelId: string, channelName?: string): Promise<EPGProgram[]> {
        // Try meuguia.tv first (primary source for Brazilian channels)
        if (channelName) {
            const meuguiaPrograms = await this.fetchFromMeuGuia(channelName);
            if (meuguiaPrograms.length > 0) return meuguiaPrograms;
        }

        // Fallback to XC API (IPTV provider)
        const xcPrograms = await this.fetchFromXCAPI(epgChannelId);
        if (xcPrograms.length > 0) return xcPrograms;

        return [];
    },

    // Fetch from XC API
    async fetchFromXCAPI(epgChannelId: string): Promise<EPGProgram[]> {
        try {
            const credentials = await window.ipcRenderer.invoke('auth:get-credentials');
            if (!credentials) return [];

            const url = `${credentials.serverUrl}/player_api.php?username=${credentials.username}&password=${credentials.password}&action=get_short_epg&stream_id=${epgChannelId}&limit=10`;

            const response = await fetch(url);
            const text = await response.text();
            if (!text || text.startsWith('<!') || text.startsWith('<')) {
                return [];
            }

            const data = JSON.parse(text);
            const listings = data.epg_listings || data.listings || data;
            if (!Array.isArray(listings)) return [];

            return listings.map((item: any) => ({
                id: item.id || `${item.start}-${item.title}`,
                start: item.start || item.start_timestamp,
                end: item.stop || item.end || item.stop_timestamp,
                title: item.title ? atob(item.title) : (item.name || 'Sem título'),
                description: item.description ? atob(item.description) : '',
                channel_id: epgChannelId
            }));
        } catch {
            return [];
        }
    },

    // Fetch from meuguia.tv (via IPC to bypass CORS)
    async fetchFromMeuGuia(channelName: string): Promise<EPGProgram[]> {
        try {
            // Normalize channel name and find mapping
            const normalized = channelName.toLowerCase().trim()
                .replace(/\s+/g, ' ')
                .replace(/hd$/i, '')
                .replace(/fhd$/i, '')
                .replace(/4k$/i, '')
                .trim();

            // Find best match
            let slug = '';
            for (const [key, value] of Object.entries(channelMappings)) {
                if (normalized.includes(key) || key.includes(normalized)) {
                    slug = value;
                    break;
                }
            }

            console.log('[EPG] Channel:', channelName, '-> Normalized:', normalized, '-> Slug:', slug);

            if (!slug) {
                console.log('[EPG] No mapping found for channel');
                return [];
            }

            // Fetch via IPC (bypasses CORS)
            console.log('[EPG] Fetching from meuguia.tv:', slug);
            const result = await window.ipcRenderer.invoke('epg:fetch-meuguia', slug);

            if (!result.success) {
                console.log('[EPG] IPC failed:', result.error);
                return [];
            }

            console.log('[EPG] HTML received, length:', result.html?.length || 0);
            if (!result.html) return [];

            // Parse the HTML to extract programs
            const programs = this.parseMeuGuiaHTML(result.html, channelName);
            console.log('[EPG] Parsed programs:', programs.length);

            return programs;
        } catch (e) {
            console.error('[EPG] Error:', e);
            return [];
        }
    },

    // Parse meuguia.tv HTML
    parseMeuGuiaHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // Log a sample of HTML for debugging
        console.log('[EPG] HTML sample:', html.substring(0, 500));

        // meuguia.tv structure: time is in format HH:MM followed by program title
        // Try to extract programs using various patterns
        const patterns = [
            // Pattern: time followed by title on next lines
            /(\d{1,2}:\d{2})\s*\n\s*\n\s*([^\n<]+)/g,
            // Pattern: href with time and title
            /\[(\d{1,2}:\d{2})\s*\n\s*([^\n\]]+)/g,
            // Pattern: just time:title
            /(\d{1,2}:\d{2})\s+([A-Za-zÀ-ú][^\n<]{2,50})/g,
        ];

        const today = new Date();
        // Get Brazil timezone offset (UTC-3)
        const brazilOffset = -3;

        for (const pattern of patterns) {
            let match;
            let lastHour = -1;
            let dayOffset = 0;

            while ((match = pattern.exec(html)) !== null) {
                const time = match[1];
                let title = match[2].trim();

                // Clean up title - remove extra whitespace and HTML entities
                title = title
                    .replace(/&amp;/g, '&')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                // Skip if title is too short or looks like HTML
                if (title.length < 3 || title.startsWith('<') || title.includes('class=')) continue;

                const [hours, minutes] = time.split(':').map(Number);

                // Detect day change (if hour goes backwards significantly)
                if (lastHour !== -1 && hours < lastHour - 2) {
                    dayOffset++;
                }
                lastHour = hours;

                const startDate = new Date(today);
                startDate.setDate(startDate.getDate() + dayOffset);
                startDate.setHours(hours, minutes, 0, 0);

                // Estimate end time as 1 hour default
                const endDate = new Date(startDate);
                endDate.setHours(endDate.getHours() + 1);

                // Check for duplicates
                const exists = programs.some(p =>
                    p.title === title && new Date(p.start).getTime() === startDate.getTime()
                );

                if (!exists) {
                    programs.push({
                        id: `meuguia-${startDate.getTime()}-${title.substring(0, 10)}`,
                        start: startDate.toISOString(),
                        end: endDate.toISOString(),
                        title: title,
                        description: '',
                        channel_id: channelId
                    });
                }
            }

            // If we found programs with this pattern, stop trying others
            if (programs.length > 0) break;
        }

        // Sort programs by start time
        programs.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

        // Fix end times based on next program start
        for (let i = 0; i < programs.length - 1; i++) {
            programs[i].end = programs[i + 1].start;
        }

        return programs;
    },

    // Get current program (based on current time)
    getCurrentProgram(programs: EPGProgram[]): EPGProgram | null {
        const now = new Date().getTime();
        return programs.find(p => {
            const start = new Date(p.start).getTime();
            const end = new Date(p.end).getTime();
            return now >= start && now <= end;
        }) || null;
    },

    // Get upcoming programs (next 3-5)
    getUpcomingPrograms(programs: EPGProgram[], count: number = 3): EPGProgram[] {
        const now = new Date().getTime();
        return programs
            .filter(p => new Date(p.start).getTime() > now)
            .slice(0, count);
    },

    // Calculate program progress (0-100)
    getProgramProgress(program: EPGProgram): number {
        const now = new Date().getTime();
        const start = new Date(program.start).getTime();
        const end = new Date(program.end).getTime();
        const duration = end - start;
        const elapsed = now - start;
        return Math.min(100, Math.max(0, (elapsed / duration) * 100));
    },

    // Format time for display (HH:MM)
    formatTime(timestamp: string): string {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
};
