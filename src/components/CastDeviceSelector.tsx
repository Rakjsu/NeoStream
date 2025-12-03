import { useState, useEffect } from 'react';
import { FaTv, FaChromecast, FaApple, FaTimes, FaSync } from 'react-icons/fa';
import { useDLNA, type DLNADevice } from '../hooks/useDLNA';

export interface CastDevice {
    id: string;
    name: string;
    type: 'chromecast' | 'dlna' | 'airplay';
    available: boolean;
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
    const [allDevices, setAllDevices] = useState<CastDevice[]>([]);

    // Combine all devices from different protocols
    useEffect(() => {
        const devices: CastDevice[] = [];

        // Add Chromecast if available
        if (chromecastAvailable) {
            devices.push({
                id: 'chromecast-default',
                name: chromecastCasting ? 'Chromecast (Connected)' : 'Chromecast',
                type: 'chromecast',
                available: true,
                cast: onChromecastCast
            });
        }

        // Add DLNA devices
        dlna.devices.forEach(device => {
            devices.push({
                id: device.id,
                name: device.name,
                type: 'dlna',
                available: device.available,
                cast: () => dlna.castToDevice(device)
            });
        });

        setAllDevices(devices);
    }, [chromecastAvailable, chromecastCasting, dlna.devices, onChromecastCast]);

    const getDeviceIcon = (type: string) => {
        switch (type) {
            case 'chromecast':
                return <FaChromecast />;
            case 'dlna':
                return <FaTv />;
            case 'airplay':
                return <FaApple />;
            default:
                return <FaTv />;
        }
    };

    const getDeviceTypeName = (type: string) => {
        switch (type) {
            case 'chromecast':
                return 'Chromecast';
            case 'dlna':
                return 'DLNA/UPnP';
            case 'airplay':
                return 'AirPlay';
            default:
                return 'Unknown';
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <div style={{
                backgroundColor: '#1f2937',
                borderRadius: '16px',
                padding: '24px',
                maxWidth: '500px',
                width: '90%',
                maxHeight: '80vh',
                overflow: 'auto'
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h2 style={{
                        color: 'white',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        margin: 0
                    }}>
                        Cast to Device
                    </h2>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={dlna.discoverDevices}
                            style={{
                                background: 'rgba(37, 99, 235, 0.2)',
                                border: '1px solid rgba(37, 99, 235, 0.3)',
                                borderRadius: '8px',
                                padding: '8px 12px',
                                color: '#60a5fa',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            <FaSync />
                            Refresh
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#9ca3af',
                                fontSize: '24px',
                                cursor: 'pointer',
                                padding: '4px'
                            }}
                        >
                            <FaTimes />
                        </button>
                    </div>
                </div>

                {/* Device List */}
                {allDevices.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '40px 20px',
                        color: '#9ca3af'
                    }}>
                        <FaTv style={{ fontSize: '48px', marginBottom: '16px' }} />
                        <p style={{ margin: 0, fontSize: '16px' }}>
                            No devices found
                        </p>
                        <p style={{ margin: '8px 0 0 0', fontSize: '14px' }}>
                            Make sure devices are on the same network
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {allDevices.map(device => (
                            <button
                                key={device.id}
                                onClick={() => {
                                    device.cast();
                                    onDeviceSelected(device);
                                    onClose();
                                }}
                                style={{
                                    background: 'rgba(55, 65, 81, 0.5)',
                                    border: '1px solid rgba(75, 85, 99, 0.5)',
                                    borderRadius: '12px',
                                    padding: '16px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '16px',
                                    transition: 'all 0.2s',
                                    textAlign: 'left'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(37, 99, 235, 0.2)';
                                    e.currentTarget.style.borderColor = 'rgba(37, 99, 235, 0.5)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(55, 65, 81, 0.5)';
                                    e.currentTarget.style.borderColor = 'rgba(75, 85, 99, 0.5)';
                                }}
                            >
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '12px',
                                    background: 'rgba(37, 99, 235, 0.2)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#60a5fa',
                                    fontSize: '24px'
                                }}>
                                    {getDeviceIcon(device.type)}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        color: 'white',
                                        fontSize: '16px',
                                        fontWeight: '600',
                                        marginBottom: '4px'
                                    }}>
                                        {device.name}
                                    </div>
                                    <div style={{
                                        color: '#9ca3af',
                                        fontSize: '14px'
                                    }}>
                                        {getDeviceTypeName(device.type)}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* Info */}
                <div style={{
                    marginTop: '20px',
                    padding: '16px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    borderRadius: '8px',
                    border: '1px solid rgba(59, 130, 246, 0.2)'
                }}>
                    <p style={{
                        color: '#93c5fd',
                        fontSize: '14px',
                        margin: 0
                    }}>
                        💡 Tip: Make sure your casting device is on the same network
                    </p>
                </div>
            </div>
        </div>
    );
}
