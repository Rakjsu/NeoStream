import { useState, useEffect } from 'react';
import { updateService } from '../services/updateService';
import type { UpdateConfig } from '../types/update';

export function Settings() {
    const [updateConfig, setUpdateConfig] = useState<UpdateConfig>({
        checkFrequency: 'on-open',
        autoInstall: false,
        lastCheck: 0
    });
    const [checking, setChecking] = useState(false);
    const [lastCheckDate, setLastCheckDate] = useState<string>('');

    useEffect(() => {
        loadUpdateConfig();
    }, []);

    const loadUpdateConfig = async () => {
        const config = await updateService.getConfig();
        setUpdateConfig(config);

        if (config.lastCheck) {
            const date = new Date(config.lastCheck);
            setLastCheckDate(date.toLocaleString('pt-BR'));
        }
    };

    const handleUpdateConfigChange = async (key: keyof UpdateConfig, value: any) => {
        const newConfig = { ...updateConfig, [key]: value };
        setUpdateConfig(newConfig);
        await updateService.setConfig(newConfig);
    };

    const handleCheckNow = async () => {
        setChecking(true);
        try {
            const result = await updateService.checkForUpdates();
            if (result.updateAvailable) {
                alert(`Nova versão disponível: ${result.latestVersion}`);
            } else {
                alert('Você já está usando a versão mais recente!');
            }
            await loadUpdateConfig(); // Reload to get updated lastCheck
        } catch (error) {
            alert('Erro ao verificar atualizações');
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold text-white mb-6">Configurações</h1>

            <div className="max-w-2xl space-y-6">
                {/* Auto-Update Section */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-3 mb-4">
                        <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="2"
                        >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <h2 className="text-xl font-bold text-white">Atualizações Automáticas</h2>
                    </div>

                    <div className="space-y-4">
                        {/* Check Frequency */}
                        <div>
                            <label className="block text-gray-300 mb-2">
                                Verificar atualizações:
                            </label>
                            <select
                                className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                                value={updateConfig.checkFrequency}
                                onChange={(e) => handleUpdateConfigChange('checkFrequency', e.target.value as UpdateConfig['checkFrequency'])}
                            >
                                <option value="on-open">Ao abrir o app</option>
                                <option value="1-day">A cada 1 dia</option>
                                <option value="1-week">A cada 1 semana</option>
                                <option value="1-month">A cada 1 mês</option>
                            </select>
                            <p className="text-gray-500 text-sm mt-1">
                                Define com que frequência o app deve verificar por novas versões
                            </p>
                        </div>

                        {/* Auto Install */}
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <span className="text-gray-300 block mb-1">
                                    Instalar atualizações automaticamente
                                </span>
                                <p className="text-gray-500 text-sm">
                                    Se ativado, as atualizações serão instaladas sem pedir confirmação. O app será reiniciado automaticamente.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-4">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={updateConfig.autoInstall}
                                    onChange={(e) => handleUpdateConfigChange('autoInstall', e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>

                        {/* Last Check Info */}
                        {lastCheckDate && (
                            <div className="pt-3 border-t border-gray-700">
                                <p className="text-gray-400 text-sm">
                                    Última verificação: <span className="text-gray-300">{lastCheckDate}</span>
                                </p>
                            </div>
                        )}

                        {/* Manual Check Button */}
                        <button
                            onClick={handleCheckNow}
                            disabled={checking}
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {checking ? (
                                <>
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Verificando...
                                </>
                            ) : (
                                <>
                                    🔍 Verificar Atualizações Agora
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Appearance Section */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                    <h2 className="text-xl font-bold text-white mb-4">Aparência</h2>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Tema</span>
                            <select className="bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600">
                                <option>Escuro</option>
                                <option>Claro</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Idioma</span>
                            <select className="bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600">
                                <option>English</option>
                                <option>Português</option>
                                <option>Español</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Player Section */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                    <h2 className="text-xl font-bold text-white mb-4">Player</h2>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Auto-play próximo episódio</span>
                            <input type="checkbox" className="w-6 h-6" defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Legendas</span>
                            <input type="checkbox" className="w-6 h-6" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
