// EPG Service - Simple and Clean
// Uses times from mi.tv/meuguia.tv exactly as displayed (no timezone conversion)

interface EPGProgram {
    id: string;
    start: string;
    end: string;
    title: string;
    description?: string;
    channel_id: string;
}

// Manual channel mappings for mi.tv
const mitvMappings: Record<string, string> = {
    // HBO channels
    'hbo': 'hbo',
    'hbo 2': 'hbo-2',
    'hbo2': 'hbo-2',
    'hbo family': 'hbo-family-hd',
    'hbo mundi': 'max-1',
    'hbo plus': 'hbo-plus-brasil-hd',
    'hbo pop': 'max-up',
    'hbo xtreme': 'max-prime',
    'hbo signature': 'hbo-signature',
    // Globo
    'globo': 'rede-globo',
    'rede globo': 'rede-globo',
    'globo sp': 'globo-sao-paulo-hd',
    'globo rj': 'globo-rio-de-janeiro-hd',
    // SBT
    'sbt sp': 'sbt-s-o-paulo',
    // Record
    'record sp': 'recordtv-s-o-paulo-hd',
    // TV Gazeta
    'tv gazeta': 'tv-gazeta-hd',
    'gazeta': 'tv-gazeta-hd',
    // TNT
    'tnt series': 'tnt-series-hd',
    // Discovery channels
    'discovery': 'discovery',
    'discovery channel': 'discovery',
    'disc turbo': 'discovery-turbo',
    'discovery turbo': 'discovery-turbo',
    'disc home & health': 'discovery-home-health',
    'discovery home & health': 'discovery-home-health',
    'discovery home and health': 'discovery-home-health',
    // Cartoon Network
    'cartoon network': 'cartoon',
    'cartoon': 'cartoon',
    // Play TV
    'play tv': 'play-tv',
    'playtv': 'play-tv',
    // Lifetime
    'lifetime': 'lifetime-brazil',
    // Fish TV
    'fish tv': 'fishtv',
    'fishtv': 'fishtv',
    // Cinebrasil TV
    'cinebrasil tv': 'cinebrasil-tv',
    'cinebrasil': 'cinebrasil-tv',
    // Chef TV
    'chef tv': 'chef-tv',
    // Arte1
    'arte1': 'arte-1',
    'arte 1': 'arte-1',
    // RIT
    'rit': 'rit',
    'rit tv': 'rit',
    // Canção Nova
    'cancao nova': 'canc-o-nova',
    'canção nova': 'canc-o-nova',
    // Boa Vontade TV
    'boa vontade tv': 'boa-vontade-tv',
    'boa vontade': 'boa-vontade-tv',
    // Rede CNT
    'cnt': 'cnt',
    'rede cnt': 'cnt',
    // Woohoo
    'woohoo': 'woohoo',
    'canal woohoo': 'woohoo',
    // Music Box Brasil
    'music box brasil': 'music-box-brasil',
    'musicbox brasil': 'music-box-brasil',
    // Agro Mais
    'agro mais': 'agromais-hd',
    'agromais': 'agromais-hd',
    // Record News
    'record news': 'record-news-hd',
    // Cartoonito (maps to Boomerang on mi.tv)
    'cartoonito': 'boomerang',
    // TV Ra-Tim-Bum
    'tv ra-tim-bum': 'tv-ra-tim-bum-hd',
    'ra-tim-bum': 'tv-ra-tim-bum-hd',
    'ratimbum': 'tv-ra-tim-bum-hd',
    // History 2
    'history 2': 'h2',
    'h2': 'h2',
    // Discovery channels
    'discovery h&h': 'discovery-home-health',
    'discovery theater': 'discovery-theater-hd',
    'discovery theatre': 'discovery-theater-hd',
    'discovery world': 'discovery-world-hd',
};

// Manual channel mappings for meuguia.tv (fallback)
const meuguiaMappings: Record<string, string> = {
    'hbo signature': 'HFE',
    'combate': '135',
    'espn 5': 'ES5',
    'espn5': 'ES5',
};

