import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDLNA, type DLNADevice } from '../hooks/useDLNA';
import { useAirPlay } from '../hooks/useAirPlay';
import { useChromecast, type ChromecastDevice } from '../hooks/useChromecast';
import { useLanguage } from '../services/languageService';
import { buildSeasonTailQueue, type CastQueueItem } from '../services/castQueue';

export interface CastDevice {
    id: string;
    name: string;
    type: 'dlna' | 'airplay' | 'chromecast';
    available: boolean;
    source?: 'discovered' | 'manual';
    isSamsung?: boolean;
    cast: () => void;
}

interface CastDeviceSelectorProps {
    videoUrl: string;
    videoTitle: string;
    /** Current subtitle as WebVTT text — forwarded to the TV. */
    subtitleVtt?: string | null;
    /** Movie/series ids so a subtitle can be fetched here if none is loaded. */
    tmdbId?: string | number;
    imdbId?: string;
    /**
     * Optional playlist. When present the picker casts a QUEUE: a Chromecast
     * gets the whole queue (native QUEUE_LOAD); DLNA/AirPlay have no queue
     * protocol, so they start the first item. `videoUrl`/`videoTitle` are then
     * ignored (the first queue item drives the single-cast hooks).
     */
    queue?: CastQueueItem[];
    /** Content identity + resume position, so the Chromecast cast resumes and
     * records watch history (via GlobalCastIndicator). Absent for live/queues. */
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    seasonNumber?: number;
    episodeNumber?: number;
    startPosition?: number;
    onClose: () => void;
    onDeviceSelected: (device: CastDevice) => void;
}

