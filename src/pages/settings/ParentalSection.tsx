import { useEffect, useState } from 'react';
import { parentalService } from '../../services/parentalService';
import type { ParentalConfig } from '../../services/parentalService';
import {
    getKidsDailyLimitMinutes, setKidsDailyLimitMinutes,
    getProfileDailyLimitMinutes, setProfileDailyLimitMinutes,
    getKidsAllowedHours, setKidsAllowedHours,
    getAutoKidsHours, setAutoKidsHours,
    type HoursWindow,
} from '../../services/watchLimitsService';
import { profileService } from '../../services/profileService';
import { listParentalLog, clearParentalLog, type ParentalLogEntry } from '../../services/parentalLogService';
import { indexedDBCache, type EntradaOculta } from '../../services/indexedDBCache';
import { hasTmdbApiKey } from '../../services/tmdbKey';
import { kidsWeeklyUsage } from '../../services/statsDashboardHelpers';
import { diaLocal } from '../../utils/diaLocal';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';
import { depoisDeVerificar, modoAoTrocarPin, pedeePinAtual, precisaProvarPin, type ModoDoPin } from './pinParental';

export function ParentalSection() {
    const [parentalConfig, setParentalConfig] = useState<ParentalConfig>(parentalService.getConfig());
    const { t, locale } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();
    const [kidsLimit, setKidsLimit] = useState(() => getKidsDailyLimitMinutes());
    // D65: janelas de horário, limites por perfil e log parental.
    const windowToValue = (window: HoursWindow | null) => (window ? `${window.start}-${window.end}` : '');
    const valueToWindow = (value: string): HoursWindow | null => {
        const match = value.match(/^(\d{1,2})-(\d{1,2})$/);
        return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
    };
    const [kidsHours, setKidsHours] = useState(() => windowToValue(getKidsAllowedHours()));
    const [autoKids, setAutoKids] = useState(() => windowToValue(getAutoKidsHours()));
    const [profiles] = useState(() => profileService.getAllProfiles().filter(p => !p.isGuest));
    const [profileLimits, setProfileLimits] = useState<Record<string, number>>(() =>
        Object.fromEntries(profileService.getAllProfiles().map(p => [p.id, getProfileDailyLimitMinutes(p.id)])));
    const [logEntries, setLogEntries] = useState<ParentalLogEntry[]>(() => listParentalLog().slice(0, 30));
    // 🙈 Títulos que o filtro infantil escondeu do catálogo. A lista é global
    // (vale para todos os perfis) e, até agora, não tinha saída nenhuma.
    const [ocultos, setOcultos] = useState<number | null>(null);
    // D115: a lista título a título. A TMDB é consultada por nome e às vezes
    // casa o título errado; o "Mostrar todos" sozinho não resolvia, porque a
    // classificação errada continua em cache e o título sumia de novo no
    // primeiro clique da criança. Aqui o responsável libera UM título.
    const [entradasOcultas, setEntradasOcultas] = useState<EntradaOculta[]>([]);
    const temChaveTmdb = hasTmdbApiKey();

    const contarOcultos = async () => {
        const [filmes, series, entradas] = await Promise.all([
            indexedDBCache.getHiddenItems('movie'),
            indexedDBCache.getHiddenItems('series'),
            indexedDBCache.listHiddenEntries()
        ]);
        setOcultos(filmes.length + series.length);
        setEntradasOcultas(entradas);
    };

    useEffect(() => {
        // Deferred: contarOcultos resolve o estado depois do await (mesmo
        // padrão das outras seções de Configurações).
        queueMicrotask(() => { void contarOcultos(); });
    }, []);

    // PIN Modal states
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinInput, setPinInput] = useState(['', '', '', '']);
    const [pinConfirm, setPinConfirm] = useState(['', '', '', '']);
    const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
    const [pinError, setPinError] = useState('');
    // 'set' define, 'verify' confere para DESLIGAR, 'trocar' confere para
    // poder definir outro, 'destravar' abre a SEÇÃO e 'liberar' abre o
    // CONTEÚDO desta sessão. Estado pegajoso: quem abre o modal escolhe o modo
    // explicitamente, sempre — ver pinParental.ts.
    const [pinMode, setPinMode] = useState<ModoDoPin>('set');
    // 🔒 Destrave da SEÇÃO nesta sessão. Com PIN salvo, nada aqui é editável
    // até alguém provar o PIN uma vez. Chave PRÓPRIA no sessionStorage: provar
    // o PIN aqui NÃO destrava o conteúdo adulto do app (parentalService.ts).
    const [secaoDestravada, setSecaoDestravada] = useState(() => parentalService.isParentalSettingsUnlocked());
    const trancado = precisaProvarPin(parentalService.hasPin(), secaoDestravada);

    const alternarLiberacao = (entrada: EntradaOculta) => {
        // Liberar é afrouxar o filtro infantil: com a seção trancada, nada.
        if (trancado) return;
        const acao = entrada.liberado
            ? indexedDBCache.revogarLiberacao(entrada.type, entrada.name)
            : indexedDBCache.liberarItem(entrada.type, entrada.name);
        void acao.then(contarOcultos);
    };
    // O botão do PIN é a única saída da seção trancada — e continua clicável
    // mesmo com o parental desligado, porque desligar não apaga o PIN.
    const botaoPinAtivo = parentalConfig.enabled || trancado;
    // 🔓 Liberação de CONTEÚDO nesta sessão — a outra chave, a que os leitores
    // do gate consultam. Espelha `parentalService.isSessionUnlocked()` só para
    // a tela saber que rótulo mostrar, e por isso NASCE lida de lá: quem
    // liberou, saiu de Configurações e voltou tem de encontrar o botão
    // oferecendo TRANCAR, senão não há como re-trancar sem fechar o app.
    const [sessaoLiberada, setSessaoLiberada] = useState(() => parentalService.isSessionUnlocked());
    // O botão pede o PIN ele mesmo, com a seção trancada OU destravada: provar
    // o PIN para a SEÇÃO não vale como prova para o CONTEÚDO. Só faz sentido
    // com o controle ligado e um PIN salvo para conferir.
    const botaoLiberarAtivo = parentalConfig.enabled && parentalService.hasPin();

    /**
     * Envelope dos <select> que GRAVAM na seção. O `disabled` sozinho não
     * basta neles: um `change` disparado por script atravessa o campo
     * desabilitado e chega ao React. Nos BOTÕES o `disabled` basta — click em
     * botão desabilitado o React não despacha.
     */
    const seDestravado = (gravar: () => void) => {
        if (trancado) return;
        gravar();
    };

    const handleParentalConfigChange = <K extends keyof ParentalConfig>(key: K, value: ParentalConfig[K]) => {
        // When trying to disable parental control, require PIN verification
        if (key === 'enabled' && value === false && parentalService.hasPin()) {
            resetPinModal();
            setPinMode('verify');
            setShowPinModal(true);
            return; // Don't change config until PIN is verified
        }

        // Classificação máxima e categorias adultas também ficam
        // trancados. O 'enabled' é a exceção: desligar já pede PIN acima, e
        // ligar só aperta a restrição.
        if (key !== 'enabled' && trancado) return;

        // 🔒 Religar o controle fecha a liberação de conteúdo que estivesse
        // valendo. Sem isto o parental voltaria LIGADO E INERTE:
        // `isParentalActive` é `enabled && !sessionUnlocked`, então a chave de
        // sessão que ficou de pé anularia o controle recém-religado, sem aviso
        // nenhum na tela.
        if (key === 'enabled' && value === true) {
            parentalService.lockSession();
            setSessaoLiberada(false);
        }

        const newConfig = { ...parentalConfig, [key]: value };
        setParentalConfig(newConfig);
        parentalService.setConfig({ [key]: value });

        // When enabling parental control for the first time, prompt for PIN
        if (key === 'enabled' && value === true && !parentalService.hasPin()) {
            resetPinModal();
            setPinMode('set');
            setShowPinModal(true);
        }

        // Show save animation
        triggerSaveAnimation(`parental_${key}`);
    };

    const handlePinSubmit = async () => {
        const pin = pinInput.join('');

        if (pin.length !== 4) {
            setPinError(t('parental', 'pinError4Digits'));
            return;
        }

        // Conferência do PIN atual — para desligar o parental ou para trocá-lo.
        if (pedeePinAtual(pinMode)) {
            const destino = depoisDeVerificar(pinMode, await parentalService.verifyPin(pin));
            if (destino === 'pin-incorreto') {
                setPinError(t('parental', 'pinIncorrect'));
                setPinInput(['', '', '', '']);
                return;
            }
            if (destino === 'definir-novo-pin') {
                // Acertou o atual: agora sim segue para definir o novo.
                setPinMode('set');
                setPinStep('enter');
                setPinInput(['', '', '', '']);
                setPinConfirm(['', '', '', '']);
                setPinError('');
                return;
            }
            if (destino === 'destravar-secao') {
                // Provou o PIN: a seção abre por esta sessão e NADA mais muda.
                // Em especial o conteúdo adulto continua filtrado.
                parentalService.unlockParentalSettings();
                setSecaoDestravada(true);
                setShowPinModal(false);
                resetPinModal();
                return;
            }
            if (destino === 'liberar-sessao') {
                // Provou o PIN para o CONTEÚDO: o gate cai por esta sessão e
                // NADA mais muda. O controle continua ligado e a seção continua
                // como estava — trancada, se estava. Morre ao fechar o app
                // (sessionStorage), ao trocar de perfil (profileService) e ao
                // religar o controle (acima).
                parentalService.unlockSession();
                setSessaoLiberada(true);
                setShowPinModal(false);
                resetPinModal();
                triggerSaveAnimation('parental_sessao');
                return;
            }
            setParentalConfig(prev => ({ ...prev, enabled: false }));
            parentalService.setConfig({ enabled: false });
            setShowPinModal(false);
            resetPinModal();

            // Show save animation
            triggerSaveAnimation('parental_enabled');
            return;
        }

        // Set mode - setting a new PIN
        if (pinStep === 'enter') {
            // Move to confirm step
            setPinStep('confirm');
            setPinError('');
        } else {
            // Confirm PIN
            const confirmPin = pinConfirm.join('');
            if (pin !== confirmPin) {
                setPinError(t('parental', 'pinMismatch'));
                setPinConfirm(['', '', '', '']);
                return;
            }
            // Save PIN
            await parentalService.setPin(pin);
            // Quem definiu o PIN provou que é dono dele: a seção abre junto.
            // Sem isto, o pai que acabou de criar o PIN via a seção inteira
            // apagar na cara dele e tinha que digitar o mesmo PIN de novo.
            parentalService.unlockParentalSettings();
            setSecaoDestravada(true);
            setParentalConfig(parentalService.getConfig());
            setShowPinModal(false);
            resetPinModal();

            // Show save animation
            triggerSaveAnimation('parental_pin');
        }
    };

    const resetPinModal = () => {
        setPinInput(['', '', '', '']);
        setPinConfirm(['', '', '', '']);
        setPinStep('enter');
        setPinError('');
    };

    return (
        <>
            <div className="section-card">
                <div className="section-header">
                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>👨‍👩‍👧</div>
                    <div>
                        <h2>{t('parental', 'title')}</h2>
                        <p>{t('parental', 'description')}</p>
                    </div>
                </div>

                <div className="settings-group">
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'enable')}</label>
                            <p>{t('parental', 'enableDesc')}</p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                aria-label={t('parental', 'enable')}
                                checked={parentalConfig.enabled}
                                onChange={(e) => handleParentalConfigChange('enabled', e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                        {saveAnimation === 'parental_enabled' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'maxRating')}</label>
                            <p>{t('parental', 'maxRatingDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={parentalConfig.maxRating}
                            onChange={(e) => handleParentalConfigChange('maxRating', e.target.value as ParentalConfig['maxRating'])}
                            disabled={!parentalConfig.enabled || trancado}
                        >
                            <option value="L">{t('parental', 'free')}</option>
                            <option value="10">10 {t('parental', 'years')}</option>
                            <option value="12">12 {t('parental', 'years')}</option>
                            <option value="14">14 {t('parental', 'years')}</option>
                            <option value="16">16 {t('parental', 'years')}</option>
                            <option value="18">18 {t('parental', 'years')}</option>
                        </select>
                        {saveAnimation === 'parental_maxRating' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'pin')}</label>
                            <p>{parentalService.hasPin() ? t('parental', 'pinConfigured') : t('parental', 'pinDefine')}</p>
                        </div>
                        <button
                            className="setting-btn"
                            onClick={() => {
                                resetPinModal();
                                // Sem isto o modal abria definindo por cima do
                                // PIN antigo, sem conferir o atual. Trancada, a
                                // MESMA tela de conferência destrava a seção:
                                // trocar o PIN pediria esse mesmo PIN de todo
                                // jeito, então não se perde caminho nenhum.
                                setPinMode(trancado ? 'destravar' : modoAoTrocarPin(parentalService.hasPin()));
                                setShowPinModal(true);
                            }}
                            disabled={!botaoPinAtivo}
                            style={{
                                padding: '10px 20px',
                                background: botaoPinAtivo ? 'rgba(239, 68, 68, 0.2)' : 'rgba(100, 100, 100, 0.2)',
                                border: `1px solid ${botaoPinAtivo ? 'rgba(239, 68, 68, 0.4)' : 'rgba(100, 100, 100, 0.4)'}`,
                                borderRadius: '10px',
                                color: botaoPinAtivo ? '#ef4444' : '#666',
                                cursor: botaoPinAtivo ? 'pointer' : 'not-allowed',
                                fontWeight: 600,
                                transition: 'all 0.2s'
                            }}
                        >
                            {trancado
                                ? '🔓 Desbloquear'
                                : `🔑 ${parentalService.hasPin() ? t('parental', 'changePin') : t('parental', 'setPin')} PIN`}
                        </button>
                        {saveAnimation === 'parental_pin' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* 🔓 Liberar o conteúdo barrado só nesta sessão.
                        Fica FORA da tranca da seção de propósito: trancar de
                        novo só aperta a restrição, e liberar pede o PIN aqui
                        mesmo — nunca aproveita o destrave da seção. */}
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{sessaoLiberada ? '🔓' : '🔒'} {sessaoLiberada ? t('parental', 'sessionLockAgain') : t('parental', 'sessionUnlock')}</label>
                            <p>{sessaoLiberada ? t('parental', 'sessionUnlockedDesc') : t('parental', 'sessionLockedDesc')}</p>
                        </div>
                        <button
                            className="setting-btn"
                            onClick={() => {
                                if (sessaoLiberada) {
                                    parentalService.lockSession();
                                    setSessaoLiberada(false);
                                    triggerSaveAnimation('parental_sessao');
                                    return;
                                }
                                resetPinModal();
                                setPinMode('liberar');
                                setShowPinModal(true);
                            }}
                            disabled={!botaoLiberarAtivo}
                            style={{
                                padding: '10px 20px',
                                background: botaoLiberarAtivo ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)',
                                border: `1px solid ${botaoLiberarAtivo ? 'rgba(34, 197, 94, 0.4)' : 'rgba(100, 100, 100, 0.4)'}`,
                                borderRadius: '10px',
                                color: botaoLiberarAtivo ? '#22c55e' : '#666',
                                cursor: botaoLiberarAtivo ? 'pointer' : 'not-allowed',
                                fontWeight: 600,
                                transition: 'all 0.2s'
                            }}
                        >
                            {sessaoLiberada ? t('parental', 'sessionLockAgain') : t('parental', 'sessionUnlock')}
                        </button>
                        {saveAnimation === 'parental_sessao' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'blockAdult')}</label>
                            <p>{t('parental', 'blockAdultDesc')}</p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                aria-label={t('parental', 'blockAdult')}
                                checked={parentalConfig.blockAdultCategories}
                                onChange={(e) => handleParentalConfigChange('blockAdultCategories', e.target.checked)}
                                disabled={!parentalConfig.enabled || trancado}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                        {saveAnimation === 'parental_blockAdultCategories' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>⏰ {t('parental', 'kidsLimit')}</label>
                            <p>{t('parental', 'kidsLimitDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={kidsLimit}
                            disabled={trancado}
                            onChange={(e) => {
                                const minutes = Number(e.target.value);
                                seDestravado(() => {
                                    setKidsLimit(minutes);
                                    setKidsDailyLimitMinutes(minutes);
                                    triggerSaveAnimation('parental_kidsLimit');
                                });
                            }}
                        >
                            <option value={0}>{t('parental', 'limitOff')}</option>
                            <option value={30}>30 min</option>
                            <option value={60}>1h</option>
                            <option value={90}>1h30</option>
                            <option value={120}>2h</option>
                            <option value={180}>3h</option>
                        </select>
                        {saveAnimation === 'parental_kidsLimit' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* 🕗 Janela de horário do perfil kids */}
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>🕗 {t('parental', 'kidsHours')}</label>
                            <p>{t('parental', 'kidsHoursDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={kidsHours}
                            disabled={trancado}
                            onChange={(e) => {
                                const valor = e.target.value;
                                seDestravado(() => {
                                    setKidsHours(valor);
                                    setKidsAllowedHours(valueToWindow(valor));
                                    triggerSaveAnimation('parental_kidsHours');
                                });
                            }}
                        >
                            <option value="">{t('parental', 'limitOff')}</option>
                            <option value="6-20">06h–20h</option>
                            <option value="7-21">07h–21h</option>
                            <option value="8-22">08h–22h</option>
                        </select>
                        {saveAnimation === 'parental_kidsHours' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* 👶 Auto-trocar pra kids por horário */}
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>👶 {t('parental', 'autoKids')}</label>
                            <p>{t('parental', 'autoKidsDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={autoKids}
                            disabled={trancado}
                            onChange={(e) => {
                                const valor = e.target.value;
                                seDestravado(() => {
                                    setAutoKids(valor);
                                    setAutoKidsHours(valueToWindow(valor));
                                    triggerSaveAnimation('parental_autoKids');
                                });
                            }}
                        >
                            <option value="">{t('parental', 'limitOff')}</option>
                            <option value="6-20">06h–20h</option>
                            <option value="7-21">07h–21h</option>
                            <option value="8-22">08h–22h</option>
                        </select>
                        {saveAnimation === 'parental_autoKids' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* ⏳ Limite diário por perfil (adultos também) */}
                    <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                        <div className="setting-info">
                            <label>⏳ {t('parental', 'profileLimits')}</label>
                            <p>{t('parental', 'profileLimitsDesc')}</p>
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {profiles.map(profile => (
                                    <div key={profile.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ minWidth: 140, color: 'rgba(255,255,255,0.8)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {profile.isKids ? '👶 ' : ''}{profile.name}
                                        </span>
                                        <select
                                            className="setting-select"
                                            value={profileLimits[profile.id] ?? 0}
                                            disabled={trancado}
                                            onChange={(e) => {
                                                const minutes = Number(e.target.value);
                                                seDestravado(() => {
                                                    setProfileDailyLimitMinutes(profile.id, minutes);
                                                    setProfileLimits(prev => ({ ...prev, [profile.id]: minutes }));
                                                    triggerSaveAnimation('parental_profileLimit');
                                                });
                                            }}
                                        >
                                            <option value={0}>{t('parental', 'limitOff')}</option>
                                            <option value={30}>30 min</option>
                                            <option value={60}>1h</option>
                                            <option value={90}>1h30</option>
                                            <option value={120}>2h</option>
                                            <option value={180}>3h</option>
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {saveAnimation === 'parental_profileLimit' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* 👶 Relatório semanal dos perfis kids (últimos 7 dias) */}
                    <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                        <div className="setting-info">
                            <label>👶 {t('parental', 'kidsReportTitle')}</label>
                            <p>{t('parental', 'kidsReportDesc')}</p>
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {kidsWeeklyUsage(profileService.getAllProfiles(), key => localStorage.getItem(key), diaLocal(new Date())).map(row => (
                                    <div key={row.id} style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
                                        {row.name}: <b>{Math.floor(row.weekSeconds / 3600)}h {Math.floor((row.weekSeconds % 3600) / 60)}min</b>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 🙈 Títulos escondidos pelo filtro infantil */}
                    <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                        <div className="setting-info">
                            <label>🙈 {t('parental', 'hiddenTitles')}</label>
                            <p>{t('parental', 'hiddenTitlesDesc').replace('{n}', String(ocultos ?? 0))}</p>
                            {!temChaveTmdb && (
                                <p style={{ color: '#fbbf24', fontSize: 12, marginTop: 8 }}>
                                    ⚠️ {t('parental', 'noTmdbKeyWarning')}
                                </p>
                            )}
                        </div>
                        <button
                            className="check-btn"
                            style={{ width: 'auto', padding: '10px 16px' }}
                            title={t('parental', 'showHiddenAgain')}
                            disabled={!ocultos || trancado}
                            onClick={() => {
                                void indexedDBCache.clearHiddenItems().then(contarOcultos);
                            }}
                        >
                            👁 {t('parental', 'showHiddenAgain')}
                        </button>
                    </div>

                    {/* 🙈 Título a título: liberar o que a TMDB escondeu por engano (D115) */}
                    {entradasOcultas.length > 0 && (
                        <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxHeight: 220, overflowY: 'auto' }}>
                                {entradasOcultas.map(entrada => (
                                    <div
                                        key={`${entrada.type}_${entrada.name}`}
                                        data-titulo-oculto={entrada.titulo}
                                        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                                    >
                                        <span aria-hidden="true">{entrada.type === 'movie' ? '🎬' : '📺'}</span>
                                        <span style={{ flex: 1, minWidth: 0, color: 'rgba(255,255,255,0.85)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {entrada.titulo}
                                        </span>
                                        {entrada.liberado && (
                                            <span style={{ fontSize: 12, color: '#22c55e' }}>{t('parental', 'releasedTag')}</span>
                                        )}
                                        <button
                                            className="check-btn"
                                            style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                                            title={entrada.liberado ? undefined : t('parental', 'releaseTitleDesc')}
                                            disabled={trancado}
                                            onClick={() => alternarLiberacao(entrada)}
                                        >
                                            {entrada.liberado ? t('parental', 'undoRelease') : t('parental', 'releaseTitle')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 📜 Log parental (verificações de PIN) */}
                    <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                        <div className="setting-info">
                            <label>📜 {t('parental', 'logTitle')}</label>
                            <p>{t('parental', 'logDesc')}</p>
                            {logEntries.length > 0 ? (
                                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                                    {logEntries.map((entry, index) => (
                                        <div key={`${entry.ts}-${index}`} style={{ fontSize: 12, color: entry.kind === 'pin_fail' ? '#fca5a5' : 'rgba(255,255,255,0.6)' }}>
                                            {new Date(entry.ts).toLocaleString(locale)} · {entry.kind === 'pin_fail' ? '❌' : '✅'} {entry.detail}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>{t('parental', 'logEmpty')}</p>
                            )}
                        </div>
                        <button
                            className="check-btn"
                            style={{ width: 'auto', padding: '10px 16px' }}
                            title={t('parental', 'logClear')}
                            disabled={trancado}
                            onClick={() => { clearParentalLog(); setLogEntries([]); }}
                        >
                            🗑
                        </button>
                    </div>
                </div>
            </div>

            {/* PIN Modal */}
            {showPinModal && (
                <div
                    className="pin-modal-overlay"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0, 0, 0, 0.9)',
                        backdropFilter: 'blur(12px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        animation: 'pinFadeIn 0.3s ease'
                    }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowPinModal(false);
                            resetPinModal();
                        }
                    }}
                >
                    <style>{`
                        @keyframes pinFadeIn {
                            from { opacity: 0; }
                            to { opacity: 1; }
                        }
                        @keyframes pinSlideIn {
                            from { opacity: 0; transform: translateY(-30px) scale(0.95); }
                            to { opacity: 1; transform: translateY(0) scale(1); }
                        }
                        @keyframes pinBounce {
                            0%, 100% { transform: scale(1); }
                            50% { transform: scale(1.15); }
                        }
                        @keyframes pinDigitPop {
                            0% { transform: scale(1); }
                            50% { transform: scale(1.1); }
                            100% { transform: scale(1); }
                        }
                        @keyframes pinShake {
                            0%, 100% { transform: translateX(0); }
                            20% { transform: translateX(-10px); }
                            40% { transform: translateX(10px); }
                            60% { transform: translateX(-10px); }
                            80% { transform: translateX(10px); }
                        }
                        .pin-digit-filled {
                            animation: pinDigitPop 0.2s ease !important;
                        }
                        .pin-error-shake {
                            animation: pinShake 0.5s ease !important;
                        }
                    `}</style>
                    <div style={{
                        background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
                        borderRadius: '28px',
                        padding: '48px 40px',
                        maxWidth: '420px',
                        width: '90%',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        boxShadow: '0 30px 100px rgba(0, 0, 0, 0.6), 0 0 40px rgba(239, 68, 68, 0.1)',
                        animation: 'pinSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
                    }}>
                        {/* Header */}
                        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
                            <span style={{
                                fontSize: '56px',
                                display: 'block',
                                marginBottom: '16px',
                                animation: 'pinBounce 0.6s ease'
                            }}>{pedeePinAtual(pinMode) ? '🔓' : '🔐'}</span>
                            <h2 style={{
                                color: 'white',
                                fontSize: '26px',
                                fontWeight: 700,
                                margin: '0 0 10px 0',
                                background: 'linear-gradient(135deg, #fff 0%, #f87171 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text'
                            }}>
                                {pinMode === 'destravar' || pinMode === 'liberar'
                                    ? t('parental', 'pin')
                                    : pedeePinAtual(pinMode)
                                        ? t('parental', 'verifyPin')
                                        : pinStep === 'enter'
                                            ? t('parental', 'setPin') + ' PIN'
                                            : t('parental', 'confirmPin')}
                            </h2>
                            <p style={{ color: '#9ca3af', fontSize: '15px', margin: 0 }}>
                                {pinMode === 'trocar'
                                    ? t('parental', 'pinCurrentToChange')
                                    : pinMode === 'verify'
                                        ? t('parental', 'verifyPin')
                                        : pinStep === 'enter'
                                            ? t('parental', 'enterPin')
                                            : t('parental', 'confirmPin')}
                            </p>
                        </div>

                        {/* PIN Input Container */}
                        <div
                            style={{
                                position: 'relative',
                                display: 'flex',
                                justifyContent: 'center',
                                gap: '14px',
                                marginBottom: '28px'
                            }}
                            onClick={() => {
                                const input = document.getElementById('pin-hidden-input');
                                if (input) input.focus();
                            }}
                        >
                            {/* Hidden Input that captures keyboard */}
                            <input
                                id="pin-hidden-input"
                                type="tel"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={4}
                                autoFocus
                                autoComplete="off"
                                value={pinStep === 'enter' ? pinInput.join('') : pinConfirm.join('')}
                                onChange={(e) => {
                                    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                                    const digits = value.split('').concat(['', '', '', '']).slice(0, 4);
                                    if (pinStep === 'enter') {
                                        setPinInput(digits);
                                    } else {
                                        setPinConfirm(digits);
                                    }
                                    setPinError('');
                                }}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    opacity: 0,
                                    cursor: 'pointer',
                                    zIndex: 10
                                }}
                            />

                            {/* Visual PIN Digits */}
                            {(pinStep === 'enter' ? pinInput : pinConfirm).map((digit, index) => (
                                <div
                                    key={index}
                                    className={digit ? 'pin-digit-filled' : ''}
                                    style={{
                                        width: '64px',
                                        height: '76px',
                                        background: digit
                                            ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.15) 100%)'
                                            : 'rgba(255, 255, 255, 0.05)',
                                        border: `2px solid ${digit ? '#ef4444' : 'rgba(255, 255, 255, 0.15)'}`,
                                        borderRadius: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '36px',
                                        color: '#ef4444',
                                        transition: 'all 0.2s ease',
                                        boxShadow: digit ? '0 4px 20px rgba(239, 68, 68, 0.3)' : 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {digit ? '●' : ''}
                                </div>
                            ))}
                        </div>

                        {/* Error Message */}
                        {pinError && (
                            <div
                                className="pin-error-shake"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    color: '#f87171',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    marginBottom: '20px',
                                    padding: '12px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    borderRadius: '10px',
                                    border: '1px solid rgba(239, 68, 68, 0.2)'
                                }}
                            >
                                ⚠️ {pinError}
                            </div>
                        )}

                        {/* Buttons */}
                        <div style={{
                            display: 'flex',
                            gap: '14px',
                            marginTop: '28px'
                        }}>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowPinModal(false);
                                    resetPinModal();
                                    // If we're enabling parental control and user cancels, disable it
                                    if (!parentalService.hasPin()) {
                                        handleParentalConfigChange('enabled', false);
                                    }
                                }}
                                style={{
                                    flex: 1,
                                    padding: '16px 24px',
                                    borderRadius: '14px',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    background: 'rgba(255, 255, 255, 0.08)',
                                    color: '#9ca3af',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                                    e.currentTarget.style.color = 'white';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                    e.currentTarget.style.color = '#9ca3af';
                                }}
                            >
                                {t('parental', 'cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => handlePinSubmit()}
                                style={{
                                    flex: 1,
                                    padding: '16px 24px',
                                    borderRadius: '14px',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                    color: 'white',
                                    border: 'none',
                                    transition: 'all 0.2s ease',
                                    boxShadow: '0 4px 20px rgba(239, 68, 68, 0.4)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 6px 25px rgba(239, 68, 68, 0.5)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(239, 68, 68, 0.4)';
                                }}
                            >
                                {pinMode === 'verify' || pinMode === 'destravar' || pinMode === 'liberar'
                                    ? '🔓 Desbloquear'
                                    : pinMode === 'trocar' || pinStep === 'enter'
                                        ? 'Continuar →'
                                        : `✓ ${t('parental', 'confirm')}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
