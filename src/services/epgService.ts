interface EPGProgram {
    id: string;
    start: string; // ISO timestamp
    end: string; // ISO timestamp
    title: string;
    description?: string;
    channel_id: string;
}

export const epgService = {
    // Fetch EPG data for a specific channel
    async fetchChannelEPG(epgChannelId: string): Promise<EPGProgram[]> {
        try {
            const credentials = await window.ipcRenderer.invoke('auth:get-credentials');
            if (!credentials) return [];

            // XC API EPG endpoint format
            const url = `${credentials.serverUrl}/player_api.php?username=${credentials.username}&password=${credentials.password}&action=get_simple_data_table&stream_id=${epgChannelId}`;

            const response = await fetch(url);

            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                return []; // Server returned HTML or other non-JSON response
            }

            const data = await response.json();

            if (!data.epg_listings) return [];

            // Parse and return programs
            return data.epg_listings.map((item: any) => ({
                id: item.id || `${item.start}-${item.title}`,
                start: item.start,
                end: item.stop,
                title: item.title || 'No Title',
                description: item.description || item.desc,
                channel_id: epgChannelId
            }));
        } catch {
            return []; // Silently fail - EPG not available
        }
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