export function CastDeviceSelector({
    videoUrl,
    videoTitle,
    subtitleVtt,
    tmdbId,
    imdbId,
    queue,
    contentId,
    contentType,
    seasonNumber,
    episodeNumber,
    startPosition,
    onClose,
    onDeviceSelected
}: CastDeviceSelectorProps) {
    // A subtitle fetched here (VOD from M3U/Stalker has no embedded subs)
    // overrides whatever the player had, and rides along in the cast.
    const [fetchedVtt, setFetchedVtt] = useState<string | null>(null);
    const effectiveVtt = fetchedVtt ?? subtitleVtt;
    // Casting a single series episode → resolve the season's remaining episodes
    // in the background so a Chromecast gets a queue (⏮/⏭ + autoplay of the
    // next episode). Resolved lazily; if the user picks a device before it's
    // ready, the cast falls back to the single episode.
    const [tailQueue, setTailQueue] = useState<CastQueueItem[] | null>(null);
    // When casting a queue, the single-cast hooks (DLNA/AirPlay/single Chromecast)
    // operate on the first item; the whole queue only goes to Chromecast below.
    const isQueue = !!queue && queue.length > 0;
    const primaryUrl = isQueue ? (queue![0].url || videoUrl) : videoUrl;
    const primaryTitle = isQueue ? (queue![0].title || videoTitle) : videoTitle;
    const dlna = useDLNA(primaryUrl, primaryTitle, effectiveVtt);
    const airplay = useAirPlay(primaryUrl, primaryTitle);
    // A single video (not a queue) carries its identity + resume position.
    const castContext = useMemo(() => (
        !isQueue && contentId
            ? { startPosition, contentId, contentType, season: seasonNumber, episode: episodeNumber }
            : undefined
    ), [isQueue, contentId, contentType, seasonNumber, episodeNumber, startPosition]);
    const chromecast = useChromecast(primaryUrl, primaryTitle, /\.m3u8(\?|$)/.test(primaryUrl), effectiveVtt, castContext);
    const { devices: dlnaDevices, discoverDevices, castToDevice, addDevice, error: dlnaError, isDiscovering } = dlna;
    const { devices: airplayDevices, castToDevice: castToAirPlayDevice } = airplay;
    const { devices: chromecastDevices, castToDevice: castToChromecast } = chromecast;
    const [view, setView] = useState<'list' | 'add'>('list');
    const [deviceName, setDeviceName] = useState('');
    const [deviceIP, setDeviceIP] = useState('');
    const [devicePort, setDevicePort] = useState('9197');
    const [casting, setCasting] = useState(false);
    const [castError, setCastError] = useState<string | null>(null);
    const [subBusy, setSubBusy] = useState(false);
    const [subMsg, setSubMsg] = useState<string | null>(null);
    const { t } = useLanguage();

    const fetchSubtitle = useCallback(async () => {
        setSubBusy(true);
        setSubMsg(null);
        try {
            const { autoFetchSubtitle, cleanupSubtitleUrl } = await import('../services/subtitleService');
            const result = await autoFetchSubtitle({ title: videoTitle, tmdbId, imdbId });
            if (result?.vttContent) {
                setFetchedVtt(result.vttContent);
                cleanupSubtitleUrl(result.url);
                setSubMsg(t('cast', 'subtitleReady'));
            } else {
                setSubMsg(t('cast', 'subtitleNotFound'));
            }
        } catch {
            setSubMsg(t('cast', 'subtitleNotFound'));
        } finally {
            setSubBusy(false);
        }
    }, [videoTitle, tmdbId, imdbId, t]);

    const handleCast = useCallback(async (device: DLNADevice) => {
        setCasting(true);
        setCastError(null);

        const success = await castToDevice(device);

        if (success) {
            onDeviceSelected({
                id: device.id,
                name: device.name,
                type: 'dlna',
                available: true,
                isSamsung: device.isSamsung,
                cast: () => { }
            });
            setTimeout(() => onClose(), 500);
        } else {
            setCastError(dlnaError || t('cast', 'failedToTransmit'));
        }
        setCasting(false);
    }, [castToDevice, dlnaError, onClose, onDeviceSelected, t]);

    const handleChromecast = useCallback(async (device: ChromecastDevice) => {
        setCasting(true);
        setCastError(null);
        let success: boolean;
        if (isQueue) {
            // Native Chromecast queue (QUEUE_LOAD) for the whole season/playlist.
            // A subtitle fetched here rides along on the first (now-playing) item;
            // items that already carry their own subtitleVtt keep it.
            const items = queue!.filter(i => i.url).map((it, idx) =>
                idx === 0 && effectiveVtt && !it.subtitleVtt ? { ...it, subtitleVtt: effectiveVtt } : it
            );
            const res = await window.ipcRenderer.invoke('cast:play-queue', { deviceId: device.id, items })
                .catch(() => null) as { success: boolean } | null;
            success = !!res?.success;
        } else if (tailQueue && tailQueue.length > 1) {
            // Single episode → season queue from this episode onward, so ⏮/⏭
            // work and the next episode autoplays. The first item resumes at
            // the local player's position and carries the current subtitle.
            const items = tailQueue.map((it, idx) => idx === 0
                ? {
                    ...it,
                    startTime: typeof startPosition === 'number' && startPosition > 5 ? startPosition : undefined,
                    subtitleVtt: effectiveVtt && !it.subtitleVtt ? effectiveVtt : it.subtitleVtt,
                }
                : it
            );
            const res = await window.ipcRenderer.invoke('cast:play-queue', { deviceId: device.id, items })
                .catch(() => null) as { success: boolean } | null;
            success = !!res?.success;
            // Queue refused (older receiver?) — fall back to the single episode.
            if (!success) success = await castToChromecast(device);
        } else {
            success = await castToChromecast(device);
        }
        if (success) {
            onDeviceSelected({
                id: device.id,
                name: device.name,
                type: 'chromecast',
                available: true,
                cast: () => { }
            });
            setTimeout(() => onClose(), 500);
        } else {
            setCastError(t('cast', 'failedToTransmit'));
        }
        setCasting(false);
    }, [isQueue, queue, tailQueue, startPosition, effectiveVtt, castToChromecast, onClose, onDeviceSelected, t]);

    // Auto-discover on mount
    useEffect(() => {
        discoverDevices();
    }, [discoverDevices]);

    // Esc closes the picker (keyboard parity with the backdrop click / ✕).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Series episode (no explicit queue): resolve the rest of the season.
    useEffect(() => {
        if (isQueue || contentType !== 'series' || !contentId) return;
        if (typeof seasonNumber !== 'number' || typeof episodeNumber !== 'number') return;
        let cancelled = false;
        void buildSeasonTailQueue(contentId, seasonNumber, episodeNumber).then(items => {
            if (!cancelled && items.length > 1) setTailQueue(items);
        });
        return () => { cancelled = true; };
    }, [isQueue, contentType, contentId, seasonNumber, episodeNumber]);

    const allDevices = useMemo(() => {
        const devices: CastDevice[] = [];

        dlnaDevices.forEach(device => {
            devices.push({
                id: device.id,
                name: device.name,
                type: 'dlna',
                available: device.online,
                source: device.source,
                isSamsung: device.isSamsung,
                cast: () => handleCast(device)
            });
        });

        airplayDevices.forEach(device => {
            devices.push({
                id: device.id,
                name: device.name,
                type: 'airplay',
                available: device.available,
                source: 'discovered',
                cast: () => castToAirPlayDevice(device)
            });
        });

        chromecastDevices.forEach(device => {
            devices.push({
                id: device.id,
                name: device.name,
                type: 'chromecast',
                available: device.available,
                source: 'discovered',
                cast: () => { void handleChromecast(device); }
            });
        });

        return devices;
    }, [airplayDevices, castToAirPlayDevice, chromecastDevices, dlnaDevices, handleCast, handleChromecast]);

    const handleAddDevice = async () => {
        if (!deviceIP) {
            setCastError(t('cast', 'enterIP'));
            return;
        }

        const success = await addDevice(
            deviceName || `TV (${deviceIP})`,
            deviceIP,
            parseInt(devicePort) || 9197
        );

        if (success) {
            setView('list');
            setDeviceName('');
            setDeviceIP('');
            setDevicePort('9197');
            setCastError(null);
        } else {
            setCastError(dlnaError || t('cast', 'errorAddingDevice'));
        }
    };

    const getDeviceIcon = (type: string, source?: string) => {
        if (type === 'airplay') return '🍎';
        if (type === 'chromecast') return '📡';
        return source === 'discovered' ? '📺' : '🖥️';
    };

    const getDeviceTypeName = (type: string) => {
        switch (type) {
            case 'airplay': return 'Apple AirPlay';
            case 'chromecast': return 'Chromecast';
            default: return 'DLNA/UPnP';
        }
    };

    return (
        <>
            <style>{castStyles}</style>
            <div className="cast-overlay" onClick={onClose}>
                <div className="cast-modal" onClick={e => e.stopPropagation()}>
                    {/* Animated Background */}
                    <div className="cast-bg">
                        <div className="cast-orb orb-1" />
                        <div className="cast-orb orb-2" />
                    </div>

                    {/* Header */}
                    <div className="cast-header">
                        <div className="cast-title-row">
                            <div className="cast-icon">📺</div>
                            <div>
                                <h2 className="cast-title">{t('cast', 'title')}</h2>
                                <p className="cast-subtitle">{primaryTitle || t('cast', 'selectDevice')}</p>
                            </div>
                        </div>
                        <button className="cast-close" onClick={onClose}>✕</button>
                    </div>

                    {/* Content */}
                    {view === 'list' ? (
                        <div className="cast-content">
                            {/* Scan Button */}
                            <button
                                className={`scan-btn ${isDiscovering ? 'scanning' : ''}`}
                                onClick={() => discoverDevices()}
                                disabled={isDiscovering}
                            >
                                <span className="scan-icon">{isDiscovering ? '⏳' : '🔍'}</span>
                                <span>{isDiscovering ? t('cast', 'searching') : t('cast', 'searchNetwork')}</span>
                            </button>

                            {/* Attach an external subtitle (for VOD without embedded subs) */}
                            <button
                                className="scan-btn"
                                style={{ marginTop: 8, opacity: effectiveVtt ? 0.75 : 1 }}
                                onClick={() => void fetchSubtitle()}
                                disabled={subBusy}
                            >
                                <span className="scan-icon">{subBusy ? '⏳' : effectiveVtt ? '✅' : '💬'}</span>
                                <span>{effectiveVtt ? t('cast', 'subtitleReady') : t('cast', 'subtitleFetch')}</span>
                            </button>
                            {subMsg && !effectiveVtt && (
                                <div className="cast-error" style={{ background: 'transparent' }}><span>{subMsg}</span></div>
                            )}

                            {/* Queue note: only Chromecast plays the whole season */}
                            {isQueue && queue!.length > 1 && (
                                <div className="cast-help" style={{ marginBottom: 16 }}>
                                    <div className="help-icon">🎞️</div>
                                    <div className="help-text">
                                        {t('cast', 'queueHint').replace('{n}', String(queue!.length))}
                                    </div>
                                </div>
                            )}

                            {/* Error (cast attempt or device discovery) */}
                            {(castError || (!isDiscovering && dlnaError)) && (
                                <div className="cast-error">
                                    <span>⚠️</span>
                                    <span>{castError || dlnaError}</span>
                                </div>
                            )}

                            {/* Device List */}
                            <div className="device-list">
                                {allDevices.length === 0 ? (
                                    <div className="no-devices">
                                        <div className="no-devices-icon">📡</div>
                                        <p>{t('cast', 'noDevices')}</p>
                                        <p className="no-devices-hint">{t('cast', 'addManually')}</p>
                                    </div>
                                ) : (
                                    allDevices.map((device, index) => (
                                        <button
                                            key={device.id}
                                            className={`device-item ${casting ? 'disabled' : ''}`}
                                            onClick={() => device.cast()}
                                            style={{ animationDelay: `${index * 0.05}s` }}
                                            disabled={casting}
                                        >
                                            <div className="device-icon">
                                                {getDeviceIcon(device.type, device.source)}
                                            </div>
                                            <div className="device-info">
                                                <span className="device-name">{device.name}</span>
                                                <span className="device-type">
                                                    {device.isSamsung ? 'Samsung TV' : getDeviceTypeName(device.type)}
                                                    {device.source === 'discovered' && ' • ' + t('cast', 'discovered')}
                                                </span>
                                            </div>
                                            <div className="device-status">
                                                {device.available ? (
                                                    <span className="status-dot online" />
                                                ) : (
                                                    <span className="status-dot offline" />
                                                )}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>

                            {/* Add Device Button */}
                            <button className="add-device-btn" onClick={() => setView('add')}>
                                <span>➕</span>
                                <span>{t('cast', 'addTVManually')}</span>
                            </button>

                            {/* Help */}
                            <div className="cast-help">
                                <div className="help-icon">💡</div>
                                <div className="help-text">
                                    <strong>{t('cast', 'tip')}</strong> {t('cast', 'tipText')}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="cast-content">
                            <button className="back-btn" onClick={() => setView('list')}>
                                ← {t('cast', 'back')}
                            </button>

                            <h3 className="add-title">{t('cast', 'addSmartTV')}</h3>

                            {castError && (
                                <div className="cast-error">
                                    <span>⚠️</span>
                                    <span>{castError}</span>
                                </div>
                            )}

                            <div className="form-group">
                                <label>{t('cast', 'nameOptional')}</label>
                                <input
                                    type="text"
                                    value={deviceName}
                                    onChange={(e) => setDeviceName(e.target.value)}
                                    placeholder="Samsung TV, LG TV..."
                                    className="form-input"
                                />
                            </div>

                            <div className="form-group">
                                <label>{t('cast', 'ipAddress')} *</label>
                                <input
                                    type="text"
                                    value={deviceIP}
                                    onChange={(e) => setDeviceIP(e.target.value)}
                                    placeholder="192.168.1.100"
                                    className="form-input"
                                />
                            </div>

                            <div className="form-group">
                                <label>{t('cast', 'port')}</label>
                                <input
                                    type="text"
                                    value={devicePort}
                                    onChange={(e) => setDevicePort(e.target.value)}
                                    placeholder="9197"
                                    className="form-input"
                                />
                            </div>

                            <button className="submit-btn" onClick={handleAddDevice}>
                                {t('cast', 'addTV')}
                            </button>

                            <div className="cast-help">
                                <div className="help-icon">📺</div>
                                <div className="help-text">
                                    <strong>{t('cast', 'howToFindIP')}</strong> {t('cast', 'howToFindIPText')}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

const castStyles = `
/* Overlay */
.cast-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(8px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

/* Modal */
.cast-modal {
    position: relative;
    width: 90%;
    max-width: 480px;
    max-height: 85vh;
    background: linear-gradient(135deg, var(--ns-bg-panel) 0%, var(--ns-bg-tint) 100%);
    border: 1px solid rgba(var(--ns-accent-rgb), 0.2);
    border-radius: 24px;
    overflow: hidden;
    animation: modalSlide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modalSlide {
    from { opacity: 0; transform: scale(0.95) translateY(20px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}

/* Background Orbs */
.cast-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
}

.cast-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    opacity: 0.4;
}

.orb-1 {
    width: 200px;
    height: 200px;
    background: linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to));
    top: -50px;
    right: -50px;
    animation: orbFloat 8s ease-in-out infinite;
}

.orb-2 {
    width: 150px;
    height: 150px;
    background: linear-gradient(135deg, #3b82f6, #06b6d4);
    bottom: -30px;
    left: -30px;
    animation: orbFloat 10s ease-in-out infinite reverse;
}

@keyframes orbFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(20px, -20px) scale(1.1); }
}

/* Header */
.cast-header {
    position: relative;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.cast-title-row {
    display: flex;
    align-items: center;
    gap: 16px;
}

.cast-icon {
    font-size: 36px;
    animation: iconPulse 2s ease-in-out infinite;
}

@keyframes iconPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
}

.cast-title {
    font-size: 24px;
    font-weight: 700;
    color: white;
    margin: 0;
    background: linear-gradient(135deg, #fff 0%, var(--ns-accent-light) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.cast-subtitle {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin: 4px 0 0 0;
    max-width: 200px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.cast-close {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.cast-close:hover {
    background: rgba(239, 68, 68, 0.3);
    transform: rotate(90deg);
}

/* Content */
.cast-content {
    position: relative;
    z-index: 10;
    padding: 24px;
    max-height: calc(85vh - 100px);
    overflow-y: auto;
}

/* Scan Button */
.scan-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 20px;
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(var(--ns-accent-rgb), 0.2));
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 12px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    margin-bottom: 16px;
}

.scan-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px rgba(59, 130, 246, 0.2);
}

.scan-btn.scanning {
    pointer-events: none;
}

.scan-icon {
    font-size: 18px;
}

.scanning .scan-icon {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* Error */
.cast-error {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 10px;
    color: #fca5a5;
    font-size: 14px;
    margin-bottom: 16px;
    animation: shake 0.4s ease;
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
}

/* Device List */
.device-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
}

.no-devices {
    text-align: center;
    padding: 40px 20px;
    color: rgba(255, 255, 255, 0.6);
}

.no-devices-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
    animation: float 3s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

.no-devices-hint {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 8px;
}

/* Device Item */
.device-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.3s ease;
    animation: itemSlide 0.4s ease backwards;
    text-align: left;
}

@keyframes itemSlide {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
}

.device-item:hover:not(.disabled) {
    background: rgba(var(--ns-accent-rgb), 0.1);
    border-color: rgba(var(--ns-accent-rgb), 0.3);
    transform: translateX(4px);
}

.device-item.disabled {
    opacity: 0.5;
    pointer-events: none;
}

.device-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.2), rgba(var(--ns-accent-grad-to-rgb), 0.2));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
}

.device-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.device-name {
    color: white;
    font-size: 16px;
    font-weight: 600;
}

.device-type {
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
}

.device-status {
    padding-right: 8px;
}

.status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: block;
}

.status-dot.online {
    background: #10b981;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
    animation: pulse 2s ease-in-out infinite;
}

.status-dot.offline {
    background: #6b7280;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* Add Device Button */
.add-device-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px;
    background: transparent;
    border: 2px dashed rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    margin-bottom: 16px;
}

.add-device-btn:hover {
    border-color: rgba(var(--ns-accent-rgb), 0.5);
    color: white;
    background: rgba(var(--ns-accent-rgb), 0.1);
}

/* Help */
.cast-help {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 12px;
}

.help-icon {
    font-size: 20px;
}

.help-text {
    font-size: 13px;
    color: #93c5fd;
    line-height: 1.5;
}

/* Back Button */
.back-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    cursor: pointer;
    padding: 8px 0;
    margin-bottom: 16px;
    transition: color 0.2s ease;
}

.back-btn:hover {
    color: white;
}

/* Add Title */
.add-title {
    font-size: 20px;
    font-weight: 700;
    color: white;
    margin: 0 0 20px 0;
}

/* Form */
.form-group {
    margin-bottom: 16px;
}

.form-group label {
    display: block;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    margin-bottom: 8px;
}

.form-input {
    width: 100%;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: white;
    font-size: 15px;
    transition: all 0.2s ease;
}

.form-input:focus {
    outline: none;
    border-color: rgba(var(--ns-accent-rgb), 0.5);
    box-shadow: 0 0 0 3px rgba(var(--ns-accent-rgb), 0.1);
}

.form-input::placeholder {
    color: rgba(255, 255, 255, 0.3);
}

/* Submit Button */
.submit-btn {
    width: 100%;
    padding: 14px 24px;
    background: linear-gradient(135deg, var(--ns-accent) 0%, var(--ns-accent-grad-to) 100%);
    border: none;
    border-radius: 12px;
    color: white;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    margin-bottom: 16px;
}

.submit-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px rgba(var(--ns-accent-rgb), 0.3);
}

.submit-btn:active {
    transform: translateY(0);
}
`;
