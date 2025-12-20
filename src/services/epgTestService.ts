// EPG Test Service - Background test execution
// This service manages the EPG test in the background, persisting across navigation

import { epgService } from './epgService';

export interface EpgTestResult {
    working: { channel: string; source: string; epgId: string; programCount: number; country?: 'BR' | 'ARG' | 'US' | 'PT' }[];
    notWorking: { channel: string; source: string; epgId: string; reason: string; country?: 'BR' | 'ARG' | 'US' | 'PT' }[];
    summary: { total: number; working: number; notWorking: number };
    timestamp?: number;
    isPartial?: boolean;
    scannedChannels?: string[];
    lastScannedIndex?: number;
}

export interface EpgTestProgress {
    current: number;
    total: number;
    currentChannel: string;
}

type TestMode = 'full' | 'continue' | 'retryFailed';
type TestStatus = 'idle' | 'running' | 'paused' | 'completed';

// Listeners for state updates
type StateListener = () => void;

class EpgTestService {
    private static instance: EpgTestService;

    // State
    private _status: TestStatus = 'idle';
    private _progress: EpgTestProgress = { current: 0, total: 0, currentChannel: '' };
    private _results: EpgTestResult | null = null;
    private _lastTestDate: string | null = null;
    private _isPaused: boolean = false;

    // Listeners for React components to subscribe to updates
    private listeners: Set<StateListener> = new Set();

    // Translation function (will be set from React)
    private translateFn: ((section: string, key: string) => string) | null = null;

    private constructor() {
        // Load cached results on initialization
        this.loadFromCache();
    }

    static getInstance(): EpgTestService {
        if (!EpgTestService.instance) {
            EpgTestService.instance = new EpgTestService();
        }
        return EpgTestService.instance;
    }

    // Set translation function from React component
    setTranslateFunction(fn: (section: string, key: string) => string) {
        this.translateFn = fn;
    }

    private t(section: string, key: string): string {
        if (this.translateFn) {
            return this.translateFn(section, key);
        }
        // Fallback to Portuguese
        const fallbacks: Record<string, string> = {
            'noEpgData': 'Sem dados no EPG'
        };
        return fallbacks[key] || key;
    }

