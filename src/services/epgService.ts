import mitvMappingsJson from '../data/epg-mappings/mitv.json';
import meuguiaMappingsJson from '../data/epg-mappings/meuguia.json';
import openEpgPortugalMappingsJson from '../data/epg-mappings/openepg-pt.json';
import openEpgArgentinaMappingsJson from '../data/epg-mappings/openepg-ar.json';
import openEpgUSAMappingsJson from '../data/epg-mappings/openepg-usa.json';
import openEpgBrazilMappingsJson from '../data/epg-mappings/openepg-br.json';
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
const mitvMappings: Record<string, string> = mitvMappingsJson;

// Manual channel mappings for meuguia.tv (fallback)
const meuguiaMappings: Record<string, string> = meuguiaMappingsJson;

// Open-EPG Portugal sources (both files contain different channels)
const OPEN_EPG_PORTUGAL_URLS = [
    'https://www.open-epg.com/files/portugal1.xml',
    'https://www.open-epg.com/files/portugal2.xml'
];

// Open-EPG Argentina sources (7 files contain different channels)
const OPEN_EPG_ARGENTINA_URLS = [
    'https://www.open-epg.com/files/argentina1.xml',
    'https://www.open-epg.com/files/argentina2.xml',
    'https://www.open-epg.com/files/argentina3.xml',
    'https://www.open-epg.com/files/argentina4.xml',
    'https://www.open-epg.com/files/argentina5.xml',
    'https://www.open-epg.com/files/argentina6.xml',
    'https://www.open-epg.com/files/argentina7.xml'
];

// Open-EPG Brazil sources (5 files - fallback for channels not in mi.tv)
const OPEN_EPG_BRAZIL_URLS = [
    'https://www.open-epg.com/files/brazil1.xml',
    'https://www.open-epg.com/files/brazil2.xml',
    'https://www.open-epg.com/files/brazil3.xml',
    'https://www.open-epg.com/files/brazil4.xml',
    'https://www.open-epg.com/files/brazil5.xml'
];

// Open-EPG Portugal channel mappings (channel name -> Open-EPG ID)
// IDs use format: "Channel Name.pt" or "Channel Name HD.pt"
const openEpgPortugalMappings: Record<string, string> = openEpgPortugalMappingsJson;

// Open-EPG Argentina channel mappings (channel name -> Open-EPG ID)
// IDs use format: "Channel Name.ar"
const openEpgArgentinaMappings: Record<string, string> = openEpgArgentinaMappingsJson;

// Open-EPG USA sources (10 files)
const OPEN_EPG_USA_URLS = [
    'https://www.open-epg.com/files/unitedstates1.xml',
    'https://www.open-epg.com/files/unitedstates2.xml',
    'https://www.open-epg.com/files/unitedstates3.xml',
    'https://www.open-epg.com/files/unitedstates4.xml',
    'https://www.open-epg.com/files/unitedstates6.xml',
    'https://www.open-epg.com/files/unitedstates7.xml',
    'https://www.open-epg.com/files/unitedstates8.xml',
    'https://www.open-epg.com/files/unitedstates9.xml',
    'https://www.open-epg.com/files/unitedstates10.xml',
    'https://www.open-epg.com/files/unitedstates11.xml'
];

// Open-EPG USA channel mappings (channel name -> Open-EPG ID)
const openEpgUSAMappings: Record<string, string> = openEpgUSAMappingsJson;

// Open-EPG Brazil channel mappings (channel name -> Open-EPG ID)
// Used as fallback for Brazilian channels not in mi.tv or meuguia.tv
// IDs use format: "Channel Name.br"
const openEpgBrazilMappings: Record<string, string> = openEpgBrazilMappingsJson;

