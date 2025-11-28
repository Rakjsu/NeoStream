import { useState, useEffect } from 'react';

interface LiveStream {
    num: number;
    name: string;
    stream_type: string;
    stream_id: number;
    stream_icon: string;
    epg_channel_id: string;
    added: string;
    category_id: string;
    custom_sid: string;
    tv_archive: number;
    direct_source: string;
    tv_archive_duration: number;
}

// LiveTV Component - Icons: 6px - Updated 2025-11-26 00:29
export function LiveTV() {
    const [streams, setStreams] = useState<LiveStream[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());

    useEffect(() => {
        fetchStreams();
    }, []);

    const fetchStreams = async () => {
        setLoading(true);
        setError('');

        try {
            const result = await window.ipcRenderer.invoke('streams:get-live');

            if (result.success) {
                setStreams(result.data || []);
            } else {
                setError(result.error || 'Failed to load channels');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    const filteredStreams = streams.filter(stream =>
        stream.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleImageError = (streamId: number) => {
        setBrokenImages(prev => new Set(prev).add(streamId));
    };

    if (loading) {
        return (
            <div className="p-8">
                <h1 className="text-3xl font-bold text-white mb-6">Canais de TV</h1>
                <div className="space-y-px">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                        <div key={i} className="bg-gray-800 py-1 px-2 border-b border-gray-700/50 flex items-center gap-2 animate-pulse">
                            <div className="w-[16px] h-[16px] bg-gray-700 rounded"></div>
                            <div className="flex-1">
                                <div className="h-3 bg-gray-700 rounded w-2/3"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8">
                <h1 className="text-3xl font-bold text-white mb-6">Canais de TV</h1>
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg text-center">
                    <p className="font-medium mb-2">Erro ao carregar canais</p>
                    <p className="text-sm">{error}</p>
                    <button
                        onClick={fetchStreams}
                        className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                    >
                        Tentar novamente
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-4">Canais de TV</h1>

                <div className="flex items-center gap-4">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar canais..."
                        className="flex-1 max-w-md bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <div className="text-gray-400 text-sm">
                        {filteredStreams.length} {filteredStreams.length === 1 ? 'canal' : 'canais'}
                    </div>
                </div>
            </div>

            {filteredStreams.length === 0 ? (
                <div className="text-center text-gray-400 py-12">
                    <p className="text-lg">Nenhum canal encontrado</p>
                </div>
            ) : (
                <div className="space-y-px">
                    {filteredStreams.map((stream) => (
                        <div
                            key={stream.stream_id}
                            className="bg-gray-800 hover:bg-gray-700 py-1 px-2 border-b border-gray-700/50 last:border-b-0 transition-colors cursor-pointer group flex items-center gap-2"
                        >
                            <div className="w-[56px] h-[56px] bg-gray-700 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                                {stream.stream_icon && !brokenImages.has(stream.stream_id) ? (
                                    <img
                                        src={stream.stream_icon}
                                        alt=""
                                        className="w-full h-full object-contain"
                                        onError={() => handleImageError(stream.stream_id)}
                                    />
                                ) : (
                                    <div className="w-full h-full bg-blue-500/30"></div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-gray-300 font-normal text-xs leading-tight group-hover:text-white transition-colors truncate">
                                    {stream.name}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
