interface EPGProgram {
    id: string;
    start: string; // ISO timestamp
    end: string; // ISO timestamp
    title: string;
    description?: string;
    channel_id: string;
}

// Channel name mappings for meuguia.tv
// Only includes channels that work on meuguia.tv API
const channelMappings: Record<string, string> = {
    // HBO channels (confirmed working)
    'hbo': 'HBO',
    'hbo max': 'HBO',
    'hbo 2': 'HBO 2',
    'hbo plus': 'HBO Plus',
    'hbo family': 'HBO Family',
    'hbo signature': 'HBO Signature',
    // Others confirmed working
    'amc': 'AMC',
    'axn': 'AXN',
    'cinemax': 'Cinemax',
    'espn': 'ESPN',
    'fx': 'FX',
    'gnt': 'GNT',
    'megapix': 'Megapix',
    'mtv': 'MTV',
    'multishow': 'Multishow',
    'space': 'SPACE',
    'tnt': 'TNT',
    'universal': 'Universal TV',
    'vh1': 'VH1',
    'viva': 'Viva',
    // Note: Telecine, Globo, SBT, etc. don't work with direct URLs
    // They would need scraping from category pages
};

export const epgService = {
    // Fetch EPG data - try XC API first (reliable), then meuguia.tv (fallback for some channels)
    async fetchChannelEPG(epgChannelId: string, channelName?: string): Promise<EPGProgram[]> {
        // Try XC API first (IPTV provider)
        const xcPrograms = await this.fetchFromXCAPI(epgChannelId);
        if (xcPrograms.length > 0) return xcPrograms;

        // Fallback to meuguia.tv for Brazilian channels
        if (channelName) {
            const meuguiaPrograms = await this.fetchFromMeuGuia(channelName);
            if (meuguiaPrograms.length > 0) return meuguiaPrograms;
        }

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
                .replace(/\[.*?\]/g, '') // Remove [HD], [FHD], etc.
                .replace(/\(.*?\)/g, '') // Remove (H265), etc.
                .replace(/hd$/i, '')
                .replace(/fhd$/i, '')
                .replace(/4k$/i, '')
                .trim();

            // Sort mappings by key length (descending) to match longer keys first
            const sortedMappings = Object.entries(channelMappings)
                .sort((a, b) => b[0].length - a[0].length);

            // Find best match
            let slug = '';
            for (const [key, value] of sortedMappings) {
                if (normalized.includes(key)) {
                    slug = value;
                    break;
                }
            }

            if (!slug) return [];

            // Fetch via IPC (bypasses CORS)
            const result = await window.ipcRenderer.invoke('epg:fetch-meuguia', slug);
            if (!result.success || !result.html) return [];

            // Parse the HTML to extract programs
            return this.parseMeuGuiaHTML(result.html, channelName);
        } catch {
            return [];
        }
    },

    // Parse meuguia.tv HTML
    parseMeuGuiaHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

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
