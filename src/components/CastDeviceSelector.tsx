import { useState, useEffect } from 'react';
import { useDLNA } from '../hooks/useDLNA';
import { useAirPlay } from '../hooks/useAirPlay';
import { useLanguage } from '../services/languageService';

export interface CastDevice {
    id: string;
    name: string;
    type: 'chromecast' | 'dlna' | 'airplay';
    available: boolean;
    source?: 'discovered' | 'manual';
    cast: () => void;
}

interface CastDeviceSelectorProps {
    videoUrl: string;
    videoTitle: string;
    onClose: () => void;
    onDeviceSelected: (device: CastDevice) => void;
    chromecastAvailable: boolean;
    chromecastCasting: boolean;
    onChromecastCast: () => void;
}

export function CastDeviceSelector({
    videoUrl,
    videoTitle,
    onClose,
    onDeviceSelected,
    chromecastAvailable,
    chromecastCasting,
    onChromecastCast
}: CastDeviceSelectorProps) {
    const dlna = useDLNA(videoUrl, videoTitle);
    const airplay = useAirPlay(videoUrl, videoTitle);
    const [allDevices, setAllDevices] = useState<CastDevice[]>([]);
    const [view, setView] = useState<'list' | 'add'>('list');
    const [deviceName, setDeviceName] = useState('');
    const [deviceIP, setDeviceIP] = useState('');
    const [devicePort, setDevicePort] = useState('8080');
    const [casting, setCasting] = useState(false);
    const [castError, setCastError] = useState<string | null>(null);
    const { t } = useLanguage();

    // Auto-discover on mount
    useEffect(() => {
        dlna.discoverDevices();
    }, []);

    // Combine all devices
    useEffect(() => {
        const devices: CastDevice[] = [];

        // Add Chromecast
        if (chromecastAvailable) {
            devices.push({
                id: 'chromecast-default',
                name: chromecastCasting ? 'Chromecast (' + t('cast', 'connected') + ')' : 'Chromecast',
                type: 'chromecast',
                available: true,
                source: 'discovered',
                cast: onChromecastCast
            });
        }

        // Add DLNA devices
        dlna.devices.forEach(device => {
            devices.push({
                id: device.id,
                name: device.name,
                type: 'dlna',
                available: device.online,
                source: device.source,
                cast: () => handleCast(device)
            });
        });

        // Add AirPlay devices
        airplay.devices.forEach(device => {
            devices.push({
                id: device.id,
                name: device.name,
                type: 'airplay',
                available: device.available,
                source: 'discovered',
                cast: () => airplay.castToDevice(device)
            });
        });

        setAllDevices(devices);
    }, [chromecastAvailable, chromecastCasting, dlna.devices, airplay.devices]);

    const handleCast = async (device: any) => {
        setCasting(true);
        setCastError(null);

        const success = await dlna.castToDevice(device);

        if (success) {
            onDeviceSelected({
                id: device.id,
                name: device.name,
                type: 'dlna',
                available: true,
                cast: () => { }
            });
            setTimeout(() => onClose(), 500);
        } else {
            setCastError(dlna.error || t('cast', 'failedToTransmit'));
        }
        setCasting(false);
    };

    const handleAddDevice = async () => {
        if (!deviceIP) {
            setCastError(t('cast', 'enterIP'));
            return;
        }

        const success = await dlna.addDevice(
            deviceName || `TV (${deviceIP})`,
            deviceIP,
            parseInt(devicePort) || 8080
        );

        if (success) {
            setView('list');
            setDeviceName('');
            setDeviceIP('');
            setDevicePort('8080');
            setCastError(null);
        } else {
            setCastError(dlna.error || t('cast', 'errorAddingDevice'));
        }
    };

    const getDeviceIcon = (type: string, source?: string) => {
        if (type === 'chromecast') return '📡';
        if (type === 'airplay') return '🍎';
        return source === 'discovered' ? '📺' : '🖥️';
    };

    const getDeviceTypeName = (type: string) => {
        switch (type) {
            case 'chromecast': return 'Google Cast';
            case 'airplay': return 'Apple AirPlay';
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
                                <p className="cast-subtitle">{videoTitle || t('cast', 'selectDevice')}</p>
                            </div>
                        </div>
                        <button className="cast-close" onClick={onClose}>✕</button>
                    </div>

                    {/* Content */}
                    {view === 'list' ? (
                        <div className="cast-content">
                            {/* Scan Button */}
                            <button
                                className={`scan-btn ${dlna.isDiscovering ? 'scanning' : ''}`}
                                onClick={() => dlna.discoverDevices()}
                                disabled={dlna.isDiscovering}
                            >
                                <span className="scan-icon">{dlna.isDiscovering ? '⏳' : '🔍'}</span>
                                <span>{dlna.isDiscovering ? t('cast', 'searching') : t('cast', 'searchNetwork')}</span>
                            </button>

                            {/* Error */}
                            {castError && (
                                <div className="cast-error">
                                    <span>⚠️</span>
                                    <span>{castError}</span>
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
                                                    {getDeviceTypeName(device.type)}
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
                                    placeholder="8080"
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
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(168, 85, 247, 0.2);
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
    background: linear-gradient(135deg, #a855f7, #ec4899);
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
    background: linear-gradient(135deg, #fff 0%, #c4b5fd 100%);
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
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2));
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
    background: rgba(168, 85, 247, 0.1);
    border-color: rgba(168, 85, 247, 0.3);
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
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2));
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
    border-color: rgba(168, 85, 247, 0.5);
    color: white;
    background: rgba(168, 85, 247, 0.1);
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
    border-color: rgba(168, 85, 247, 0.5);
    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.1);
}

.form-input::placeholder {
    color: rgba(255, 255, 255, 0.3);
}

/* Submit Button */
.submit-btn {
    width: 100%;
    padding: 14px 24px;
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
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
    box-shadow: 0 10px 30px rgba(168, 85, 247, 0.3);
}

.submit-btn:active {
    transform: translateY(0);
}
`;
