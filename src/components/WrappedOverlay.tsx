import { useMemo, useState } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { buildWrapped, type WrappedData, type WrappedPersona } from '../services/wrappedHelpers';
import { usageStatsService } from '../services/usageStatsService';
import { useLanguage } from '../services/languageService';

// NeoStream Wrapped: a slide-based retrospective of the profile's watching,
// opened from the stats dashboard. Pure data via buildWrapped(); this
// component is presentation + slide navigation only.

const PERSONA_EMOJI: Record<WrappedPersona, string> = {
    cinephile: '🎬',
    binger: '📺',
    zapper: '⚡',
    explorer: '🧭',
};

const TYPE_EMOJI: Record<string, string> = { movie: '🎬', series: '📺', live: '📡' };

export function WrappedOverlay({ onClose }: { onClose: () => void }) {
    const { t, language } = useLanguage();
    const wrapped: WrappedData = useMemo(() => buildWrapped(usageStatsService.getStats()), []);
    const [slide, setSlide] = useState(0);

    const weekdayName = (day: number) => {
        const locale = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }[language] ?? 'pt-BR';
        // 2026-06-07 was a Sunday; offset picks the wanted weekday.
        const base = new Date(2026, 5, 7 + day);
        return base.toLocaleDateString(locale, { weekday: 'long' });
    };

    const slides: React.ReactNode[] = [];

    slides.push(
        <div className="wrapped-slide" key="hours">
            <span className="wrapped-kicker">{t('wrapped', 'kicker')}</span>
            <span className="wrapped-big">{wrapped.totalHours}h</span>
            <p>{t('wrapped', 'hoursLine')}</p>
            {wrapped.distinctTitles > 0 && (
                <p className="wrapped-sub">
                    {t('wrapped', 'titlesLine').replace('{n}', String(wrapped.distinctTitles))}
                </p>
            )}
        </div>
    );

    slides.push(
        <div className="wrapped-slide" key="persona">
            <span className="wrapped-kicker">{t('wrapped', 'personaKicker')}</span>
            <span className="wrapped-big">{PERSONA_EMOJI[wrapped.persona]}</span>
            <h3>{t('wrapped', `persona_${wrapped.persona}`)}</h3>
            <div className="wrapped-share">
                <span>🎬 {wrapped.share.movies}%</span>
                <span>📺 {wrapped.share.series}%</span>
                <span>📡 {wrapped.share.live}%</span>
            </div>
        </div>
    );

    if (wrapped.topContent.length > 0) {
        slides.push(
            <div className="wrapped-slide" key="top">
                <span className="wrapped-kicker">{t('wrapped', 'topKicker')}</span>
                <ol className="wrapped-top-list">
                    {wrapped.topContent.map((item, index) => (
                        <li key={`${item.name}-${index}`}>
                            <span className="wrapped-top-rank">{index + 1}</span>
                            <span className="wrapped-top-name">{TYPE_EMOJI[item.type] ?? ''} {item.name}</span>
                            <span className="wrapped-top-hours">{Math.max(1, Math.round(item.seconds / 3600))}h</span>
                        </li>
                    ))}
                </ol>
            </div>
        );
    }

    slides.push(
        <div className="wrapped-slide" key="habits">
            <span className="wrapped-kicker">{t('wrapped', 'habitsKicker')}</span>
            <span className="wrapped-big">🔥 {wrapped.longestStreakDays}</span>
            <p>{t('wrapped', 'streakLine')}</p>
            {wrapped.busiestWeekday !== null && (
                <p className="wrapped-sub">
                    {t('wrapped', 'weekdayLine').replace('{day}', weekdayName(wrapped.busiestWeekday))}
                </p>
            )}
        </div>
    );

    const isLast = slide === slides.length - 1;

    return (
        <div className="wrapped-backdrop" onClick={onClose}>
            <style>{wrappedStyles}</style>
            <div className="wrapped-card" onClick={(e) => e.stopPropagation()}>
                <button className="wrapped-close" onClick={onClose} aria-label={t('wrapped', 'close')}>
                    <X size={18} />
                </button>

                {wrapped.empty ? (
                    <div className="wrapped-slide">
                        <span className="wrapped-big">🌱</span>
                        <h3>{t('wrapped', 'emptyTitle')}</h3>
                        <p>{t('wrapped', 'emptyDesc')}</p>
                    </div>
                ) : (
                    <>
                        {slides[slide]}
                        <div className="wrapped-nav">
                            <button
                                className="wrapped-nav-btn"
                                onClick={() => setSlide(s => Math.max(0, s - 1))}
                                disabled={slide === 0}
                                aria-label={t('wrapped', 'prev')}
                            >
                                <ChevronLeft size={18} />
                            </button>
                            <div className="wrapped-dots">
                                {slides.map((_, index) => (
                                    <span key={index} className={`wrapped-dot ${index === slide ? 'active' : ''}`} />
                                ))}
                            </div>
                            {isLast ? (
                                <button className="wrapped-nav-btn wrapped-done" onClick={onClose}>
                                    {t('wrapped', 'done')}
                                </button>
                            ) : (
                                <button
                                    className="wrapped-nav-btn"
                                    onClick={() => setSlide(s => Math.min(slides.length - 1, s + 1))}
                                    aria-label={t('wrapped', 'next')}
                                >
                                    <ChevronRight size={18} />
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const wrappedStyles = `
.wrapped-share {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 14px auto 0;
    padding: 8px 18px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    color: rgba(255, 255, 255, 0.85);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}

.wrapped-share:hover {
    background: rgba(255, 255, 255, 0.14);
}

.wrapped-share-msg {
    text-align: center;
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
    margin: 8px 0 0;
}

.wrapped-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100000;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
}

.wrapped-card {
    position: relative;
    width: min(440px, 92vw);
    min-height: 420px;
    border-radius: 24px;
    padding: 40px 32px 28px;
    background:
        radial-gradient(120% 90% at 10% 0%, rgba(99, 102, 241, 0.35), transparent 60%),
        radial-gradient(120% 90% at 90% 100%, rgba(236, 72, 153, 0.3), transparent 60%),
        #12121c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    flex-direction: column;
    animation: wrappedIn 0.4s ease;
}

@keyframes wrappedIn {
    from { opacity: 0; transform: scale(0.94); }
    to { opacity: 1; transform: scale(1); }
}

.wrapped-close {
    position: absolute;
    top: 14px;
    right: 14px;
    background: rgba(255, 255, 255, 0.08);
    border: none;
    border-radius: 50%;
    width: 34px;
    height: 34px;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.wrapped-slide {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 12px;
    color: white;
}

.wrapped-kicker {
    text-transform: uppercase;
    letter-spacing: 2px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.55);
}

.wrapped-big {
    font-size: 64px;
    font-weight: 800;
    line-height: 1;
    background: linear-gradient(135deg, #a5b4fc, #f0abfc);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
}

.wrapped-slide h3 {
    font-size: 22px;
    margin: 0;
}

.wrapped-slide p {
    color: rgba(255, 255, 255, 0.75);
    margin: 0;
    font-size: 14px;
}

.wrapped-sub {
    font-size: 13px !important;
    color: rgba(255, 255, 255, 0.5) !important;
}

.wrapped-share {
    display: flex;
    gap: 16px;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.85);
    margin-top: 8px;
}

.wrapped-top-list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.wrapped-top-list li {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 10px 14px;
    text-align: left;
}

.wrapped-top-rank {
    font-weight: 800;
    font-size: 18px;
    color: #a5b4fc;
    min-width: 20px;
}

.wrapped-top-name {
    flex: 1;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.wrapped-top-hours {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
}

.wrapped-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 20px;
}

.wrapped-nav-btn {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    border-radius: 10px;
    color: white;
    padding: 8px 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
}

.wrapped-nav-btn:disabled {
    opacity: 0.3;
    cursor: default;
}

.wrapped-done {
    background: linear-gradient(135deg, var(--ns-accent-dark), var(--ns-accent));
}

.wrapped-dots {
    display: flex;
    gap: 6px;
}

.wrapped-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    transition: all 0.25s ease;
}

.wrapped-dot.active {
    background: white;
    width: 20px;
    border-radius: 4px;
}
`;