export const epgService = {

    // Main function to fetch EPG for a channel
    async fetchChannelEPG(epgChannelId: string, channelName?: string, streamId?: number): Promise<EPGProgram[]> {
        // PRIMARY: the Xtream provider's own EPG (xmltv.php parsed once in the
        // main process; get_simple_data_table as secondary). Falls back to the
        // existing chain when the provider has nothing for this channel.
        // Providers sometimes ship stale dumps (e.g. ending hours ago), so the
        // provider only wins when it has at least one current/future program.
        const providerPrograms = await this.fetchFromProvider(epgChannelId, streamId);
        const now = Date.now();
        if (providerPrograms.some(p => new Date(p.end).getTime() > now)) {
            return providerPrograms;
        }

        if (!channelName) return [];

        // Check if this is a Portuguese channel (has mapping in Open-EPG Portugal)
        const openEpgPtId = this.getOpenEpgPortugalId(channelName);
        if (openEpgPtId) {
            // Portuguese channels ONLY use Open-EPG Portugal (no mi.tv/meuguia fallback)
            const openEpgPrograms = await this.fetchFromOpenEpgPortugal(channelName, openEpgPtId);
            return openEpgPrograms; // Return even if empty - don't try other sources
        }

        // Check if this is an Argentine channel (has mapping in Open-EPG Argentina)
        const openEpgArId = this.getOpenEpgArgentinaId(channelName);
        if (openEpgArId) {
            // Argentine channels ONLY use Open-EPG Argentina (no mi.tv fallback)
            const openEpgPrograms = await this.fetchFromOpenEpgArgentina(channelName, openEpgArId);
            return openEpgPrograms; // Return even if empty - don't try other sources
        }

        // Check if this is a USA channel (has mapping in Open-EPG USA)
        const openEpgUsaId = this.getOpenEpgUSAId(channelName);
        if (openEpgUsaId) {
            // USA channels ONLY use Open-EPG USA (no mi.tv fallback)
            const openEpgPrograms = await this.fetchFromOpenEpgUSA(channelName, openEpgUsaId);
            return openEpgPrograms; // Return even if empty - don't try other sources
        }

        // For non-matched channels: Try mi.tv (for Brazilian channels)
        const mitvPrograms = await this.fetchFromMiTV(channelName);
        if (mitvPrograms.length > 0) return mitvPrograms;

        // Try meuguia.tv as fallback
        const meuguiaPrograms = await this.fetchFromMeuGuia(channelName);
        if (meuguiaPrograms.length > 0) return meuguiaPrograms;

        // Try Open-EPG Brazil as final fallback (for channels not in mi.tv/meuguia)
        const openEpgBrId = this.getOpenEpgBrazilId(channelName);
        if (openEpgBrId) {
            const openEpgPrograms = await this.fetchFromOpenEpgBrazil(channelName, openEpgBrId);
            if (openEpgPrograms.length > 0) return openEpgPrograms;
        }

        return [];
    },

    // Fetch from the Xtream provider's own EPG via the main process
    // ('epg:provider-channel' answers from an in-memory index, so this is
    // effectively instant when the provider has an EPG)
    async fetchFromProvider(epgChannelId: string, streamId?: number): Promise<EPGProgram[]> {
        try {
            if (!epgChannelId && streamId === undefined) return [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;
            if (!ipcRenderer?.invoke) return [];

            const result = await ipcRenderer.invoke('epg:provider-channel', {
                channelId: epgChannelId || '',
                streamId
            });
            if (!result?.success || !Array.isArray(result.programs)) return [];

            return result.programs as EPGProgram[];
        } catch (error) {
            console.error('[EPG] Provider EPG error:', error);
            return [];
        }
    },

    // Get Open-EPG Portugal ID from channel name
    getOpenEpgPortugalId(channelName: string): string | null {
        const original = channelName.toLowerCase().trim();

        // Check if channel has PT prefix
        const hasPTPrefix = /^(pt|portugal)\s*[:|]/i.test(original);

        // Remove country prefixes: PT:, PT |, PT-, BR:, etc.
        let normalized = original.replace(/^(pt|br|portugal|brasil)\s*[:|]\s*/i, '');

        // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
        normalized = normalized.replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '');

        // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
        normalized = normalized.replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '');

        // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
        normalized = normalized.replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '');

        // Remove remaining quality/tags at end without brackets
        normalized = normalized.replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '');

        normalized = normalized.trim();

        // Channels that conflict with Brazil (mi.tv) - only match if has PT prefix
        const conflictingChannels = ['vh1', 'mtv', 'mtv live', 'axn', 'fox', 'fox comedy', 'fox crime', 'fox life', 'fox movies', 'discovery', 'discovery channel', 'national geographic', 'nat geo wild', 'cartoon network', 'cartoonito', 'nickelodeon', 'disney channel', 'disney junior', 'cnn', 'syfy', 'amc', 'blaze', 'record', 'record tv', 'record news', 'globo', 'globo news', 'fashion tv', 'dog tv', 'dogtv', 'cancao nova', 'canção nova', 'tve', 'tve internacional', 'dazn 1', 'dazn 2', 'dazn 3', 'dazn 4', 'dazn 5', 'dazn 6', 'tlc', 'nick jr', 'bloomberg', 'e!', 'food network', 'star channel', 'star life', 'star movies', 'star crime', 'star comedy'];
        if (conflictingChannels.includes(normalized) && !hasPTPrefix) {
            return null; // Let it fall through to Argentina/USA/Brazil checks
        }

        const result = openEpgPortugalMappings[normalized] || null;

        // If not found, try some variations
        if (!result) {
            const variations = [
                normalized.replace(/\s+/g, ''),  // no spaces: "24kitchen"
                normalized.replace(/-/g, ' '),  // hyphens to spaces
            ];
            for (const variant of variations) {
                const varResult = openEpgPortugalMappings[variant];
                if (varResult) {
                    return varResult;
                }
            }
        }

        return result;
    },

    // Fetch from Open-EPG Portugal using the cache system (downloads both portugal1 and portugal2)
    async fetchFromOpenEpgPortugal(channelName: string, channelId: string): Promise<EPGProgram[]> {
        try {
            let combinedXml = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;

            // Download both EPG files and combine them
            if (ipcRenderer?.invoke) {
                for (let i = 0; i < OPEN_EPG_PORTUGAL_URLS.length; i++) {
                    const url = OPEN_EPG_PORTUGAL_URLS[i];
                    const cacheKey = `portugal${i + 1}`;

                    try {
                        const result = await ipcRenderer.invoke('epg:get-cached', {
                            url: url,
                            cacheKey: cacheKey,
                            forceRefresh: false
                        });

                        if (result.success && result.data) {
                            combinedXml += result.data;
                        } else {
                            console.error(`[EPG] Failed to download ${cacheKey}:`, result.error);
                        }
                    } catch (err) {
                        console.error(`[EPG] Error downloading ${cacheKey}:`, err);
                    }
                }
            }

            if (!combinedXml) {
                console.error('[EPG] No XML data received from any source');
                return [];
            }

            return this.parseXMLTV(combinedXml, channelId, channelName);
        } catch (error) {
            console.error('[EPG] Open-EPG Portugal error:', error);
            return [];
        }
    },

    // Get Open-EPG Argentina ID from channel name
    getOpenEpgArgentinaId(channelName: string): string | null {
        const original = channelName.toLowerCase().trim();

        // Check if channel has ARG prefix
        const hasARGPrefix = /^(arg|ar|argentina)\s*[:|]/i.test(original);

        // Remove country prefixes: ARG |, ARG:, AR:, etc.
        let normalized = original.replace(/^(arg|ar|argentina)\s*[:|]\s*/i, '');

        // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
        normalized = normalized.replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '');

        // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
        normalized = normalized.replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '');

        // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
        normalized = normalized.replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '');

        // Remove remaining quality/tags at end without brackets
        normalized = normalized.replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '');

        normalized = normalized.trim();

        // Channels that conflict with Brazil (mi.tv) - only match if has ARG prefix
        const conflictingChannels = ['hbo', 'hbo 2', 'hbo mundi', 'hbo plus', 'hbo pop', 'hbo signature', 'espn', 'espn 2', 'espn 3', 'fox sports', 'fox sports 2', 'fox sports 3', 'tnt', 'tnt sports', 'axn', 'discovery', 'cartoon network', 'nickelodeon', 'disney channel', 'disney jr', 'mtv', 'cnn', 'vh1', 'studio universal', 'universal channel', 'star channel'];
        if (conflictingChannels.includes(normalized) && !hasARGPrefix) {
            return null; // Let it fall through to Brazil (mi.tv)
        }

        const result = openEpgArgentinaMappings[normalized] || null;

        // Try variations if not found
        if (!result) {
            const variations = [
                normalized.replace(/\s+/g, ''),  // no spaces
                normalized.replace(/-/g, ' '),  // hyphens to spaces
            ];
            for (const variant of variations) {
                const varResult = openEpgArgentinaMappings[variant];
                if (varResult) return varResult;
            }
        }

        return result;
    },

    // Fetch from Open-EPG Argentina using the cache system (downloads all 7 files)
    async fetchFromOpenEpgArgentina(channelName: string, channelId: string): Promise<EPGProgram[]> {
        try {
            let combinedXml = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;

            // Download all 7 EPG files and combine them
            if (ipcRenderer?.invoke) {
                for (let i = 0; i < OPEN_EPG_ARGENTINA_URLS.length; i++) {
                    const url = OPEN_EPG_ARGENTINA_URLS[i];
                    const cacheKey = `argentina${i + 1}`;

                    try {
                        const result = await ipcRenderer.invoke('epg:get-cached', {
                            url: url,
                            cacheKey: cacheKey,
                            forceRefresh: false
                        });

                        if (result.success && result.data) {
                            combinedXml += result.data;
                        } else {
                            console.error(`[EPG] Failed to download ${cacheKey}:`, result.error);
                        }
                    } catch (err) {
                        console.error(`[EPG] Error downloading ${cacheKey}:`, err);
                    }
                }
            }

            if (!combinedXml) {
                console.error('[EPG] No Argentina XML data received');
                return [];
            }

            return this.parseXMLTV(combinedXml, channelId, channelName);
        } catch (error) {
            console.error('[EPG] Open-EPG Argentina error:', error);
            return [];
        }
    },

    // Get Open-EPG USA ID from channel name
    getOpenEpgUSAId(channelName: string): string | null {
        const original = channelName.toLowerCase().trim();

        // Check if channel has USA prefix
        const hasUSAPrefix = /^(usa|us)\s*[:|]/i.test(original);

        // Remove country prefixes: USA:, USA |, US:, etc.
        let normalized = original.replace(/^(usa|us)\s*[:|]\s*/i, '');

        // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
        normalized = normalized.replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '');

        // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
        normalized = normalized.replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '');

        // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
        normalized = normalized.replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '');

        // Remove remaining quality/tags at end without brackets
        normalized = normalized.replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '');

        normalized = normalized.trim();

        // Channels that conflict with Brazil (mi.tv) - only match if has USA prefix
        const conflictingChannels = ['tcm', 'tnt', 'tbs', 'amc', 'vh1', 'discovery channel', 'axn', 'mtv', 'fox sports', 'espn', 'espn 2', 'espn 3', 'espn 4', 'cartoon network', 'nickelodeon', 'disney channel', 'disney jr', 'disney xd', 'cnn', 'hbo', 'hbo 2', 'hbo comedy', 'hbo family', 'hbo signature', 'hbo zone', 'fox', 'a&e', 'a & e', 'aande', 'cinemax', 'paramount channel', 'syfy', 'animal planet', 'hgtv', 'tlc', 'trutv', 'boomerang', 'nick jr', 'bloomberg', 'comedy central', 'e!', 'e! entertainment', 'food network', 'lifetime', 'lifetime movies', 'discovery id'];
        if (conflictingChannels.includes(normalized) && !hasUSAPrefix) {
            return null; // Let it fall through to Brazil (mi.tv)
        }

        const result = openEpgUSAMappings[normalized] || null;

        // Try variations if not found
        if (!result) {
            const variations = [
                normalized.replace(/\s+/g, ''),  // no spaces
                normalized.replace(/-/g, ' '),  // hyphens to spaces
            ];
            for (const variant of variations) {
                const varResult = openEpgUSAMappings[variant];
                if (varResult) return varResult;
            }
        }

        return result;
    },

    // Fetch from Open-EPG USA using the cache system (downloads all 10 files)
    async fetchFromOpenEpgUSA(channelName: string, channelId: string): Promise<EPGProgram[]> {
        try {
            let combinedXml = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;

            // Download all 10 EPG files and combine them
            if (ipcRenderer?.invoke) {
                for (let i = 0; i < OPEN_EPG_USA_URLS.length; i++) {
                    const url = OPEN_EPG_USA_URLS[i];
                    const cacheKey = `usa${i + 1}`;

                    try {
                        const result = await ipcRenderer.invoke('epg:get-cached', {
                            url: url,
                            cacheKey: cacheKey,
                            forceRefresh: false
                        });

                        if (result.success && result.data) {
                            combinedXml += result.data;
                        } else {
                            console.error(`[EPG] Failed to download ${cacheKey}:`, result.error);
                        }
                    } catch (err) {
                        console.error(`[EPG] Error downloading ${cacheKey}:`, err);
                    }
                }
            }

            if (!combinedXml) {
                console.error('[EPG] No USA XML data received');
                return [];
            }

            return this.parseXMLTV(combinedXml, channelId, channelName);
        } catch (error) {
            console.error('[EPG] Open-EPG USA error:', error);
            return [];
        }
    },

    // Get Open-EPG Brazil ID from channel name (for channels not in mi.tv)
    getOpenEpgBrazilId(channelName: string): string | null {
        let normalized = channelName.toLowerCase().trim();

        // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
        normalized = normalized.replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '');

        // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
        normalized = normalized.replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '');

        // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
        normalized = normalized.replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '');

        // Remove remaining quality/tags at end without brackets
        normalized = normalized.replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '');

        normalized = normalized.trim();

        const result = openEpgBrazilMappings[normalized] || null;

        // Try variations if not found
        if (!result) {
            const variations = [
                normalized.replace(/\s+/g, ''),  // no spaces
                normalized.replace(/-/g, ' '),  // hyphens to spaces
            ];
            for (const variant of variations) {
                const varResult = openEpgBrazilMappings[variant];
                if (varResult) return varResult;
            }
        }

        return result;
    },

    // Fetch from Open-EPG Brazil using the cache system (downloads all 5 files)
    async fetchFromOpenEpgBrazil(channelName: string, channelId: string): Promise<EPGProgram[]> {
        try {
            let combinedXml = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;

            // Download all 5 EPG files and combine them
            if (ipcRenderer?.invoke) {
                for (let i = 0; i < OPEN_EPG_BRAZIL_URLS.length; i++) {
                    const url = OPEN_EPG_BRAZIL_URLS[i];
                    const cacheKey = `brazil${i + 1}`;

                    try {
                        const result = await ipcRenderer.invoke('epg:get-cached', {
                            url: url,
                            cacheKey: cacheKey,
                            forceRefresh: false
                        });

                        if (result.success && result.data) {
                            combinedXml += result.data;
                        } else {
                            console.error(`[EPG] Failed to download ${cacheKey}:`, result.error);
                        }
                    } catch (err) {
                        console.error(`[EPG] Error downloading ${cacheKey}:`, err);
                    }
                }
            }

            if (!combinedXml) {
                console.error('[EPG] No Brazil XML data received');
                return [];
            }

            return this.parseXMLTV(combinedXml, channelId, channelName);
        } catch (error) {
            console.error('[EPG] Open-EPG Brazil error:', error);
            return [];
        }
    },

    parseXMLTV(xml: string, channelId: string, channelName: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // Find all programmes for this channel
        // Use a simpler regex that's more flexible with attribute order and whitespace
        const allProgrammes = xml.match(/<programme[^>]+>[\s\S]*?<\/programme>/gi) || [];

        for (const prog of allProgrammes) {
            // Check if this programme is for our channel
            const channelMatch = prog.match(/channel="([^"]+)"/i);
            if (!channelMatch || channelMatch[1] !== channelId) continue;

            // Extract start and stop times
            const startMatch = prog.match(/start="(\d{14})\s*([+-]\d{4})"/i);
            const stopMatch = prog.match(/stop="(\d{14})\s*([+-]\d{4})"/i);

            if (!startMatch || !stopMatch) continue;

            // Extract title
            const titleMatch = prog.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? this.decodeXMLEntities(titleMatch[1]) : 'Sem título';

            // Extract description
            const descMatch = prog.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
            const description = descMatch ? this.decodeXMLEntities(descMatch[1]) : '';

            // Parse times
            const startDate = this.parseXMLTVTime(startMatch[1], startMatch[2]);
            const endDate = this.parseXMLTVTime(stopMatch[1], stopMatch[2]);

            if (startDate && endDate) {
                programs.push({
                    id: `openepg-${startDate.getTime()}`,
                    start: startDate.toISOString(),
                    end: endDate.toISOString(),
                    title: title,
                    description: description,
                    channel_id: channelName
                });
            }
        }

        return programs;
    },

    // Parse XMLTV time format: YYYYMMDDHHMMSS +ZZZZ
    parseXMLTVTime(timeStr: string, tzOffset: string): Date | null {
        try {
            const year = parseInt(timeStr.substring(0, 4));
            const month = parseInt(timeStr.substring(4, 6)) - 1; // JS months are 0-indexed
            const day = parseInt(timeStr.substring(6, 8));
            const hour = parseInt(timeStr.substring(8, 10));
            const minute = parseInt(timeStr.substring(10, 12));
            const second = parseInt(timeStr.substring(12, 14));

            // Parse timezone offset (+0000 format)
            const tzSign = tzOffset.startsWith('-') ? -1 : 1;
            const tzHours = parseInt(tzOffset.substring(1, 3));
            const tzMinutes = parseInt(tzOffset.substring(3, 5));
            const tzOffsetMs = tzSign * (tzHours * 60 + tzMinutes) * 60 * 1000;

            // Create date in UTC
            const utcDate = Date.UTC(year, month, day, hour, minute, second);
            // Adjust for timezone offset to get actual UTC time
            const actualUtcMs = utcDate - tzOffsetMs;

            return new Date(actualUtcMs);
        } catch (error) {
            console.error('[EPG] Failed to parse XMLTV time:', timeStr, tzOffset, error);
            return null;
        }
    },

    // Decode XML entities
    decodeXMLEntities(text: string): string {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    },

    // Fetch from mi.tv via the main-process proxy (direct fetch is CORS-blocked
    // in the renderer — webSecurity is on)
    async fetchFromMiTV(channelName: string): Promise<EPGProgram[]> {
        try {
            const slug = this.getMiTVSlug(channelName);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;
            if (!ipcRenderer?.invoke) return [];

            const result = await ipcRenderer.invoke('epg:fetch-mitv', slug);
            if (!result?.success || !result.html) return [];

            return this.parseHTML(result.html, channelName);
        } catch (error) {
            console.error('[EPG] mi.tv error:', error);
            return [];
        }
    },

    // Fetch from meuguia.tv via the main-process proxy (same CORS situation)
    async fetchFromMeuGuia(channelName: string): Promise<EPGProgram[]> {
        try {
            const slug = this.getMeuGuiaSlug(channelName);
            if (!slug) return [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;
            if (!ipcRenderer?.invoke) return [];

            const result = await ipcRenderer.invoke('epg:fetch-meuguia', slug);
            if (!result?.success || !result.html) return [];

            return this.parseMeuGuiaHTML(result.html, channelName);
        } catch (error) {
            console.error('[EPG] meuguia.tv error:', error);
            return [];
        }
    },

    // Get mi.tv slug from channel name
    getMiTVSlug(channelName: string): string {
        // Remove quality/codec/tag suffixes from channel name
        const normalized = channelName
            .toLowerCase()
            .trim()
            // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
            .replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '')
            // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
            .replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '')
            // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
            .replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '')
            // Remove remaining quality/tags at end without brackets: FHD, HD, SD at end
            .replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '')
            .trim();

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
        // Remove quality/codec/tag suffixes
        const normalized = channelName
            .toLowerCase()
            .trim()
            // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
            .replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '')
            // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
            .replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '')
            // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
            .replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '')
            // Remove remaining quality/tags at end without brackets
            .replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '')
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

        const today = new Date();
        let lastHour = -1;
        let dayOffset = 0;

        let match;
        while ((match = pattern.exec(html)) !== null) {
            const time = match[1];
            const title = match[2].trim()
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
            return current;
        }

        // Fallback to first program if nothing matches
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
    },

    // Test EPG mappings and return diagnostic information
    async testEPGMappings(sampleChannels?: string[]): Promise<{
        working: { channel: string; source: string; epgId: string; programCount: number }[];
        notWorking: { channel: string; source: string; epgId: string; reason: string }[];
        summary: { total: number; working: number; notWorking: number };
    }> {
        // Default sample channels for testing
        const testChannels = sampleChannels || [
            // USA Channels
            'USA: AMC [M]',
            'USA: CNN [M]',
            'USA: ESPN [M]',
            'USA: HBO (EAST) [M]',
            'USA: TNT [M]',
            'USA: CARTOON NETWORK (EAST) [M]',
            // Portugal Channels
            'PT: RTP 1',
            'PT: SIC',
            'PT: TVI',
            // Argentina Channels
            'ARG: TN',
            'ARG: TELEFE',
            // Brazil Channels
            'BR: Globo',
            'BR: SBT',
        ];

        const working: { channel: string; source: string; epgId: string; programCount: number }[] = [];
        const notWorking: { channel: string; source: string; epgId: string; reason: string }[] = [];

        for (const channel of testChannels) {
            // Detect source and EPG ID
            const ptId = this.getOpenEpgPortugalId(channel);
            const arId = this.getOpenEpgArgentinaId(channel);
            const usaId = this.getOpenEpgUSAId(channel);

            let source = '';
            let epgId = '';

            if (ptId) {
                source = 'Open-EPG Portugal';
                epgId = ptId;
            } else if (arId) {
                source = 'Open-EPG Argentina';
                epgId = arId;
            } else if (usaId) {
                source = 'Open-EPG USA';
                epgId = usaId;
            } else {
                source = 'mi.tv / meuguia.tv';
                epgId = 'auto-detect';
            }

            try {
                const programs = await this.fetchChannelEPG('', channel);
                if (programs.length > 0) {
                    working.push({
                        channel,
                        source,
                        epgId,
                        programCount: programs.length
                    });
                } else {
                    notWorking.push({
                        channel,
                        source,
                        epgId,
                        reason: 'Nenhum programa encontrado no EPG'
                    });
                }
            } catch (error) {
                notWorking.push({
                    channel,
                    source,
                    epgId,
                    reason: `Erro: ${(error as Error).message}`
                });
            }
        }

        return {
            working,
            notWorking,
            summary: {
                total: testChannels.length,
                working: working.length,
                notWorking: notWorking.length
            }
        };
    },

    // Get all available mappings for a specific region
    getMappingsInfo(): {
        usa: { count: number; sample: string[] };
        portugal: { count: number; sample: string[] };
        argentina: { count: number; sample: string[] };
    } {
        const usaKeys = Object.keys(openEpgUSAMappings);
        const ptKeys = Object.keys(openEpgPortugalMappings);
        const arKeys = Object.keys(openEpgArgentinaMappings);

        return {
            usa: {
                count: usaKeys.length,
                sample: usaKeys.slice(0, 10)
            },
            portugal: {
                count: ptKeys.length,
                sample: ptKeys.slice(0, 10)
            },
            argentina: {
                count: arKeys.length,
                sample: arKeys.slice(0, 10)
            }
        };
    }
};
