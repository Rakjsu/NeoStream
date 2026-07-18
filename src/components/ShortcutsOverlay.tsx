import { useEffect, useState } from 'react';
import { useLanguage } from '../services/languageService';

/**
 * Keyboard shortcuts cheatsheet: "?" opens it anywhere in the dashboard
 * (ignored while typing in an input). Esc or clicking outside closes.
 */

interface ShortcutRow {
    keys: string[];
    label: string;
}

interface ShortcutGroup {
    title: string;
    rows: ShortcutRow[];
}

export function ShortcutsOverlay() {
    const [open, setOpen] = useState(false);
    const { t } = useLanguage();

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const isTyping = !!target && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.isContentEditable
            );
            if (e.key === '?' && !isTyping) {
                e.preventDefault();
                setOpen(prev => !prev);
            } else if (e.key === 'Escape' && open) {
                e.preventDefault();
                setOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open]);

    if (!open) return null;

    const groups: ShortcutGroup[] = [
        {
            title: t('shortcuts', 'groupGeneral'),
            rows: [
                { keys: ['Ctrl', 'K'], label: t('shortcuts', 'globalSearch') },
                { keys: ['?'], label: t('shortcuts', 'thisOverlay') },
                { keys: ['Esc'], label: t('shortcuts', 'closeOverlays') }
            ]
        },
        {
            title: t('shortcuts', 'groupPlayer'),
            rows: [
                { keys: ['Espaço', 'K'], label: t('shortcuts', 'playPause') },
                { keys: ['←', '→', 'J', 'L'], label: t('shortcuts', 'seek') },
                { keys: [',', '.'], label: t('shortcuts', 'frameStep') },
                { keys: ['B'], label: t('shortcuts', 'abLoop') },
                { keys: ['I'], label: t('shortcuts', 'nerdStats') },
                { keys: ['S'], label: t('shortcuts', 'screenshot') },
                { keys: ['↑', '↓'], label: t('shortcuts', 'volume') },
                { keys: ['M'], label: t('shortcuts', 'mute') },
                { keys: ['F'], label: t('shortcuts', 'fullscreen') },
                { keys: ['C'], label: t('shortcuts', 'subtitles') }
            ]
        },
        {
            title: t('shortcuts', 'groupLive'),
            rows: [
                { keys: ['PgUp', 'PgDn'], label: t('shortcuts', 'zapping') },
                { keys: ['0–9'], label: t('shortcuts', 'digitJump') },
                { keys: ['↑', '↓'], label: t('shortcuts', 'pipZap') }
            ]
        },
        {
            title: t('shortcuts', 'groupPip'),
            rows: [
                { keys: ['F9'], label: t('shortcuts', 'clickThrough') },
                { keys: ['Espaço'], label: t('shortcuts', 'playPause') },
                { keys: ['M'], label: t('shortcuts', 'mute') }
            ]
        }
    ];

    return (
        <div
            onClick={() => setOpen(false)}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                style={{
                    width: '90%',
                    maxWidth: 680,
                    maxHeight: '80vh',
                    overflowY: 'auto',
                    background: 'linear-gradient(135deg, var(--ns-bg-panel, #181829) 0%, var(--ns-bg-deep, #0f0f1e) 100%)',
                    border: '1px solid rgba(var(--ns-accent-rgb), 0.3)',
                    borderRadius: 20,
                    padding: 28
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <h2 style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: 0 }}>
                        ⌨️ {t('shortcuts', 'title')}
                    </h2>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Esc</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
                    {groups.map(group => (
                        <div key={group.title}>
                            <div style={{ color: 'var(--ns-accent-light, #93c5fd)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>
                                {group.title}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {group.rows.map(row => (
                                    <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>{row.label}</span>
                                        <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                            {row.keys.map(key => (
                                                <kbd
                                                    key={key}
                                                    style={{
                                                        padding: '3px 8px',
                                                        borderRadius: 6,
                                                        background: 'rgba(255,255,255,0.08)',
                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                        borderBottomWidth: 2,
                                                        color: 'white',
                                                        fontSize: 11.5,
                                                        fontFamily: 'inherit',
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    {key}
                                                </kbd>
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