    // Subscribe to state changes
    subscribe(listener: StateListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener());
    }

    // Getters for state
    get status(): TestStatus { return this._status; }
    get progress(): EpgTestProgress { return this._progress; }
    get results(): EpgTestResult | null { return this._results; }
    get lastTestDate(): string | null { return this._lastTestDate; }
    get isRunning(): boolean { return this._status === 'running'; }

    // Load results from localStorage
    private loadFromCache() {
        try {
            const cached = localStorage.getItem('epg_test_results');
            if (cached) {
                const parsed = JSON.parse(cached);
                this._results = parsed;
                if (parsed.timestamp) {
                    this._lastTestDate = new Date(parsed.timestamp).toLocaleString('pt-BR');
                }
            }
        } catch (e) {
            console.error('[EPG Test] Failed to load cache:', e);
        }
    }

    // Clear cache
    clearCache() {
        localStorage.removeItem('epg_test_results');
        this._results = null;
        this._lastTestDate = null;
        this._status = 'idle';
        this.notifyListeners();
    }

    // Pause the test
    pause() {
        if (this._status === 'running') {
            this._isPaused = true;
            // Status will be updated when the loop detects the pause
        }
    }

    // Detect country from channel name
    private detectCountry(channelName: string, ptId: string | null, arId: string | null, usaId: string | null): 'BR' | 'ARG' | 'US' | 'PT' {
        const channelNameUpper = channelName.toUpperCase();
        if (channelNameUpper.startsWith('USA:') || channelNameUpper.includes(' USA') || usaId) {
            return 'US';
        } else if (channelNameUpper.startsWith('ARG |') || channelNameUpper.startsWith('AR:') || arId) {
            return 'ARG';
        } else if (channelNameUpper.startsWith('PT:') || channelNameUpper.startsWith('PT |') || ptId) {
            return 'PT';
        }
        return 'BR';
    }

    // Start test
    async startTest(mode: TestMode = 'full') {
        if (this._status === 'running') {
            console.log('[EPG Test] Test already running');
            return;
        }

        this._status = 'running';
        this._isPaused = false;
        this._progress = { current: 0, total: 0, currentChannel: 'Carregando canais...' };
        this.notifyListeners();

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;
            const result = await ipcRenderer.invoke('streams:get-live');

            if (!result.success || !result.data || result.data.length === 0) {
                console.error('[EPG Test] Failed to fetch live channels');
                this._status = 'idle';
                this.notifyListeners();
                return;
            }

            const allChannels = result.data as { name: string; stream_id: number }[];
            const total = allChannels.length;

            // Initialize based on mode
            let working: EpgTestResult['working'] = [];
            let notWorking: EpgTestResult['notWorking'] = [];
            let scannedChannels: string[] = [];
            let channelsToTest: { name: string; stream_id: number }[] = [];
            let startIndex = 0;

            if (mode === 'full') {
                if (this._results) {
                    working = [...this._results.working];
                    notWorking = [...this._results.notWorking];
                    scannedChannels = [];
                }
                channelsToTest = allChannels;
            } else if (mode === 'continue') {
                if (this._results) {
                    working = [...this._results.working];
                    notWorking = [...this._results.notWorking];
                    scannedChannels = this._results.scannedChannels || [];
                    startIndex = this._results.lastScannedIndex || 0;
                }
                channelsToTest = allChannels;
            } else if (mode === 'retryFailed') {
                if (this._results && this._results.notWorking.length > 0) {
                    working = [...this._results.working];
                    scannedChannels = this._results.scannedChannels || [];
                    const failedChannelNames = this._results.notWorking.map(c => c.channel.toLowerCase());
                    channelsToTest = allChannels.filter(c => failedChannelNames.includes(c.name.toLowerCase()));
                    console.log(`[EPG Test] Retry mode: ${this._results.notWorking.length} failed channels, ${channelsToTest.length} found to retest`);
                    notWorking = []; // Clear only if we have channels to test
                } else {
                    console.log('[EPG Test] No failed channels to retry');
                    this._status = 'idle';
                    this.notifyListeners();
                    return;
                }
            }

            // Test each channel
            for (let i = startIndex; i < channelsToTest.length; i++) {
                // Check if paused
                if (this._isPaused) {
                    const partialResults: EpgTestResult = {
                        working,
                        notWorking,
                        summary: { total, working: working.length, notWorking: notWorking.length },
                        timestamp: Date.now(),
                        isPartial: true,
                        scannedChannels,
                        lastScannedIndex: mode === 'continue' ? i : allChannels.findIndex(c => c.name === channelsToTest[i].name)
                    };
                    this._results = partialResults;
                    this._lastTestDate = new Date().toLocaleString('pt-BR');
                    this._status = 'paused';
                    localStorage.setItem('epg_test_results', JSON.stringify(partialResults));
                    this.notifyListeners();
                    return;
                }

                const channel = channelsToTest[i];
                this._progress = { current: i + 1, total: channelsToTest.length, currentChannel: channel.name };
                this.notifyListeners();

                // Skip if already scanned (for continue mode)
                if (scannedChannels.includes(channel.name)) {
                    continue;
                }

                // Detect source and EPG ID
                const ptId = epgService.getOpenEpgPortugalId(channel.name);
                const arId = epgService.getOpenEpgArgentinaId(channel.name);
                const usaId = epgService.getOpenEpgUSAId(channel.name);

                let source = '';
                let epgId = '';
                const country = this.detectCountry(channel.name, ptId, arId, usaId);

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
                    epgId = epgService.getMiTVSlug(channel.name);
                }

                try {
                    const programs = await epgService.fetchChannelEPG('', channel.name);
                    if (programs.length > 0) {
                        // Remove if exists (for full rescan)
                        working = working.filter(w => w.channel !== channel.name);
                        notWorking = notWorking.filter(n => n.channel !== channel.name);

                        working.push({
                            channel: channel.name,
                            source,
                            epgId,
                            programCount: programs.length,
                            country
                        });
                    } else {
                        // Remove if exists (for full rescan)
                        working = working.filter(w => w.channel !== channel.name);
                        notWorking = notWorking.filter(n => n.channel !== channel.name);

                        notWorking.push({
                            channel: channel.name,
                            source,
                            epgId,
                            reason: this.t('epg', 'noEpgData'),
                            country
                        });
                    }
                } catch (error) {
                    working = working.filter(w => w.channel !== channel.name);
                    notWorking = notWorking.filter(n => n.channel !== channel.name);

                    notWorking.push({
                        channel: channel.name,
                        source,
                        epgId,
                        reason: `Erro: ${(error as Error).message}`,
                        country
                    });
                }

                scannedChannels.push(channel.name);

                // Update results after each channel
                const currentResults: EpgTestResult = {
                    working,
                    notWorking,
                    summary: { total, working: working.length, notWorking: notWorking.length },
                    timestamp: Date.now(),
                    isPartial: true,
                    scannedChannels,
                    lastScannedIndex: mode === 'continue' ? i + 1 : allChannels.findIndex(c => c.name === channelsToTest[i].name) + 1
                };
                this._results = currentResults;
                this.notifyListeners();

                // Save to localStorage every 50 channels
                if ((i + 1) % 50 === 0) {
                    localStorage.setItem('epg_test_results', JSON.stringify(currentResults));
                }
            }

            // Completed
            const finalResults: EpgTestResult = {
                working,
                notWorking,
                summary: { total, working: working.length, notWorking: notWorking.length },
                timestamp: Date.now(),
                isPartial: false,
                scannedChannels,
                lastScannedIndex: allChannels.length
            };

            this._results = finalResults;
            this._lastTestDate = new Date().toLocaleString('pt-BR');
            this._status = 'completed';
            localStorage.setItem('epg_test_results', JSON.stringify(finalResults));
            this.notifyListeners();

        } catch (error) {
            console.error('[EPG Test] Error:', error);
            this._status = 'idle';
            this.notifyListeners();
        }
    }
}

// Export singleton instance
const epgTestService = EpgTestService.getInstance();
export default epgTestService;
