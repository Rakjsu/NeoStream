import { useState, useEffect } from 'react';
import { profileService } from '../services/profileService';
import type { Profile } from '../types/profile';
import { ProfileCard } from '../components/ProfileCard';
import { CreateProfileModal } from '../components/CreateProfileModal';

interface ProfileSelectorProps {
    onProfileSelected: () => void;
}

export function ProfileSelector({ onProfileSelected }: ProfileSelectorProps) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [showPinModal, setShowPinModal] = useState(false);
    const [selectedProfileForPin, setSelectedProfileForPin] = useState<Profile | null>(null);
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        loadProfiles();
    }, []);

    const loadProfiles = () => {
        const allProfiles = profileService.getAllProfiles();
        setProfiles(allProfiles);
    };

    const handleProfileClick = async (profile: Profile) => {
        // Check if profile has PIN
        if (profileService.hasPin(profile.id)) {
            setSelectedProfileForPin(profile);
            setShowPinModal(true);
            setPinInput('');
            setPinError('');
        } else {
            // No PIN, activate directly
            profileService.setActiveProfile(profile.id);
            onProfileSelected();
        }
    };

    const handlePinSubmit = async () => {
        if (!selectedProfileForPin) return;

        const isValid = await profileService.verifyPin(selectedProfileForPin.id, pinInput);
        if (isValid) {
            profileService.setActiveProfile(selectedProfileForPin.id);
            setShowPinModal(false);
            onProfileSelected();
        } else {
            setPinError('PIN incorreto. Tente novamente.');
            setPinInput('');
        }
    };

    const handleAddProfile = () => {
        if (profiles.length >= 5) {
            alert('Limite de 5 perfis atingido!');
            return;
        }
        setShowCreateModal(true);
    };

    return (
        <div
            style={{
                minHeight: '100vh',
                backgroundColor: '#0f172a',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px'
            }}
        >
            {/* Title */}
            <h1
                style={{
                    color: 'white',
                    fontSize: '48px',
                    fontWeight: '700',
                    marginBottom: '60px',
                    textAlign: 'center'
                }}
            >
                Quem está assistindo?
            </h1>

            {/* Profiles Grid */}
            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '40px',
                    justifyContent: 'center',
                    maxWidth: '1000px'
                }}
            >
                {profiles.map((profile) => (
                    <ProfileCard
                        key={profile.id}
                        profile={profile}
                        onClick={() => handleProfileClick(profile)}
                    />
                ))}

                {/* Add Profile Card */}
                {profiles.length < 5 && (
                    <div
                        onClick={handleAddProfile}
                        style={{
                            width: '180px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '16px',
                            padding: '16px',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.05)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                    >
                        <div
                            style={{
                                width: '150px',
                                height: '150px',
                                borderRadius: '12px',
                                border: '3px dashed rgba(255, 255, 255, 0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)'
                            }}
                        >
                            <span style={{ fontSize: '60px', opacity: 0.5 }}>➕</span>
                        </div>
                        <h3
                            style={{
                                color: 'rgba(255, 255, 255, 0.7)',
                                fontSize: '18px',
                                fontWeight: '600',
                                margin: 0
                            }}
                        >
                            Adicionar Perfil
                        </h3>
                    </div>
                )}
            </div>

            {/* PIN Modal */}
            {showPinModal && selectedProfileForPin && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000
                    }}
                    onClick={() => setShowPinModal(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            backgroundColor: '#1e293b',
                            borderRadius: '16px',
                            padding: '40px',
                            maxWidth: '400px',
                            width: '90%'
                        }}
                    >
                        <h2 style={{ color: 'white', fontSize: '24px', marginBottom: '8px' }}>
                            Digite o PIN para {selectedProfileForPin.name}
                        </h2>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '14px', marginBottom: '24px' }}>
                            Este perfil está protegido por PIN
                        </p>

                        <input
                            type="password"
                            maxLength={4}
                            value={pinInput}
                            onChange={(e) => {
                                setPinInput(e.target.value);
                                setPinError('');
                            }}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter' && pinInput.length === 4) {
                                    handlePinSubmit();
                                }
                            }}
                            placeholder="PIN de 4 dígitos"
                            autoFocus
                            style={{
                                width: '100%',
                                padding: '16px',
                                fontSize: '24px',
                                textAlign: 'center',
                                borderRadius: '8px',
                                border: pinError ? '2px solid #ef4444' : '2px solid rgba(255, 255, 255, 0.2)',
                                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                color: 'white',
                                marginBottom: '16px',
                                letterSpacing: '8px'
                            }}
                        />

                        {pinError && (
                            <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '16px' }}>
                                {pinError}
                            </p>
                        )}

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                                onClick={() => setShowPinModal(false)}
                                style={{
                                    flex: 1,
                                    padding: '12px',
                                    borderRadius: '8px',
                                    border: '2px solid rgba(255, 255, 255, 0.2)',
                                    backgroundColor: 'transparent',
                                    color: 'white',
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handlePinSubmit}
                                disabled={pinInput.length !== 4}
                                style={{
                                    flex: 1,
                                    padding: '12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    backgroundColor: pinInput.length === 4 ? '#3b82f6' : 'rgba(59, 130, 246, 0.3)',
                                    color: 'white',
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    cursor: pinInput.length === 4 ? 'pointer' : 'not-allowed'
                                }}
                            >
                                Entrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manage Profiles Link */}
            <button
                onClick={() => {/* TODO: Open ProfileManager */ }}
                style={{
                    marginTop: '60px',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    border: '2px solid rgba(255, 255, 255, 0.2)',
                    backgroundColor: 'transparent',
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
                    e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                }}
            >
                ⚙️ Gerenciar Perfis
            </button>

            {/* Create Profile Modal */}
            {showCreateModal && (
                <CreateProfileModal
                    onClose={() => setShowCreateModal(false)}
                    onProfileCreated={() => {
                        loadProfiles();
                        setShowCreateModal(false);
                    }}
                />
            )}
        </div>
    );
}
