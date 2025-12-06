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
    const [hoveredProfile, setHoveredProfile] = useState<string | null>(null);

    useEffect(() => {
        loadProfiles();
    }, []);

    const loadProfiles = () => {
        const allProfiles = profileService.getAllProfiles();
        setProfiles(allProfiles);
    };

    const handleProfileClick = async (profile: Profile) => {
        if (profileService.hasPin(profile.id)) {
            setSelectedProfileForPin(profile);
            setShowPinModal(true);
            setPinInput('');
            setPinError('');
        } else {
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
        <>
            <style>{profileSelectorStyles}</style>
            <div className="profile-selector-page">
                {/* Animated Background */}
                <div className="profile-backdrop">
                    <div className="backdrop-orb orb-1" />
                    <div className="backdrop-orb orb-2" />
                    <div className="backdrop-orb orb-3" />
                </div>

                {/* Logo */}
                <div className="app-logo">
                    <svg width="60" height="60" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <linearGradient id="profileLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#a855f7" />
                                <stop offset="100%" stopColor="#ec4899" />
                            </linearGradient>
                        </defs>
                        <path d="M 10,10 L 10,90 L 90,50 Z" fill="none" stroke="url(#profileLogoGrad)" strokeWidth="6" strokeLinejoin="round" />
                        <rect x="35" y="35" width="6" height="30" fill="url(#profileLogoGrad)" rx="3" />
                        <rect x="45" y="25" width="6" height="50" fill="url(#profileLogoGrad)" rx="3" />
                        <rect x="55" y="40" width="6" height="20" fill="url(#profileLogoGrad)" rx="3" />
                    </svg>
                </div>

                {/* Title */}
                <h1 className="profile-title">
                    <span className="title-icon">👋</span>
                    Quem está assistindo?
                </h1>

                {/* Profiles Grid */}
                <div className="profiles-container">
                    {profiles.map((profile, index) => (
                        <div
                            key={profile.id}
                            className={`profile-card-wrapper ${hoveredProfile === profile.id ? 'hovered' : ''}`}
                            style={{ animationDelay: `${index * 0.1}s` }}
                            onMouseEnter={() => setHoveredProfile(profile.id)}
                            onMouseLeave={() => setHoveredProfile(null)}
                        >
                            <ProfileCard
                                profile={profile}
                                onClick={() => handleProfileClick(profile)}
                            />
                        </div>
                    ))}

                    {/* Add Profile Card */}
                    {profiles.length < 5 && (
                        <div
                            className="add-profile-card"
                            onClick={handleAddProfile}
                            style={{ animationDelay: `${profiles.length * 0.1}s` }}
                        >
                            <div className="add-icon-container">
                                <span className="add-icon">+</span>
                                <div className="add-icon-glow" />
                            </div>
                            <span className="add-label">Adicionar Perfil</span>
                        </div>
                    )}
                </div>

                {/* Manage Profiles Button */}
                <button className="manage-btn">
                    <span>⚙️</span>
                    <span>Gerenciar Perfis</span>
                </button>
            </div>

            {/* PIN Modal */}
            {showPinModal && selectedProfileForPin && (
                <div className="pin-modal-overlay" onClick={() => setShowPinModal(false)}>
                    <div className="pin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="pin-modal-header">
                            <div className="pin-profile-icon">🔐</div>
                            <h2>Digite o PIN</h2>
                            <p>Perfil protegido: <strong>{selectedProfileForPin.name}</strong></p>
                        </div>

                        <div className="pin-input-container">
                            {[0, 1, 2, 3].map((index) => (
                                <div
                                    key={index}
                                    className={`pin-digit ${pinInput.length > index ? 'filled' : ''} ${pinError ? 'error' : ''}`}
                                >
                                    {pinInput[index] ? '•' : ''}
                                </div>
                            ))}
                        </div>

                        <input
                            type="password"
                            maxLength={4}
                            value={pinInput}
                            onChange={(e) => {
                                setPinInput(e.target.value.replace(/\D/g, ''));
                                setPinError('');
                            }}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter' && pinInput.length === 4) {
                                    handlePinSubmit();
                                }
                            }}
                            autoFocus
                            className="hidden-pin-input"
                        />

                        {pinError && (
                            <p className="pin-error">
                                <span>⚠️</span> {pinError}
                            </p>
                        )}

                        <div className="pin-modal-buttons">
                            <button className="btn-cancel" onClick={() => setShowPinModal(false)}>
                                Cancelar
                            </button>
                            <button
                                className="btn-submit"
                                onClick={handlePinSubmit}
                                disabled={pinInput.length !== 4}
                            >
                                Entrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
        </>
    );
}

