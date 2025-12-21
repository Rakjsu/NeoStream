import React, { useState, useEffect } from 'react';
import './CustomTitleBar.css';
import { useLanguage } from '../../services/languageService';

export function CustomTitleBar() {
    const [isMaximized, setIsMaximized] = useState(false);
    const { t } = useLanguage();

    useEffect(() => {
        // Check initial state
        const checkMaximized = async () => {
            if (window.ipcRenderer) {
                const result = await window.ipcRenderer.invoke('window:is-maximized');
                setIsMaximized(result);
            }
        };
        checkMaximized();

        // Listen for resize events to update state
        const handleResize = () => {
            checkMaximized();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleMinimize = () => {
        // Add minimize animation
        document.body.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
        document.body.style.opacity = '0';
        document.body.style.transform = 'scale(0.95) translateY(20px)';

        setTimeout(() => {
            window.ipcRenderer?.invoke('window:minimize');
            // Reset styles after minimize
            setTimeout(() => {
                document.body.style.opacity = '1';
                document.body.style.transform = 'scale(1) translateY(0)';
            }, 100);
        }, 150);
    };

    const handleMaximize = async () => {
        // Add maximize/restore animation
        document.body.style.transition = 'opacity 0.1s ease, transform 0.1s ease';
        document.body.style.opacity = '0.8';
        document.body.style.transform = 'scale(0.98)';

        setTimeout(async () => {
            await window.ipcRenderer?.invoke('window:maximize');
            const result = await window.ipcRenderer?.invoke('window:is-maximized');
            setIsMaximized(result);

            // Animate back
            document.body.style.opacity = '1';
            document.body.style.transform = 'scale(1)';
        }, 100);
    };

    const handleClose = () => {
        // Add close animation
        document.body.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        document.body.style.opacity = '0';
        document.body.style.transform = 'scale(0.9)';

        setTimeout(() => {
            window.ipcRenderer?.invoke('window:close');
        }, 200);
    };

    return (
        <div className="custom-title-bar">
            {/* Drag region - allows window dragging */}
            <div className="title-bar-drag-region">
                <div className="title-bar-logo">
                    <img src="/neostream-logo.png" alt="NeoStream" className="title-bar-icon" />
                    <span className="title-bar-text">NeoStream</span>
                </div>
            </div>

            {/* Window controls */}
            <div className="window-controls">
                <button
                    className="window-control-btn minimize"
                    onClick={handleMinimize}
                    title={t('window', 'minimize')}
                >
                    <svg width="12" height="12" viewBox="0 0 12 12">
                        <rect width="10" height="1" x="1" y="6" fill="currentColor" />
                    </svg>
                </button>

                <button
                    className="window-control-btn maximize"
                    onClick={handleMaximize}
                    title={isMaximized ? t('window', 'restore') : t('window', 'maximize')}
                >
                    {isMaximized ? (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <rect width="8" height="8" x="1" y="3" fill="none" stroke="currentColor" strokeWidth="1" />
                            <polyline points="3,3 3,1 11,1 11,9 9,9" fill="none" stroke="currentColor" strokeWidth="1" />
                        </svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <rect width="10" height="10" x="1" y="1" fill="none" stroke="currentColor" strokeWidth="1" />
                        </svg>
                    )}
                </button>

                <button
                    className="window-control-btn close"
                    onClick={handleClose}
                    title={t('window', 'close')}
                >
                    <svg width="12" height="12" viewBox="0 0 12 12">
                        <path d="M1,1 L11,11 M11,1 L1,11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
