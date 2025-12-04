import { useState, useEffect } from 'react';

interface ContentCounts {
    live: number;
    vod: number;
    series: number;
}

export function Home() {
    const [counts, setCounts] = useState<ContentCounts>({ live: 0, vod: 0, series: 0 });
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const fetchCounts = async () => {
            try {
                const result = await window.ipcRenderer.invoke('content:get-counts');
                if (result.success) {
                    setCounts(result.data);
                }
            } catch (error) {
                console.error('Failed to fetch counts:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchCounts();

        // Update time every second
        const interval = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
    };

    const getGreeting = () => {
        const hour = currentTime.getHours();
        if (hour < 12) return 'Bom dia';
        if (hour < 18) return 'Boa tarde';
        return 'Boa noite';
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)',
            padding: '40px 60px 40px 100px',
            position: 'relative',
            overflow: 'hidden'
        }}>
            {/* Background decorations */}
            <div style={{
                position: 'absolute',
                top: '-200px',
                right: '-200px',
                width: '600px',
                height: '600px',
                background: 'radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%)',
                borderRadius: '50%',
                pointerEvents: 'none'
            }} />
            <div style={{
                position: 'absolute',
                bottom: '-150px',
                left: '-150px',
                width: '400px',
                height: '400px',
                background: 'radial-gradient(circle, rgba(139, 92, 246, 0.08) 0%, transparent 70%)',
                borderRadius: '50%',
                pointerEvents: 'none'
            }} />

            {/* Header */}
            <div style={{ marginBottom: '48px' }}>
                <div style={{
                    fontSize: '14px',
                    color: 'rgba(156, 163, 175, 1)',
                    marginBottom: '8px',
                    textTransform: 'capitalize'
                }}>
                    {formatDate(currentTime)}
                </div>
                <h1 style={{
                    fontSize: '48px',
                    fontWeight: '700',
                    background: 'linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    marginBottom: '8px'
                }}>
                    {getGreeting()}! 👋
                </h1>
                <p style={{
                    fontSize: '18px',
                    color: 'rgba(156, 163, 175, 1)'
                }}>
                    O que você quer assistir hoje?
                </p>
            </div>

            {/* Clock */}
            <div style={{
                position: 'absolute',
                top: '40px',
                right: '60px',
                textAlign: 'right'
            }}>
                <div style={{
                    fontSize: '64px',
                    fontWeight: '300',
                    color: 'white',
                    letterSpacing: '-2px',
                    lineHeight: 1
                }}>
                    {formatTime(currentTime)}
                </div>
            </div>

            {/* Stats Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '24px',
                marginBottom: '48px',
                maxWidth: '900px'
            }}>
                {/* Live TV Card */}
                <a href="#/dashboard/live" style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%)',
                    borderRadius: '20px',
                    padding: '28px',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    textDecoration: 'none',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-4px)';
                        e.currentTarget.style.boxShadow = '0 20px 40px rgba(239, 68, 68, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}>
                    <div style={{
                        fontSize: '40px',
                        marginBottom: '12px'
                    }}>📺</div>
                    <div style={{
                        fontSize: '32px',
                        fontWeight: '700',
                        color: 'white',
                        marginBottom: '4px'
                    }}>
                        {loading ? '...' : counts.live.toLocaleString()}
                    </div>
                    <div style={{
                        fontSize: '14px',
                        color: 'rgba(239, 68, 68, 0.9)',
                        fontWeight: '600'
                    }}>
                        Canais ao Vivo
                    </div>
                </a>

                {/* VOD Card */}
                <a href="#/dashboard/vod" style={{
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
                    borderRadius: '20px',
                    padding: '28px',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    textDecoration: 'none',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-4px)';
                        e.currentTarget.style.boxShadow = '0 20px 40px rgba(59, 130, 246, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}>
                    <div style={{
                        fontSize: '40px',
                        marginBottom: '12px'
                    }}>🎬</div>
                    <div style={{
                        fontSize: '32px',
                        fontWeight: '700',
                        color: 'white',
                        marginBottom: '4px'
                    }}>
                        {loading ? '...' : counts.vod.toLocaleString()}
                    </div>
                    <div style={{
                        fontSize: '14px',
                        color: 'rgba(59, 130, 246, 0.9)',
                        fontWeight: '600'
                    }}>
                        Filmes
                    </div>
                </a>

                {/* Series Card */}
                <a href="#/dashboard/series" style={{
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.05) 100%)',
                    borderRadius: '20px',
                    padding: '28px',
                    border: '1px solid rgba(139, 92, 246, 0.2)',
                    textDecoration: 'none',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-4px)';
                        e.currentTarget.style.boxShadow = '0 20px 40px rgba(139, 92, 246, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}>
                    <div style={{
                        fontSize: '40px',
                        marginBottom: '12px'
                    }}>📺</div>
                    <div style={{
                        fontSize: '32px',
                        fontWeight: '700',
                        color: 'white',
                        marginBottom: '4px'
                    }}>
                        {loading ? '...' : counts.series.toLocaleString()}
                    </div>
                    <div style={{
                        fontSize: '14px',
                        color: 'rgba(139, 92, 246, 0.9)',
                        fontWeight: '600'
                    }}>
                        Séries
                    </div>
                </a>
            </div>

            {/* Quick Access */}
            <div style={{ maxWidth: '900px' }}>
                <h2 style={{
                    fontSize: '20px',
                    fontWeight: '600',
                    color: 'white',
                    marginBottom: '20px'
                }}>
                    Acesso Rápido
                </h2>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '16px'
                }}>
                    <a href="#/dashboard/live" style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        padding: '20px',
                        textAlign: 'center',
                        textDecoration: 'none',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        transition: 'all 0.2s'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                        }}>
                        <div style={{ fontSize: '28px', marginBottom: '8px' }}>🔴</div>
                        <div style={{ color: 'white', fontSize: '14px', fontWeight: '500' }}>TV ao Vivo</div>
                    </a>
                    <a href="#/dashboard/vod" style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        padding: '20px',
                        textAlign: 'center',
                        textDecoration: 'none',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        transition: 'all 0.2s'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                        }}>
                        <div style={{ fontSize: '28px', marginBottom: '8px' }}>🎥</div>
                        <div style={{ color: 'white', fontSize: '14px', fontWeight: '500' }}>Filmes</div>
                    </a>
                    <a href="#/dashboard/series" style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        padding: '20px',
                        textAlign: 'center',
                        textDecoration: 'none',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        transition: 'all 0.2s'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                        }}>
                        <div style={{ fontSize: '28px', marginBottom: '8px' }}>📺</div>
                        <div style={{ color: 'white', fontSize: '14px', fontWeight: '500' }}>Séries</div>
                    </a>
                    <a href="#/dashboard/settings" style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        padding: '20px',
                        textAlign: 'center',
                        textDecoration: 'none',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        transition: 'all 0.2s'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                        }}>
                        <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚙️</div>
                        <div style={{ color: 'white', fontSize: '14px', fontWeight: '500' }}>Configurações</div>
                    </a>
                </div>
            </div>

            {/* Footer */}
            <div style={{
                position: 'absolute',
                bottom: '20px',
                left: '100px',
                right: '60px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'rgba(156, 163, 175, 0.5)',
                fontSize: '12px'
            }}>
                <span>NeoStream IPTV</span>
                <span>v1.0.0</span>
            </div>
        </div>
    );
}