// CSS Styles
const profileSelectorStyles = `
/* Page Container */
.profile-selector-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
}

/* Animated Background */
.profile-backdrop {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.backdrop-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.4;
    animation: orbFloat 15s ease-in-out infinite;
}

.orb-1 {
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, #a855f7 0%, transparent 70%);
    top: -100px;
    left: -100px;
    animation-delay: 0s;
}

.orb-2 {
    width: 350px;
    height: 350px;
    background: radial-gradient(circle, #ec4899 0%, transparent 70%);
    bottom: -50px;
    right: -50px;
    animation-delay: -5s;
}

.orb-3 {
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, #3b82f6 0%, transparent 70%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    animation-delay: -10s;
}

@keyframes orbFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(30px, -30px) scale(1.1); }
    50% { transform: translate(-20px, 20px) scale(0.9); }
    75% { transform: translate(20px, 30px) scale(1.05); }
}

/* Logo */
.app-logo {
    margin-bottom: 24px;
    animation: logoFloat 4s ease-in-out infinite;
}

@keyframes logoFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

/* Title */
.profile-title {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 48px;
    font-weight: 800;
    color: white;
    margin-bottom: 60px;
    text-align: center;
    letter-spacing: -0.02em;
    animation: fadeInDown 0.8s ease;
}

@keyframes fadeInDown {
    from {
        opacity: 0;
        transform: translateY(-30px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.title-icon {
    font-size: 48px;
    animation: wave 2s ease-in-out infinite;
}

@keyframes wave {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(20deg); }
    75% { transform: rotate(-10deg); }
}

/* Profiles Container */
.profiles-container {
    display: flex;
    flex-wrap: wrap;
    gap: 40px;
    justify-content: center;
    max-width: 1100px;
    margin-bottom: 48px;
}

/* Profile Card Wrapper */
.profile-card-wrapper {
    animation: cardSlideUp 0.6s ease backwards;
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes cardSlideUp {
    from {
        opacity: 0;
        transform: translateY(40px) scale(0.9);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.profile-card-wrapper.hovered {
    transform: translateY(-10px) scale(1.05);
    z-index: 10;
}

/* Add Profile Card */
.add-profile-card {
    width: 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 16px;
    cursor: pointer;
    animation: cardSlideUp 0.6s ease backwards;
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.add-profile-card:hover {
    transform: translateY(-10px) scale(1.05);
}

.add-icon-container {
    position: relative;
    width: 150px;
    height: 150px;
    border-radius: 16px;
    border: 3px dashed rgba(168, 85, 247, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(168, 85, 247, 0.05);
    transition: all 0.3s ease;
}

.add-profile-card:hover .add-icon-container {
    border-color: rgba(168, 85, 247, 0.7);
    background: rgba(168, 85, 247, 0.1);
    border-style: solid;
}

.add-icon {
    font-size: 60px;
    color: rgba(168, 85, 247, 0.5);
    font-weight: 300;
    transition: all 0.3s ease;
}

.add-profile-card:hover .add-icon {
    color: #a855f7;
    transform: rotate(90deg) scale(1.1);
}

.add-icon-glow {
    position: absolute;
    inset: -10px;
    border-radius: 20px;
    background: radial-gradient(circle, rgba(168, 85, 247, 0.2) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.3s ease;
}

.add-profile-card:hover .add-icon-glow {
    opacity: 1;
}

.add-label {
    color: rgba(255, 255, 255, 0.6);
    font-size: 16px;
    font-weight: 600;
    transition: color 0.3s ease;
}

.add-profile-card:hover .add-label {
    color: white;
}

/* Manage Button */
.manage-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 28px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-radius: 14px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    animation: fadeIn 0.8s ease 0.5s backwards;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.manage-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(168, 85, 247, 0.5);
    color: white;
    transform: translateY(-2px);
}

/* PIN Modal */
.pin-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.3s ease;
}

.pin-modal {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border-radius: 24px;
    padding: 40px;
    max-width: 420px;
    width: 90%;
    border: 1px solid rgba(168, 85, 247, 0.2);
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
    animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modalSlideIn {
    from {
        opacity: 0;
        transform: translateY(-50px) scale(0.9);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.pin-modal-header {
    text-align: center;
    margin-bottom: 32px;
}

.pin-profile-icon {
    font-size: 48px;
    margin-bottom: 16px;
    animation: lockBounce 1s ease;
}

@keyframes lockBounce {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.2); }
}

.pin-modal-header h2 {
    font-size: 28px;
    font-weight: 700;
    color: white;
    margin: 0 0 8px 0;
}

.pin-modal-header p {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
    margin: 0;
}

.pin-modal-header strong {
    color: #c4b5fd;
}

/* PIN Input */
.pin-input-container {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-bottom: 24px;
}

.pin-digit {
    width: 60px;
    height: 70px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    color: white;
    transition: all 0.3s ease;
}

.pin-digit.filled {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.1);
    animation: digitFill 0.2s ease;
}

@keyframes digitFill {
    from { transform: scale(1.1); }
    to { transform: scale(1); }
}

.pin-digit.error {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    animation: shake 0.5s ease;
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-8px); }
    75% { transform: translateX(8px); }
}

.hidden-pin-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

/* PIN Error */
.pin-error {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #f87171;
    font-size: 14px;
    margin-bottom: 24px;
    animation: fadeIn 0.3s ease;
}

/* PIN Modal Buttons */
.pin-modal-buttons {
    display: flex;
    gap: 16px;
}

.btn-cancel, .btn-submit {
    flex: 1;
    padding: 14px 24px;
    font-size: 16px;
    font-weight: 600;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.btn-cancel {
    background: transparent;
    border: 2px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.8);
}

.btn-cancel:hover {
    border-color: rgba(255, 255, 255, 0.4);
    color: white;
}

.btn-submit {
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
    border: none;
    color: white;
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.3);
}

.btn-submit:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(168, 85, 247, 0.4);
}

.btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Responsive */
@media (max-width: 768px) {
    .profile-title {
        font-size: 32px;
        flex-direction: column;
        gap: 8px;
    }

    .profiles-container {
        gap: 24px;
    }

    .add-icon-container {
        width: 120px;
        height: 120px;
    }

    .add-icon {
        font-size: 48px;
    }
}
`;
