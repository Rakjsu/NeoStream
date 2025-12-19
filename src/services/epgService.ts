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
        // Try Xtream Codes API first
        const xcPrograms = await this.fetchFromXCAPI(epgChannelId);
        if (xcPrograms.length > 0) return xcPrograms;

        if (channelName) {
            // Try mi.tv second (more reliable for Brazilian channels)
            const mitvPrograms = await this.fetchFromMiTV(channelName);
            if (mitvPrograms.length > 0) return mitvPrograms;

            // Try meuguia.tv as fallback
            const meuguiaPrograms = await this.fetchFromMeuGuia(channelName);
            if (meuguiaPrograms.length > 0) return meuguiaPrograms;
        }

        return [];
    },

    // Generate mi.tv slug from channel name
    generateMiTVSlug(channelName: string): string {
        return channelName
            .toLowerCase()
            .replace(/\s*\[.*?\]\s*/g, '') // Remove [HD], [FHD], etc.
            .replace(/\s*\(.*?\)\s*/g, '') // Remove (anything)
            .replace(/\s+hd$/i, '') // Remove trailing HD
            .replace(/\s+fhd$/i, '') // Remove trailing FHD
            .replace(/\s+4k$/i, '') // Remove trailing 4K
            .replace(/\s+sd$/i, '') // Remove trailing SD
            .trim()
            .replace(/[áàâã]/g, 'a')
            .replace(/[éèê]/g, 'e')
            .replace(/[íìî]/g, 'i')
            .replace(/[óòôõ]/g, 'o')
            .replace(/[úùû]/g, 'u')
            .replace(/ç/g, 'c')
            .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
            .replace(/\s+/g, '-') // Spaces to hyphens
            .replace(/-+/g, '-') // Multiple hyphens to single
            .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
    },

    async fetchFromMiTV(channelName: string): Promise<EPGProgram[]> {
        try {
            const slug = this.generateMiTVSlug(channelName);
            if (!slug) return [];

            console.log('[EPG] Trying mi.tv with slug:', slug);
            const result = await window.ipcRenderer.invoke('epg:fetch-mitv', slug);

            if (!result.success || !result.html) {
                // Try with -hd suffix if first attempt fails
                const hdSlug = slug + '-hd';
                console.log('[EPG] Trying mi.tv with HD slug:', hdSlug);
                const hdResult = await window.ipcRenderer.invoke('epg:fetch-mitv', hdSlug);
                if (!hdResult.success || !hdResult.html) return [];
                return this.parseMiTVHTML(hdResult.html, channelName);
            }

            return this.parseMiTVHTML(result.html, channelName);
        } catch (error) {
            console.error('[EPG] mi.tv error:', error);
            return [];
        }
    },

    parseMiTVHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // mi.tv actual structure (discovered via browser):
        // <a class="program-link">
        //   <span><font><font>HH:MM</font></font></span>
        //   <h2><img...><font><font>Title</font></font></h2>
        // </a>

        const today = new Date();
        let lastHour = -1;
        let dayOffset = 0;

        // Pattern 1: Look for program-link anchors with time in span and title in h2
        // The time is in format: <span...><font><font>HH:MM</font></font></span>
        // The title is in format: <h2...><font><font>Title</font></font></h2>
        const programPattern = /<a[^>]*class="[^"]*program-link[^"]*"[^>]*>[\s\S]*?<span[^>]*>[\s\S]*?(\d{1,2}:\d{2})[\s\S]*?<\/span>[\s\S]*?<h2[^>]*>[\s\S]*?<font[^>]*>\s*<font[^>]*>([^<]+)<\/font>/gi;

        let match;
        while ((match = programPattern.exec(html)) !== null) {
            const time = match[1];
            let title = match[2].trim()
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/&#\d+;/g, '')
                .replace(/\s+/g, ' ');

            if (title.length < 2) continue;

            const [hours, minutes] = time.split(':').map(Number);
            if (hours > 23 || minutes > 59) continue;

            // Handle day rollover
            if (lastHour !== -1 && hours < lastHour - 2) dayOffset++;
            lastHour = hours;

            const startDate = new Date(today);
            startDate.setDate(startDate.getDate() + dayOffset);
            startDate.setHours(hours, minutes, 0, 0);

            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);

            programs.push({
                id: `mitv-${startDate.getTime()}`,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                title: title,
                description: '',
                channel_id: channelId
            });
        }

        // If pattern 1 didn't work, try pattern 2: simpler extraction
        if (programs.length === 0) {
            // Simpler pattern: look for any time followed by text within reasonable distance
            const simplePattern = />(\d{1,2}:\d{2})<[\s\S]{0,200}?<font[^>]*>\s*<font[^>]*>([^<]{3,80})<\/font>/gi;
            let dayOffset2 = 0;
            let lastHour2 = -1;

            while ((match = simplePattern.exec(html)) !== null) {
                const time = match[1];
                let title = match[2].trim();

                // Skip if looks like navigation/UI text
                if (/^(hoje|amanhã|ontem|ver|mais|fechar|programação|canal)/i.test(title)) continue;
                if (title.length < 3 || title.length > 100) continue;

                const [hours, minutes] = time.split(':').map(Number);
                if (hours > 23 || minutes > 59) continue;

                if (lastHour2 !== -1 && hours < lastHour2 - 2) dayOffset2++;
                lastHour2 = hours;

                const startDate = new Date(today);
                startDate.setDate(startDate.getDate() + dayOffset2);
                startDate.setHours(hours, minutes, 0, 0);

                const endDate = new Date(startDate);
                endDate.setHours(endDate.getHours() + 1);

                programs.push({
                    id: `mitv-${startDate.getTime()}`,
                    start: startDate.toISOString(),
                    end: endDate.toISOString(),
                    title: title,
                    description: '',
                    channel_id: channelId
                });
            }
        }

        console.log('[EPG] mi.tv parsed', programs.length, 'programs');

        // Fix end times based on next program start
        for (let i = 0; i < programs.length - 1; i++) {
            programs[i].end = programs[i + 1].start;
        }

        return programs;
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

    getUpcomingPrograms(programs: EPGProgram[], currentProgram: EPGProgram | null, count: number = 3): EPGProgram[] {
        if (!currentProgram) return programs.slice(0, count);

        const currentEnd = new Date(currentProgram.end).getTime();
        const currentId = currentProgram.id;

        return programs
            .filter(p => p.id !== currentId && new Date(p.start).getTime() >= currentEnd)
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
