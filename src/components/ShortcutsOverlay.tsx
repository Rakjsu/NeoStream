import { useEffect, useState } from 'react';
import { useLanguage } from '../services/languageService';
import { keymapService, type PlayerAction } from '../services/keymapService';

/**
 * Keyboard shortcuts cheatsheet: "?" opens it anywhere in the dashboard
 * (ignored while typing in an input). Esc or clicking outside closes.
 * As letras do player são personalizáveis: clique na tecla destacada e
 * pressione a nova (o keymapService valida reservas e conflitos).
 */

interface ShortcutRow {
    keys: string[];
    label: string;
    /** Ação cuja letra (último kbd da linha) é clicável pra reatribuir. */
    action?: PlayerAction;
}

interface ShortcutGroup {
    title: string;
    rows: ShortcutRow[];
}

export function ShortcutsOverlay() {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<PlayerAction | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [letters, setLetters] = useState(() => keymapService.getLetters());
    const { t } = useLanguage();

    useEffect(() => {
        const refresh = () => setLetters(keymapService.getLetters());
        window.addEventListener('neostream:keymap', refresh);
        return () => window.removeEventListener('neostream:keymap', refresh);
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const isTyping = !!target && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.isContentEditable
            );
            // Modo captura de tecla: a próxima tecla vira a nova letra da ação.
            if (open && editing) {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Escape') {
                    setEditing(null);
                    setFeedback(null);
                    return;
                }
                const result = keymapService.setLetter(editing, e.key);
                if (result === 'ok') {
                    setEditing(null);
                    setFeedback(null);
                } else if (result === 'conflict') {
                    setFeedback(t('shortcuts', 'keyInUse'));
                } else {
                    setFeedback(t('shortcuts', 'keyReserved'));
                }
                return;
            }
            if (e.key === '?' && !isTyping) {
                e.preventDefault();
                setOpen(prev => !prev);
            } else if (e.key === 'Escape' && open) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
            }
        };
        // Captura: com o overlay aberto, as teclas não vazam pro player.
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [open, editing, t]);

    if (!open) return null;

    const L = (action: PlayerAction) => letters[action].toUpperCase();

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
                { keys: ['Espaço', L('togglePlay')], label: t('shortcuts', 'playPause'), action: 'togglePlay' },
                { keys: ['←', L('seekBack')], label: t('shortcuts', 'seekBack'), action: 'seekBack' },
                { keys: ['→', L('seekForward')], label: t('shortcuts', 'seekForward'), action: 'seekForward' },
                { keys: ['Shift', '←/→'], label: t('shortcuts', 'seek30') },
                { keys: [',', '.'], label: t('shortcuts', 'frameStep') },
                { keys: [L('abLoop')], label: t('shortcuts', 'abLoop'), action: 'abLoop' },
                { keys: [L('bookmark')], label: t('shortcuts', 'bookmark'), action: 'bookmark' },
                { keys: ['Shift', L('bookmark')], label: t('shortcuts', 'bookmarkList') },
                { keys: [L('stats')], label: t('shortcuts', 'nerdStats'), action: 'stats' },
                { keys: [L('screenshot')], label: t('shortcuts', 'screenshot'), action: 'screenshot' },
                { keys: ['↑', '↓'], label: t('shortcuts', 'volume') },
                { keys: [L('mute')], label: t('shortcuts', 'mute'), action: 'mute' },
                { keys: [L('fullscreen')], label: t('shortcuts', 'fullscreen'), action: 'fullscreen' },
                { keys: [L('subtitles')], label: t('shortcuts', 'subtitles'), action: 'subtitles' }
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

    const kbdStyle: React.CSSProperties = {
        padding: '3px 8px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderBottomWidth: 2,
        color: 'white',
        fontSize: 11.5,
        fontFamily: 'inherit',
        fontWeight: 600
    };

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
                                            {row.keys.map((key, index) => {
                                                const isEditable = !!row.action && index === row.keys.length - 1;
                                                if (!isEditable) {
                                                    return <kbd key={`${key}-${index}`} style={kbdStyle}>{key}</kbd>;
                                                }
                                                const isEditing = editing === row.action;
                                                return (
                                                    <kbd
                                                        key={`${key}-${index}`}
                                                        role="button"
                                                        tabIndex={0}
                                                        title={t('shortcuts', 'customize')}
                                                        onClick={() => {
                                                            setEditing(isEditing ? null : row.action!);
                                                            setFeedback(null);
                                                        }}
                                                        style={{
                                                            ...kbdStyle,
                                                            cursor: 'pointer',
                                                            borderColor: isEditing ? 'var(--ns-accent)' : 'rgba(var(--ns-accent-rgb), 0.55)',
                                                            background: isEditing ? 'rgba(var(--ns-accent-rgb), 0.3)' : 'rgba(var(--ns-accent-rgb), 0.12)'
                                                        }}
                                                    >
                                                        {isEditing ? '…' : key}
                                                    </kbd>
                                                );
                                            })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* ⌨️ Personalização das letras do player */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 22, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                        {editing ? t('shortcuts', 'pressKey') : t('shortcuts', 'customize')}
                        {feedback ? <span style={{ color: '#f87171' }}> · {feedback}</span> : null}
                    </span>
                    <button
                        onClick={() => {
                            keymapService.resetLetters();
                            setEditing(null);
                            setFeedback(null);
                        }}
                        style={{
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: 8,
                            background: 'rgba(255,255,255,0.06)',
                            color: 'rgba(255,255,255,0.75)',
                            fontSize: 12,
                            padding: '6px 12px',
                            cursor: 'pointer',
                            flexShrink: 0
                        }}
                    >
                        {t('shortcuts', 'resetKeys')}
                    </button>
                </div>
            </div>
        </div>
    );
}
