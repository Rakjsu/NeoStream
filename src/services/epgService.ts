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
    // Globo regional
    'globo sp': 'globo-sao-paulo-hd',
    'globo rj': 'globo-rio-de-janeiro-hd',
    // SBT
    'sbt sp': 'sbt-s-o-paulo',
    // Record
    'record sp': 'recordtv-s-o-paulo-hd',
};

// Manual channel mappings for meuguia.tv (fallback)
const meuguiaMappings: Record<string, string> = {
    'hbo signature': 'HFE',
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
        // Remove quality suffixes: [FHD], [HD], [SD], [4K], [UHD] or FHD, HD, SD, 4K, UHD
        const normalized = channelName
            .toLowerCase()
            .trim()
            .replace(/\s*\[?(fhd|hd|sd|4k|uhd)\]?\s*$/i, '')
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
        // Remove quality suffixes: [FHD], [HD], etc.
        const normalized = channelName
            .toLowerCase()
            .trim()
            .replace(/\s*\[?(fhd|hd|sd|4k|uhd)\]?\s*$/i, '')
            .trim();
        return meuguiaMappings[normalized] || null;
    },

    // Parse mi.tv HTML - SIMPLE: use times exactly as shown
    parseHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // Pattern to match time and title
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

            if (title.length < 2 || title.length > 150) continue;

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
    }
};
