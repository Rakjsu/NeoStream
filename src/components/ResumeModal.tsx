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
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = Math.round((currentTime / duration) * 100);

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                backdropFilter: 'blur(8px)'
            }}
            onClick={onCancel}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                    borderRadius: '16px',
                    padding: '32px',
                    maxWidth: '500px',
                    width: '90%',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                    border: '1px solid rgba(59, 130, 246, 0.3)'
                }}
            >
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                        ▶️
                    </div>
                    <h2 style={{
                        color: 'white',
                        fontSize: '24px',
                        fontWeight: '700',
                        marginBottom: '8px'
                    }}>
                        Continuar Assistindo?
                    </h2>
                    <p style={{
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontSize: '16px',
                        marginBottom: '4px'
                    }}>
                        {seriesName}
                    </p>
                    <p style={{
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontSize: '14px'
                    }}>
                        Temporada {seasonNumber} · Episódio {episodeNumber}
                    </p>
                </div>

                {/* Progress Info */}
                <div style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '24px'
                }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '12px'
                    }}>
                        <span style={{
                            color: 'rgba(255, 255, 255, 0.7)',
                            fontSize: '14px'
                        }}>
                            Progresso
                        </span>
                        <span style={{
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600'
                        }}>
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                    </div>

                    {/* Progress Bar */}
                    <div style={{
                        width: '100%',
                        height: '8px',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        borderRadius: '4px',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            width: `${progress}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)',
                            borderRadius: '4px',
                            transition: 'width 0.3s ease'
                        }} />
                    </div>

                    <div style={{
                        textAlign: 'center',
                        marginTop: '8px',
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontSize: '12px'
                    }}>
                        {progress}% assistido
                    </div>
                </div>

                {/* Buttons */}
                <div style={{
                    display: 'flex',
                    gap: '12px',
                    flexDirection: 'column'
                }}>
                    <button
                        onClick={onResume}
                        style={{
                            padding: '16px 24px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            fontSize: '16px',
                            fontWeight: '700',
                            borderRadius: '10px',
                            border: 'none',
                            cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(59, 130, 246, 0.4)',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.02)';
                            e.currentTarget.style.backgroundColor = '#2563eb';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.backgroundColor = '#3b82f6';
                        }}
                    >
                        <span style={{ fontSize: '20px' }}>▶️</span>
                        Retomar de {formatTime(currentTime)}
                    </button>

                    <button
                        onClick={onRestart}
                        style={{
                            padding: '14px 24px',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            color: 'white',
                            fontSize: '15px',
                            fontWeight: '600',
                            borderRadius: '10px',
                            border: '2px solid rgba(255, 255, 255, 0.2)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        }}
                    >
                        <span style={{ fontSize: '18px' }}>🔄</span>
                        Iniciar Novamente
                    </button>

                    <button
                        onClick={onCancel}
                        style={{
                            padding: '12px 24px',
                            backgroundColor: 'transparent',
                            color: 'rgba(255, 255, 255, 0.6)',
                            fontSize: '14px',
                            fontWeight: '600',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'color 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                        }}
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
}
