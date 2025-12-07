import { useEffect, useState } from 'react';

interface ResumeModalProps {
    seriesName: string;
    seasonNumber: number;
    episodeNumber: number;
    currentTime: number;
    duration: number;
    onResume: () => void;
    onRestart: () => void;
    onCancel: () => void;
}

export function ResumeModal({
    seriesName,
    seasonNumber,
    episodeNumber,
    currentTime,
    duration,
    onResume,
    onRestart,
    onCancel
}: ResumeModalProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [progressAnimated, setProgressAnimated] = useState(0);

    const formatTime = (seconds: number): string => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = Math.round((currentTime / duration) * 100);
    const remainingTime = duration - currentTime;

    // Animate on mount
    useEffect(() => {
        requestAnimationFrame(() => setIsVisible(true));
        // Animate progress bar
        const timer = setTimeout(() => setProgressAnimated(progress), 100);
        return () => clearTimeout(timer);
    }, [progress]);

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: isVisible ? 'rgba(0, 0, 0, 0.9)' : 'rgba(0, 0, 0, 0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                backdropFilter: isVisible ? 'blur(20px)' : 'blur(0px)',
                transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            onClick={onCancel}
        >
            <style>{`
                @keyframes modalSlideIn {
                    from {
                        opacity: 0;
                        transform: translateY(30px) scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                @keyframes iconPulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
                @keyframes progressGlow {
                    0%, 100% { box-shadow: 0 0 20px rgba(168, 85, 247, 0.4); }
                    50% { box-shadow: 0 0 40px rgba(168, 85, 247, 0.8); }
                }
                @keyframes shimmer {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                }
                @keyframes floatIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes ringPulse {
                    0% { transform: scale(0.8); opacity: 0.5; }
                    50% { transform: scale(1.2); opacity: 0; }
                    100% { transform: scale(0.8); opacity: 0; }
                }
            `}</style>

            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'linear-gradient(145deg, rgba(30, 30, 50, 0.95) 0%, rgba(15, 15, 30, 0.98) 100%)',
                    borderRadius: 24,
                    padding: 0,
                    maxWidth: 420,
                    width: '92%',
                    boxShadow: '0 40px 100px -20px rgba(0, 0, 0, 0.8), 0 0 80px rgba(168, 85, 247, 0.15)',
                    border: '1px solid rgba(168, 85, 247, 0.25)',
                    overflow: 'hidden',
                    animation: isVisible ? 'modalSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards' : 'none'
                }}
            >
                {/* Decorative gradient header */}
                <div style={{
                    height: 6,
                    background: 'linear-gradient(90deg, #a855f7, #ec4899, #f97316, #a855f7)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 3s linear infinite'
                }} />

                {/* Content */}
                <div style={{ padding: '32px 28px' }}>
                    {/* Icon with animated rings */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        marginBottom: 24,
                        position: 'relative'
                    }}>
                        {/* Animated rings */}
                        <div style={{
                            position: 'absolute',
                            width: 100,
                            height: 100,
                            borderRadius: '50%',
                            border: '2px solid rgba(168, 85, 247, 0.3)',
                            animation: 'ringPulse 2s ease-out infinite'
                        }} />
                        <div style={{
                            position: 'absolute',
                            width: 100,
                            height: 100,
                            borderRadius: '50%',
                            border: '2px solid rgba(236, 72, 153, 0.3)',
                            animation: 'ringPulse 2s ease-out 0.5s infinite'
                        }} />

                        {/* Main icon */}
                        <div style={{
                            width: 80,
                            height: 80,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            animation: 'iconPulse 2s ease-in-out infinite',
                            border: '2px solid rgba(168, 85, 247, 0.4)'
                        }}>
                            <span style={{ fontSize: 36 }}>⏯️</span>
                        </div>
                    </div>

                    {/* Title */}
                    <h2 style={{
                        color: 'white',
                        fontSize: 22,
                        fontWeight: 700,
                        textAlign: 'center',
                        marginBottom: 8,
                        letterSpacing: '-0.02em',
                        animation: 'floatIn 0.5s ease 0.1s both'
                    }}>
                        Continuar de onde parou?
                    </h2>

                    {/* Series info */}
                    <div style={{
                        textAlign: 'center',
                        marginBottom: 24,
                        animation: 'floatIn 0.5s ease 0.2s both'
                    }}>
                        <p style={{
                            color: 'rgba(255, 255, 255, 0.9)',
                            fontSize: 15,
                            fontWeight: 600,
                            marginBottom: 4
                        }}>
                            {seriesName}
                        </p>
                        <p style={{
                            color: 'rgba(168, 85, 247, 0.9)',
                            fontSize: 13,
                            fontWeight: 500
                        }}>
                            T{seasonNumber} · Episódio {episodeNumber}
                        </p>
                    </div>

                    {/* Progress card */}
                    <div style={{
                        background: 'rgba(0, 0, 0, 0.4)',
                        borderRadius: 16,
                        padding: 20,
                        marginBottom: 24,
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        animation: 'floatIn 0.5s ease 0.3s both'
                    }}>
                        {/* Time labels */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 16
                        }}>
                            <div>
                                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                                    Parou em
                                </div>
                                <div style={{ color: '#a855f7', fontSize: 18, fontWeight: 700 }}>
                                    {formatTime(currentTime)}
                                </div>
                            </div>
                            <div style={{
                                width: 40,
                                height: 40,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 14,
                                fontWeight: 700,
                                color: '#a855f7'
                            }}>
                                {progress}%
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                                    Restante
                                </div>
                                <div style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: 18, fontWeight: 700 }}>
                                    {formatTime(remainingTime)}
                                </div>
                            </div>
                        </div>

                        {/* Animated progress bar */}
                        <div style={{
                            width: '100%',
                            height: 10,
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            borderRadius: 5,
                            overflow: 'hidden',
                            position: 'relative'
                        }}>
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: `${progressAnimated}%`,
                                height: '100%',
                                background: 'linear-gradient(90deg, #a855f7, #ec4899)',
                                borderRadius: 5,
                                transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
                                boxShadow: '0 0 20px rgba(168, 85, 247, 0.5)'
                            }}>
                                {/* Shimmer effect */}
                                <div style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)',
                                    animation: 'shimmer 2s linear infinite'
                                }} />
                            </div>
                            {/* Thumb indicator */}
                            <div style={{
                                position: 'absolute',
                                top: '50%',
                                left: `${progressAnimated}%`,
                                transform: 'translate(-50%, -50%)',
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                background: 'white',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                                border: '3px solid #a855f7',
                                transition: 'left 1s cubic-bezier(0.16, 1, 0.3, 1)',
                                animation: 'progressGlow 2s ease-in-out infinite'
                            }} />
                        </div>
                    </div>

                    {/* Buttons */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        animation: 'floatIn 0.5s ease 0.4s both'
                    }}>
                        {/* Resume button - Primary */}
                        <button
                            onClick={onResume}
                            style={{
                                padding: '16px 24px',
                                background: 'linear-gradient(135deg, #a855f7, #ec4899)',
                                color: 'white',
                                fontSize: 16,
                                fontWeight: 700,
                                borderRadius: 14,
                                border: 'none',
                                cursor: 'pointer',
                                boxShadow: '0 8px 32px rgba(168, 85, 247, 0.4)',
                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 10,
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                e.currentTarget.style.boxShadow = '0 12px 40px rgba(168, 85, 247, 0.6)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                e.currentTarget.style.boxShadow = '0 8px 32px rgba(168, 85, 247, 0.4)';
                            }}
                        >
                            <span style={{ fontSize: 20 }}>▶️</span>
                            Continuar de {formatTime(currentTime)}
                        </button>

                        {/* Restart button - Secondary */}
                        <button
                            onClick={onRestart}
                            style={{
                                padding: '14px 24px',
                                background: 'rgba(255, 255, 255, 0.06)',
                                color: 'white',
                                fontSize: 15,
                                fontWeight: 600,
                                borderRadius: 12,
                                border: '2px solid rgba(255, 255, 255, 0.15)',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 10
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                        >
                            <span style={{ fontSize: 18 }}>🔄</span>
                            Assistir do Início
                        </button>

                        {/* Cancel link */}
                        <button
                            onClick={onCancel}
                            style={{
                                padding: '12px',
                                background: 'transparent',
                                color: 'rgba(255, 255, 255, 0.5)',
                                fontSize: 14,
                                fontWeight: 500,
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'color 0.2s ease',
                                marginTop: 4
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)';
                            }}
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
