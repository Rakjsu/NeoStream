import { useNavigate } from 'react-router-dom';
import { Tv } from 'lucide-react';

export function Welcome() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex items-center justify-center p-8" style={{ backgroundColor: '#0c0c0cff', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            <div className="text-center max-w-2xl">
                {/* Icon */}
                <div className="mb-12">
                    <Tv className="w-16 h-16 text-white mx-auto" strokeWidth={1.5} />
                </div>

                {/* Main Message */}
                <h1 className="text-3xl text-white mb-3 tracking-wide" style={{ fontWeight: 500 }}>
                    StreamPro não fornece nenhuma fonte de canais de TV
                </h1>

                {/* Subtitle */}
                <p className="text-base" style={{ fontWeight: 500, color: '#8d919bff', marginBottom: '60px' }}>
                    Para assistir canais de TV, adicione uma playlist fornecida pelo seu serviço de IPTV
                </p>

                {/* Action Buttons */}
                <div className="flex justify-center items-center" style={{ gap: '18px' }}>
                    <button
                        onClick={() => navigate('/login')}
                        className="bg-gray-200 text-gray-900 hover:bg-white hover:scale-105 hover:shadow-xl active:scale-95 transition-all duration-200"
                        style={{
                            borderRadius: '8px',
                            padding: '13px 24px',
                            fontSize: '16px',
                            fontWeight: 500,
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        Adicionar playlist
                    </button>

                    <button
                        onClick={() => navigate('/dashboard/settings')}
                        className="hover:bg-gray-700 hover:scale-105 hover:shadow-lg active:scale-95 transition-all duration-200"
                        style={{
                            backgroundColor: '#232427ff',
                            color: 'white',
                            borderRadius: '8px',
                            padding: '13px 24px',
                            fontSize: '16px',
                            fontWeight: 500,
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        Configurações
                    </button>
                </div>
            </div>
        </div>
    );
}