export const epgService = {

    // Main function to fetch EPG for a channel
    async fetchChannelEPG(epgChannelId: string, channelName?: string): Promise<EPGProgram[]> {
        if (!channelName) return [];

        // Try mi.tv first
        const mitvPrograms = await this.fetchFromMiTV(channelName);
        if (mitvPrograms.length > 0) return mitvPrograms;

        // Try meuguia.tv as fallback
        const meuguiaPrograms = await this.fetchFromMeuGuia(channelName);
        if (meuguiaPrograms.length > 0) return meuguiaPrograms;

        return [];
    },

    // Fetch from mi.tv
    async fetchFromMiTV(channelName: string): Promise<EPGProgram[]> {
        try {
            const slug = this.getMiTVSlug(channelName);
            console.log('[EPG] Fetching mi.tv:', slug);

            // Use -300 timezone offset for Brazil (UTC-3 = -180 minutes, but site uses -300)
            const url = `https://mi.tv/br/async/channel/${slug}/-300`;
            const response = await fetch(url);

            if (!response.ok) return [];

            const html = await response.text();
            return this.parseHTML(html, channelName);
        } catch (error) {
            console.error('[EPG] mi.tv error:', error);
            return [];
        }
    },

    // Fetch from meuguia.tv
    async fetchFromMeuGuia(channelName: string): Promise<EPGProgram[]> {
        try {
            const slug = this.getMeuGuiaSlug(channelName);
            if (!slug) return [];

            console.log('[EPG] Fetching meuguia.tv:', slug);

            const url = `https://meuguia.tv/programacao/canal/${slug}`;
            const response = await fetch(url);

            if (!response.ok) return [];

            const html = await response.text();
            return this.parseMeuGuiaHTML(html, channelName);
        } catch (error) {
            console.error('[EPG] meuguia.tv error:', error);
            return [];
        }
    },

    // Get mi.tv slug from channel name
    getMiTVSlug(channelName: string): string {
        // Remove quality/codec suffixes from channel name
        const normalized = channelName
            .toLowerCase()
            .trim()
            // Remove codec info: (H265), (H264), (HEVC), etc.
            .replace(/\s*\(?(h\.?265|h\.?264|hevc|avc)\)?/gi, '')
            // Remove quality: [FHD], [HD], [SD], [4K], [UHD], [M] or FHD, HD, SD, 4K, UHD
            .replace(/\s*\[?(fhd|hd|sd|4k|uhd|m)\]?\s*$/i, '')
            .trim();

        console.log('[EPG] Channel normalized:', channelName, '->', normalized);

        // Check manual mappings first
        if (mitvMappings[normalized]) {
            return mitvMappings[normalized];
        }

        // Auto-generate slug
        return normalized
            .replace(/[àáâãäå]/g, 'a')
            .replace(/[èéêë]/g, 'e')
            .replace(/[ìíîï]/g, 'i')
            .replace(/[òóôõö]/g, 'o')
            .replace(/[ùúûü]/g, 'u')
            .replace(/[ç]/g, 'c')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    },

    // Get meuguia.tv slug from channel name
    getMeuGuiaSlug(channelName: string): string | null {
        // Remove quality/codec suffixes
        const normalized = channelName
            .toLowerCase()
            .trim()
            .replace(/\s*\(?(h\.?265|h\.?264|hevc|avc)\)?/gi, '')
            .replace(/\s*\[?(fhd|hd|sd|4k|uhd|m)\]?\s*$/i, '')
            .trim();
        return meuguiaMappings[normalized] || null;
    },

    // Parse mi.tv HTML - SIMPLE: use times exactly as shown
    parseHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // Simple pattern to match time and title only
        const pattern = /<span[^>]*class="[^"]*time[^"]*"[^>]*>[\s\S]*?(\d{1,2}:\d{2})[\s\S]*?<\/span>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi;

        const today = new Date();
        let lastHour = -1;
        let dayOffset = 0;

        let match;
        while ((match = pattern.exec(html)) !== null) {
            const time = match[1];
            let title = match[2]
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/&#\d+;/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            // Search for episode info in the chunk after this match
            const matchEnd = match.index + match[0].length;
            const nextChunk = html.substring(matchEnd, matchEnd + 500);
            const episodeMatch = nextChunk.match(/Temporada\s+\d+\s+Epis[oó]dio\s+\d+[^<\n]*/i);

            if (episodeMatch) {
                title = `${title} - ${episodeMatch[0].trim()}`;
            }

            if (title.length < 2 || title.length > 200) continue;

            const [hours, minutes] = time.split(':').map(Number);
            if (hours > 23 || minutes > 59) continue;

            // Handle day rollover (when hours go from 23 to 0)
            if (lastHour !== -1 && hours < lastHour - 2) dayOffset++;
            lastHour = hours;

            // Create date using LOCAL time (whatever the site shows)
            const startDate = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() + dayOffset,
                hours,
                minutes,
                0,
                0
            );

            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);

            programs.push({
                id: `epg-${startDate.getTime()}`,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                title: title,
                description: '',
                channel_id: channelId
            });
        }

        // Fix end times (use next program's start time)
        for (let i = 0; i < programs.length - 1; i++) {
            programs[i].end = programs[i + 1].start;
        }

        console.log('[EPG] Parsed', programs.length, 'programs');
        return programs;
    },

    // Parse meuguia.tv HTML
    parseMeuGuiaHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        const pattern = /class=['"][^'"]*time[^'"]*['"][^>]*>(\d{1,2}:\d{2})<\/div>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;

        // meuguia.tv shows Brazil time (UTC-3)
        // We need to convert to user's local time
        // Brazil offset: -3 hours from UTC (-180 minutes)
        const brazilOffsetMinutes = -180;
        const localOffsetMinutes = new Date().getTimezoneOffset(); // e.g. 300 for EST (UTC-5)
        // Difference: how many minutes ahead is Brazil from user's local time
        // If user is EST (300), Brazil is (-180), difference = 300 - (-180) = 480 minutes = 8 hours? No...
        // Actually: Brazil is UTC-3, EST is UTC-5, so Brazil is 2 hours AHEAD of EST
        // To convert Brazil time to EST: subtract 2 hours
        // brazilOffset is -180, localOffset is 300 (for EST)
        // Brazil is at UTC-3, EST is at UTC-5
        // Difference = (-3) - (-5) = 2 hours, Brazil is 2 hours ahead
        const brazilVsLocalHours = (brazilOffsetMinutes - (-localOffsetMinutes)) / 60;
        // For EST: brazilVsLocalHours = (-180 - (-300)) / 60 = 120 / 60 = 2 hours ahead

        console.log('[EPG] meuguia timezone offset:', brazilVsLocalHours, 'hours');

        const today = new Date();
        let lastHour = -1;
        let dayOffset = 0;

        let match;
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

            // Create date and adjust for timezone difference
            const startDate = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() + dayOffset,
                hours,
                minutes,
                0,
                0
            );

            // Subtract the Brazil offset to convert to user's local time
            startDate.setHours(startDate.getHours() - brazilVsLocalHours);

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

    // Get current program - SIMPLE: compare with current local time
    getCurrentProgram(programs: EPGProgram[]): EPGProgram | null {
        if (programs.length === 0) return null;

        const now = Date.now();

        // Find program that's currently airing
        const current = programs.find(p => {
            const start = new Date(p.start).getTime();
            const end = new Date(p.end).getTime();
            return now >= start && now <= end;
        });

        if (current) {
            console.log('[EPG] Current:', current.title);
            return current;
        }

        // Fallback to first program if nothing matches
        console.log('[EPG] No match, using first program');
        return programs[0];
    },

    // Get next program
    getNextProgram(programs: EPGProgram[]): EPGProgram | null {
        const current = this.getCurrentProgram(programs);
        if (!current) return null;

        const currentIndex = programs.findIndex(p => p.id === current.id);
        if (currentIndex >= 0 && currentIndex < programs.length - 1) {
            return programs[currentIndex + 1];
        }

        return null;
    },

    // Get upcoming programs (after current)
    getUpcomingPrograms(programs: EPGProgram[], current: EPGProgram | null, count: number): EPGProgram[] {
        if (!current || programs.length === 0) return [];

        const currentIndex = programs.findIndex(p => p.id === current.id);
        if (currentIndex < 0) return [];

        return programs.slice(currentIndex + 1, currentIndex + 1 + count);
    },

    // Format time for display (shows in local time)
    formatTime(isoString: string): string {
        const date = new Date(isoString);
        return date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    },

    // Calculate progress percentage
    getProgress(program: EPGProgram): number {
        const now = Date.now();
        const start = new Date(program.start).getTime();
        const end = new Date(program.end).getTime();

        if (now < start) return 0;
        if (now > end) return 100;

        return Math.round(((now - start) / (end - start)) * 100);
    },

    // Alias for getProgress (used by LiveTV.tsx)
    getProgramProgress(program: EPGProgram): number {
        return this.getProgress(program);
    }
};
