interface EPGProgram {
    id: string;
    start: string;
    end: string;
    title: string;
    description?: string;
    channel_id: string;
}

const channelMappings: Record<string, string> = {
    // HBO channels
    'hbo': 'HBO',
    'hbo max': 'HBO',
    'hbo 2': 'HB2',
    'hbo2': 'HB2',
    'hbo plus': 'HPL',
    'hbo family': 'HFA',
    'hbo signature': 'HFE',
    'hbo mundi': 'HMU',
    'hbo xtreme': 'HXT',

    // Telecine channels
    'telecine premium': 'TC1',
    'telecine action': 'TC2',
    'telecine touch': 'TC3',
    'telecine pipoca': 'TC4',
    'telecine cult': 'TC5',
    'telecine fun': 'TC6',

    // Movie channels
    'amc': 'MGM',
    'canal brasil': 'CBR',
    'cinemax': 'MNX',
    'megapix': 'MPX',
    'paramount channel': 'PAR',
    'paramount': 'PAR',
    'space': 'SPA',
    'tcm': 'TCM',
    'turner classic movies': 'TCM',
    'tnt': 'TNT',
    'tnt series': 'SER',

    // Other channels
    'axn': 'AXN',
    'espn': 'ESPN',
    'fx': 'FXC',
    'gnt': 'GNT',
    'mtv': 'MTV',
    'multishow': 'MSH',
    'universal': 'USA',
    'universal tv': 'USA',
    'vh1': 'VH1',
    'viva': 'VIV',
    'warner': 'WBR',
    'warner channel': 'WBR',
    'sony': 'SET',
    'discovery': 'DSC',
    'history': 'HIS',
    'arte1': 'ART',
    'curta!': 'CUR',
    'a&e': 'AEH',
};

export const epgService = {
    async fetchChannelEPG(epgChannelId: string, channelName?: string): Promise<EPGProgram[]> {
        const xcPrograms = await this.fetchFromXCAPI(epgChannelId);
        if (xcPrograms.length > 0) return xcPrograms;

        if (channelName) {
            const meuguiaPrograms = await this.fetchFromMeuGuia(channelName);
            if (meuguiaPrograms.length > 0) return meuguiaPrograms;
        }

        return [];
    },

    async fetchFromXCAPI(epgChannelId: string): Promise<EPGProgram[]> {
        try {
            const credentials = await window.ipcRenderer.invoke('auth:get-credentials');
            if (!credentials) return [];

            const url = `${credentials.serverUrl}/player_api.php?username=${credentials.username}&password=${credentials.password}&action=get_short_epg&stream_id=${epgChannelId}&limit=10`;

            const response = await fetch(url);
            const text = await response.text();
            if (!text || text.startsWith('<!') || text.startsWith('<')) return [];

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

    async fetchFromMeuGuia(channelName: string): Promise<EPGProgram[]> {
        try {
            const normalized = channelName.toLowerCase().trim()
                .replace(/\s+/g, ' ')
                .replace(/\[.*?\]/g, '')
                .replace(/\(.*?\)/g, '')
                .replace(/hd$/i, '')
                .replace(/fhd$/i, '')
                .replace(/4k$/i, '')
                .trim();

            const sortedMappings = Object.entries(channelMappings)
                .sort((a, b) => b[0].length - a[0].length);

            let slug = '';
            for (const [key, value] of sortedMappings) {
                if (normalized.includes(key)) {
                    slug = value;
                    break;
                }
            }

            if (!slug) return [];

            const result = await window.ipcRenderer.invoke('epg:fetch-meuguia', slug);
            if (!result.success || !result.html) return [];

            return this.parseMeuGuiaHTML(result.html, channelName);
        } catch {
            return [];
        }
    },

    parseMeuGuiaHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // meuguia.tv format:
        // <div class='lileft time'>19:15</div>
        // <div class="licontent"><h2>Title</h2>
        const pattern = /class=['"][^'"]*time[^'"]*['"][^>]*>(\d{1,2}:\d{2})<\/div>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;

        const today = new Date();
        let match;
        let lastHour = -1;
        let dayOffset = 0;

        while ((match = pattern.exec(html)) !== null) {
            const time = match[1];
            let title = match[2].trim()
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ');

            if (title.length < 3) continue;

            const [hours, minutes] = time.split(':').map(Number);

            if (lastHour !== -1 && hours < lastHour - 2) dayOffset++;
            lastHour = hours;

            const startDate = new Date(today);
            startDate.setDate(startDate.getDate() + dayOffset);
            startDate.setHours(hours, minutes, 0, 0);

            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);

            programs.push({
                id: `meuguia-${startDate.getTime()}`,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                title: title,
                description: '',
                channel_id: channelId
            });
        }

        console.log('[EPG Parser] Found programs:', programs.length);

        // Fix end times
        for (let i = 0; i < programs.length - 1; i++) {
            programs[i].end = programs[i + 1].start;
        }

        return programs;
    },

    getCurrentProgram(programs: EPGProgram[]): EPGProgram | null {
        if (programs.length === 0) return null;

        const now = new Date().getTime();
        const current = programs.find(p => {
            const start = new Date(p.start).getTime();
            const end = new Date(p.end).getTime();
            return now >= start && now <= end;
        });

        // If no current program found (timezone mismatch), use first program
        return current || programs[0];
    },

    getUpcomingPrograms(programs: EPGProgram[], count: number = 3): EPGProgram[] {
        const now = new Date().getTime();
        return programs
            .filter(p => new Date(p.start).getTime() > now)
            .slice(0, count);
    },

    getProgramProgress(program: EPGProgram): number {
        const now = new Date().getTime();
        const start = new Date(program.start).getTime();
        const end = new Date(program.end).getTime();
        const duration = end - start;
        const elapsed = now - start;
        return Math.min(100, Math.max(0, (elapsed / duration) * 100));
    },

    formatTime(timestamp: string): string {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
};
