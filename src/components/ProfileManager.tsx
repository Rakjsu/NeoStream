import { useState } from 'react';
import { profileService } from '../services/profileService';
import type { Profile } from '../types/profile';
import { CreateProfileModal } from './CreateProfileModal';
import { X, Edit2, Trash2, Plus, Lock, Check } from 'lucide-react';

interface ProfileManagerProps {
    onClose: () => void;
}

export function ProfileManager({ onClose }: ProfileManagerProps) {
    const [profiles, setProfiles] = useState<Profile[]>(profileService.getAllProfiles());
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<Profile | null>(null);
    const [editName, setEditName] = useState('');
    const [editAvatar, setEditAvatar] = useState('');

    // PIN verification states
    const [pendingActivation, setPendingActivation] = useState<Profile | null>(null);
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState('');

    // Delete PIN verification states
    const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);
    const [deletePinInput, setDeletePinInput] = useState('');
    const [deletePinError, setDeletePinError] = useState('');

    const activeProfile = profileService.getActiveProfile();

    const avatarOptions = ['👤', '👨', '👩', '🧒', '👴', '👵', '🐱', '🐶', '🦊', '🐼', '🎮', '🎬', '🎧', '🎸', '⚽', '🏀'];

    const handleDeleteProfile = (profile: Profile) => {
        if (profile.id === activeProfile?.id) {
            alert('Não é possível deletar o perfil ativo!');
            return;
        }

        if (profiles.length <= 1) {
            alert('Não é possível deletar o último perfil!');
            return;
        }

        // Kids profile cannot be deleted
        if (profile.isKids) {
            alert('O perfil Kids não pode ser deletado!');
            return;
        }

        // Check if profile has PIN - require verification
        if (profile.pin) {
            setPendingDelete(profile);
            setDeletePinInput('');
            setDeletePinError('');
        } else {
            setDeleteConfirm(profile);
        }
    };

    const handleDeletePinSubmit = async () => {
        if (!pendingDelete || deletePinInput.length !== 4) return;

        const isValid = await profileService.verifyPin(pendingDelete.id, deletePinInput);
        if (isValid) {
            profileService.deleteProfile(pendingDelete.id);
            setProfiles(profileService.getAllProfiles());
            setPendingDelete(null);
        } else {
            setDeletePinError('PIN incorreto');
            setDeletePinInput('');
        }
    };

    const confirmDelete = () => {
        if (deleteConfirm) {
            profileService.deleteProfile(deleteConfirm.id);
            setProfiles(profileService.getAllProfiles());
            setDeleteConfirm(null);
        }
    };

    const handleProfileCreated = () => {
        setProfiles(profileService.getAllProfiles());
        setShowCreateModal(false);
    };

    // Edit PIN states
    const [showEditPin, setShowEditPin] = useState(false);
    const [pinEditStep, setPinEditStep] = useState<'verify' | 'new' | 'confirm'>('verify');
    const [currentPinInput, setCurrentPinInput] = useState('');
    const [newPinInput, setNewPinInput] = useState('');
    const [confirmPinInput, setConfirmPinInput] = useState('');
    const [editPinError, setEditPinError] = useState('');

    const handleStartEditPin = () => {
        if (editingProfile?.pin) {
            setPinEditStep('verify');
        } else {
            setPinEditStep('new');
        }
        setCurrentPinInput('');
        setNewPinInput('');
        setConfirmPinInput('');
        setEditPinError('');
        setShowEditPin(true);
    };

    const handleEditPinSubmit = async () => {
        if (!editingProfile) return;

        if (pinEditStep === 'verify') {
            const isValid = await profileService.verifyPin(editingProfile.id, currentPinInput);
            if (isValid) {
                setPinEditStep('new');
                setEditPinError('');
            } else {
                setEditPinError('PIN atual incorreto');
                setCurrentPinInput('');
            }
        } else if (pinEditStep === 'new') {
            if (newPinInput.length === 4) {
                setPinEditStep('confirm');
                setEditPinError('');
            }
        } else if (pinEditStep === 'confirm') {
            if (confirmPinInput === newPinInput) {
                await profileService.updateProfile(editingProfile.id, { pin: newPinInput });
                setShowEditPin(false);
                const updatedProfiles = profileService.getAllProfiles();
                setProfiles(updatedProfiles);
                // Update editingProfile to refresh button text
                const updatedProfile = updatedProfiles.find(p => p.id === editingProfile.id);
                if (updatedProfile) setEditingProfile(updatedProfile);
            } else {
                setEditPinError('Os PINs não coincidem');
                setConfirmPinInput('');
            }
        }
    };

    const handleRemovePin = async () => {
        if (!editingProfile) return;

        if (editingProfile.pin) {
            const isValid = await profileService.verifyPin(editingProfile.id, currentPinInput);
            if (isValid) {
                await profileService.updateProfile(editingProfile.id, { pin: null });
                setShowEditPin(false);
                const updatedProfiles = profileService.getAllProfiles();
                setProfiles(updatedProfiles);
                // Update editingProfile to refresh button text
                const updatedProfile = updatedProfiles.find(p => p.id === editingProfile.id);
                if (updatedProfile) setEditingProfile(updatedProfile);
            } else {
                setEditPinError('PIN incorreto');
                setCurrentPinInput('');
            }
        }
    };

    const handleEditClick = (profile: Profile) => {
        setEditingProfile(profile);
        setEditName(profile.name);
        setEditAvatar(profile.avatar);
    };

    const handleActivateProfile = (profile: Profile) => {
        // Check if profile has PIN
        if (profile.pin) {
            setPendingActivation(profile);
            setPinInput('');
            setPinError('');
        } else {
            // No PIN, activate directly
            profileService.setActiveProfile(profile.id);
            setProfiles(profileService.getAllProfiles());
            onClose();
            // Reload to refresh Continue Watching and Favorites
            window.location.reload();
        }
    };

    const handlePinSubmit = async () => {
        if (!pendingActivation || pinInput.length !== 4) return;

        const isValid = await profileService.verifyPin(pendingActivation.id, pinInput);
        if (isValid) {
            profileService.setActiveProfile(pendingActivation.id);
            setProfiles(profileService.getAllProfiles());
            setPendingActivation(null);
            onClose();
            // Reload to refresh Continue Watching and Favorites
            window.location.reload();
        } else {
            setPinError('PIN incorreto');
            setPinInput('');
        }
    };

    const handleSaveEdit = async () => {
        if (editingProfile && editName.trim()) {
            await profileService.updateProfile(editingProfile.id, {
                name: editName.trim(),
                avatar: editAvatar
            });
            setProfiles(profileService.getAllProfiles());
            setEditingProfile(null);
        }
    };

    return (
        <>
            <style>{profileManagerStyles}</style>
            <div className="profile-manager-overlay">
                {/* Animated Background */}
                <div className="pm-backdrop">
                    <div className="pm-orb pm-orb-1" />
                    <div className="pm-orb pm-orb-2" />
                    <div className="pm-orb pm-orb-3" />
                </div>

                {/* Header */}
                <div className="pm-header">
                    <h1 className="pm-title">
                        <span className="pm-title-icon">👥</span>
                        Gerenciar Perfis
                    </h1>
                    <button className="pm-close-btn" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>

                {/* Profiles Grid */}
                <div className="pm-profiles-grid">
                    {/* Sort: Kids profiles always last */}
                    {[...profiles].sort((a, b) => {
                        if (a.isKids && !b.isKids) return 1;
                        if (!a.isKids && b.isKids) return -1;
                        return 0;
                    }).map((profile, index) => {
                        const isActive = profile.id === activeProfile?.id;
                        const isImageAvatar = profile.avatar.startsWith('data:image') || profile.avatar.startsWith('http');

                        return (
                            <div
                                key={profile.id}
                                className={`pm-profile-card ${isActive ? 'active' : ''}`}
                                style={{ animationDelay: `${index * 0.1}s`, cursor: isActive ? 'default' : 'pointer' }}
                                onClick={() => !isActive && handleActivateProfile(profile)}
                            >
                                {/* Active Badge */}
                                {isActive && (
                                    <div className="pm-active-badge">
                                        <Check size={12} />
                                        <span>Ativo</span>
                                    </div>
                                )}

                                {/* Avatar */}
                                <div className="pm-avatar">
                                    {isImageAvatar ? (
                                        <img src={profile.avatar} alt={profile.name} />
                                    ) : (
                                        <span className="pm-avatar-emoji">{profile.avatar}</span>
                                    )}
                                </div>

                                {/* Name */}
                                <h3 className="pm-profile-name">
                                    {profile.name}
                                    {profile.isKids && (
                                        <span className="pm-kids-badge">👶 Kids</span>
                                    )}
                                </h3>

                                {/* PIN Indicator */}
                                {profile.pin && (
                                    <div className="pm-pin-indicator">
                                        <Lock size={14} />
                                        <span>PIN Ativo</span>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                {/* Hide Edit/Delete buttons for Kids profile */}
                                {!profile.isKids && (
                                    <div className="pm-actions">
                                        <button
                                            className="pm-btn pm-btn-edit"
                                            onClick={(e) => { e.stopPropagation(); handleEditClick(profile); }}
                                        >
                                            <Edit2 size={16} />
                                            <span>Editar</span>
                                        </button>
                                        <button
                                            className="pm-btn pm-btn-delete"
                                            onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile); }}
                                            disabled={isActive || profiles.length <= 1}
                                        >
                                            <Trash2 size={16} />
                                            <span>Deletar</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Add New Profile Card */}
                    {profiles.length < 5 && (
                        <button
                            className="pm-add-card"
                            onClick={() => setShowCreateModal(true)}
                            style={{ animationDelay: `${profiles.length * 0.1}s` }}
                        >
                            <div className="pm-add-icon">
                                <Plus size={40} />
                            </div>
                            <span className="pm-add-label">Adicionar Perfil</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Create Profile Modal */}
            {showCreateModal && (
                <CreateProfileModal
                    onClose={() => setShowCreateModal(false)}
                    onProfileCreated={handleProfileCreated}
                />
            )}

            {/* Edit Profile Modal */}
            {editingProfile && (
                <div className="pm-modal-overlay" onClick={() => setEditingProfile(null)}>
                    <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="pm-modal-header">
                            <span className="pm-modal-icon">✏️</span>
                            <h2>Editar Perfil</h2>
                        </div>

                        <div className="pm-edit-form">
                            <label className="pm-label">Nome do Perfil</label>
                            <input
                                type="text"
                                className="pm-input"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Digite o nome"
                                maxLength={20}
                            />

                            <label className="pm-label">Avatar</label>
                            <div className="pm-avatar-grid">
                                {avatarOptions.map((avatar) => (
                                    <button
                                        key={avatar}
                                        className={`pm-avatar-option ${editAvatar === avatar ? 'selected' : ''}`}
                                        onClick={() => setEditAvatar(avatar)}
                                    >
                                        {avatar}
                                    </button>
                                ))}
                            </div>

                            {/* Edit PIN Button */}
                            <button
                                className="pm-edit-pin-btn"
                                onClick={handleStartEditPin}
                            >
                                <Lock size={16} />
                                {editingProfile.pin ? 'Alterar PIN' : 'Adicionar PIN'}
                            </button>
                        </div>

                        <div className="pm-modal-buttons">
                            <button className="pm-btn pm-btn-cancel" onClick={() => setEditingProfile(null)}>
                                Cancelar
                            </button>
                            <button
                                className="pm-btn pm-btn-save"
                                onClick={handleSaveEdit}
                                disabled={!editName.trim()}
                            >
                                <Check size={18} />
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="pm-modal-overlay" onClick={() => setDeleteConfirm(null)}>
                    <div className="pm-modal pm-modal-delete" onClick={(e) => e.stopPropagation()}>
                        <div className="pm-modal-header">
                            <span className="pm-modal-icon danger">🗑️</span>
                            <h2>Deletar Perfil?</h2>
                        </div>

                        <p className="pm-delete-msg">
                            Tem certeza que deseja deletar o perfil <strong>{deleteConfirm.name}</strong>?
                            <br />
                            <span className="pm-delete-warning">Esta ação não pode ser desfeita.</span>
                        </p>

                        <div className="pm-modal-buttons">
                            <button className="pm-btn pm-btn-cancel" onClick={() => setDeleteConfirm(null)}>
                                Cancelar
                            </button>
                            <button className="pm-btn pm-btn-danger" onClick={confirmDelete}>
                                <Trash2 size={18} />
                                Deletar Perfil
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PIN Verification Modal */}
            {pendingActivation && (
                <div className="pm-pin-overlay" onClick={() => setPendingActivation(null)}>
                    <div className="pm-pin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="pm-pin-header">
                            <span className="pm-pin-icon">🔐</span>
                            <h2>Digite o PIN</h2>
                            <p>Perfil: <strong>{pendingActivation.name}</strong></p>
                        </div>

                        <div
                            className="pm-pin-input-container"
                            onClick={() => document.getElementById('pm-pin-input')?.focus()}
                        >
                            {[0, 1, 2, 3].map((index) => (
                                <div
                                    key={index}
                                    className={`pm-pin-digit ${pinInput.length > index ? 'filled' : ''} ${pinError ? 'error' : ''}`}
                                >
                                    {pinInput[index] ? '•' : ''}
                                </div>
                            ))}
                        </div>

                        <input
                            id="pm-pin-input"
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
                            className="pm-hidden-pin-input"
                        />

                        {pinError && (
                            <p className="pm-pin-error">
                                <span>⚠️</span> {pinError}
                            </p>
                        )}

                        <div className="pm-pin-buttons">
                            <button className="pm-pin-btn cancel" onClick={() => setPendingActivation(null)}>
                                Cancelar
                            </button>
                            <button
                                className="pm-pin-btn submit"
                                onClick={handlePinSubmit}
                                disabled={pinInput.length !== 4}
                            >
                                <Check size={18} />
                                Entrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete PIN Verification Modal */}
            {pendingDelete && (
                <div className="pm-pin-overlay" onClick={() => setPendingDelete(null)}>
                    <div className="pm-pin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="pm-pin-header">
                            <span className="pm-pin-icon">🗑️</span>
                            <h2>Confirmar Exclusão</h2>
                            <p>Digite o PIN para deletar <strong>{pendingDelete.name}</strong></p>
                        </div>

                        <div
                            className="pm-pin-input-container"
                            onClick={() => document.getElementById('pm-delete-pin-input')?.focus()}
                        >
                            {[0, 1, 2, 3].map((index) => (
                                <div
                                    key={index}
                                    className={`pm-pin-digit ${deletePinInput.length > index ? 'filled' : ''} ${deletePinError ? 'error' : ''}`}
                                >
                                    {deletePinInput[index] ? '•' : ''}
                                </div>
                            ))}
                        </div>

                        <input
                            id="pm-delete-pin-input"
                            type="password"
                            maxLength={4}
                            value={deletePinInput}
                            onChange={(e) => {
                                setDeletePinInput(e.target.value.replace(/\D/g, ''));
                                setDeletePinError('');
                            }}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter' && deletePinInput.length === 4) {
                                    handleDeletePinSubmit();
                                }
                            }}
                            autoFocus
                            className="pm-hidden-pin-input"
                        />

                        {deletePinError && (
                            <p className="pm-pin-error">
                                <span>⚠️</span> {deletePinError}
                            </p>
                        )}

                        <div className="pm-pin-buttons">
                            <button className="pm-pin-btn cancel" onClick={() => setPendingDelete(null)}>
                                Cancelar
                            </button>
                            <button
                                className="pm-pin-btn submit"
                                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                                onClick={handleDeletePinSubmit}
                                disabled={deletePinInput.length !== 4}
                            >
                                <Trash2 size={18} />
                                Deletar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit PIN Modal */}
            {showEditPin && editingProfile && (
                <div className="pm-pin-overlay" onClick={() => setShowEditPin(false)}>
                    <div className="pm-pin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="pm-pin-header">
                            <span className="pm-pin-icon">🔑</span>
                            <h2>
                                {pinEditStep === 'verify' && 'PIN Atual'}
                                {pinEditStep === 'new' && 'Novo PIN'}
                                {pinEditStep === 'confirm' && 'Confirmar PIN'}
                            </h2>
                            <p>
                                {pinEditStep === 'verify' && 'Digite seu PIN atual'}
                                {pinEditStep === 'new' && 'Digite o novo PIN de 4 dígitos'}
                                {pinEditStep === 'confirm' && 'Digite o novo PIN novamente'}
                            </p>
                        </div>

                        <div
                            className="pm-pin-input-container"
                            onClick={() => document.getElementById('pm-edit-pin-input')?.focus()}
                        >
                            {[0, 1, 2, 3].map((index) => {
                                const value = pinEditStep === 'verify' ? currentPinInput :
                                    pinEditStep === 'new' ? newPinInput : confirmPinInput;
                                return (
                                    <div
                                        key={index}
                                        className={`pm-pin-digit ${value.length > index ? 'filled' : ''} ${editPinError ? 'error' : ''}`}
                                    >
                                        {value[index] ? '•' : ''}
                                    </div>
                                );
                            })}
                        </div>

                        <input
                            id="pm-edit-pin-input"
                            type="password"
                            maxLength={4}
                            value={pinEditStep === 'verify' ? currentPinInput : pinEditStep === 'new' ? newPinInput : confirmPinInput}
                            onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '');
                                setEditPinError('');
                                if (pinEditStep === 'verify') setCurrentPinInput(val);
                                else if (pinEditStep === 'new') setNewPinInput(val);
                                else setConfirmPinInput(val);
                            }}
                            onKeyPress={(e) => {
                                const val = pinEditStep === 'verify' ? currentPinInput : pinEditStep === 'new' ? newPinInput : confirmPinInput;
                                if (e.key === 'Enter' && val.length === 4) {
                                    handleEditPinSubmit();
                                }
                            }}
                            autoFocus
                            className="pm-hidden-pin-input"
                        />

                        {editPinError && (
                            <p className="pm-pin-error">
                                <span>⚠️</span> {editPinError}
                            </p>
                        )}

                        <div className="pm-pin-buttons">
                            <button className="pm-pin-btn cancel" onClick={() => setShowEditPin(false)}>
                                Cancelar
                            </button>
                            {pinEditStep === 'verify' && editingProfile.pin && (
                                <button
                                    className="pm-pin-btn submit"
                                    style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                                    onClick={handleRemovePin}
                                    disabled={currentPinInput.length !== 4}
                                >
                                    <Trash2 size={18} />
                                    Remover PIN
                                </button>
                            )}
                            <button
                                className="pm-pin-btn submit"
                                onClick={handleEditPinSubmit}
                                disabled={(pinEditStep === 'verify' ? currentPinInput : pinEditStep === 'new' ? newPinInput : confirmPinInput).length !== 4}
                            >
                                <Check size={18} />
                                {pinEditStep === 'confirm' ? 'Salvar' : 'Continuar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// CSS Styles
const profileManagerStyles = `
            /* Overlay */
            .profile-manager-overlay {
                position: fixed;
            inset: 0;
            background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 40px;
            overflow-y: auto;
            animation: pmFadeIn 0.4s ease;
}

            @keyframes pmFadeIn {
                from {opacity: 0; }
            to {opacity: 1; }
}

            /* Animated Background */
            .pm-backdrop {
                position: absolute;
            inset: 0;
            pointer-events: none;
            overflow: hidden;
}

            .pm-orb {
                position: absolute;
            border-radius: 50%;
            filter: blur(80px);
            opacity: 0.4;
            animation: pmOrbFloat 15s ease-in-out infinite;
}

            .pm-orb-1 {
                width: 400px;
            height: 400px;
            background: radial-gradient(circle, #a855f7 0%, transparent 70%);
            top: -100px;
            left: -100px;
}

            .pm-orb-2 {
                width: 350px;
            height: 350px;
            background: radial-gradient(circle, #ec4899 0%, transparent 70%);
            bottom: -50px;
            right: -50px;
            animation-delay: -5s;
}

            .pm-orb-3 {
                width: 300px;
            height: 300px;
            background: radial-gradient(circle, #3b82f6 0%, transparent 70%);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            animation-delay: -10s;
}

            @keyframes pmOrbFloat {
                0 %, 100 % { transform: translate(0, 0) scale(1); }
    25% {transform: translate(30px, -30px) scale(1.1); }
            50% {transform: translate(-20px, 20px) scale(0.9); }
            75% {transform: translate(20px, 30px) scale(1.05); }
}

            /* Header */
            .pm-header {
                width: 100%;
            max-width: 1200px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 40px;
            position: relative;
            z-index: 1;
            animation: pmSlideDown 0.6s ease;
}

            @keyframes pmSlideDown {
                from {opacity: 0; transform: translateY(-30px); }
            to {opacity: 1; transform: translateY(0); }
}

            .pm-title {
                display: flex;
            align-items: center;
            gap: 16px;
            color: white;
            font-size: 36px;
            font-weight: 800;
            letter-spacing: -0.02em;
}

            .pm-title-icon {
                font - size: 40px;
            animation: pmWave 2s ease-in-out infinite;
}

            @keyframes pmWave {
                0 %, 100 % { transform: rotate(0deg); }
    25% {transform: rotate(15deg); }
            75% {transform: rotate(-10deg); }
}

            .pm-close-btn {
                width: 48px;
            height: 48px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid rgba(255, 255, 255, 0.2);
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
}

            .pm-close-btn:hover {
                background: rgba(255, 255, 255, 0.2);
            border-color: rgba(255, 255, 255, 0.4);
            transform: rotate(90deg);
}

            /* Profiles Grid - Dynamic horizontal layout */
            .pm-profiles-grid {
                width: 100%;
            max-width: 1400px;
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 24px;
            position: relative;
            z-index: 1;
}

            /* Profile Card */
            .pm-profile-card {
                position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            padding: 28px 20px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.05);
            border: 2px solid rgba(255, 255, 255, 0.1);
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            animation: pmCardSlideUp 0.6s ease backwards;
            width: 230px;
            flex-shrink: 0;
}

            @keyframes pmCardSlideUp {
                from {opacity: 0; transform: translateY(40px) scale(0.9); }
            to {opacity: 1; transform: translateY(0) scale(1); }
}

            .pm-profile-card:hover {
                transform: translateY(-8px);
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(168, 85, 247, 0.4);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

            .pm-profile-card.active {
                background: rgba(59, 130, 246, 0.15);
            border-color: #3b82f6;
}

            /* Active Badge */
            .pm-active-badge {
                position: absolute;
            top: 12px;
            right: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            color: white;
            padding: 6px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            animation: pmBadgePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

            @keyframes pmBadgePop {
                from {transform: scale(0); }
            to {transform: scale(1); }
}

            /* Avatar */
            .pm-avatar {
                width: 100px;
            height: 100px;
            border-radius: 50%;
            overflow: hidden;
            background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2));
            border: 3px solid rgba(255, 255, 255, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
}

            .pm-profile-card:hover .pm-avatar {
                border - color: rgba(168, 85, 247, 0.6);
            transform: scale(1.05);
}

            .pm-avatar img {
                width: 100%;
            height: 100%;
            object-fit: cover;
}

            .pm-avatar-emoji {
                font-size: 60px;
}

            /* Profile Name */
            .pm-profile-name {
                color: white;
            font-size: 18px;
            font-weight: 600;
            text-align: center;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
}

/* Kids Badge */
.pm-kids-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 700;
    border-radius: 20px;
    background: linear-gradient(135deg, #ec4899, #db2777);
    color: white;
    vertical-align: middle;
}

            /* PIN Indicator */
            .pm-pin-indicator {
                display: flex;
            align-items: center;
            gap: 6px;
            color: #9ca3af;
            font-size: 13px;
}

            /* Action Buttons */
            .pm-actions {
                display: flex;
            gap: 8px;
            width: 100%;
            margin-top: 8px;
}

            .pm-btn {
                flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 14px;
            border: none;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
}

            .pm-btn-edit {
                background: linear-gradient(135deg, rgba(59, 130, 246, 0.8), rgba(37, 99, 235, 0.8));
            color: white;
}

            .pm-btn-edit:hover {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.3);
}

            .pm-btn-activate {
                background: linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8));
            color: white;
}

            .pm-btn-activate:hover {
                background: linear-gradient(135deg, #22c55e, #16a34a);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(34, 197, 94, 0.3);
}

            .pm-btn-delete {
                background: rgba(239, 68, 68, 0.15);
            color: #f87171;
}

            .pm-btn-delete:hover:not(:disabled) {
                background: rgba(239, 68, 68, 0.9);
            color: white;
            transform: translateY(-2px);
}

            .pm-btn-delete:disabled {
                opacity: 0.3;
            cursor: not-allowed;
}

            /* Add Profile Card */
            .pm-add-card {
                display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding: 28px 20px;
            min-height: 280px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.03);
            border: 3px dashed rgba(168, 85, 247, 0.3);
            cursor: pointer;
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            animation: pmCardSlideUp 0.6s ease backwards;
}

            .pm-add-card:hover {
                background: rgba(168, 85, 247, 0.1);
            border-color: #a855f7;
            transform: translateY(-8px) scale(1.02);
}

            .pm-add-icon {
                width: 80px;
            height: 80px;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2));
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(168, 85, 247, 0.8);
            transition: all 0.3s ease;
}

            .pm-add-card:hover .pm-add-icon {
                background: linear-gradient(135deg, #a855f7, #ec4899);
            color: white;
            transform: rotate(90deg) scale(1.1);
}

            .pm-add-label {
                color: rgba(255, 255, 255, 0.6);
            font-size: 16px;
            font-weight: 600;
            transition: color 0.3s ease;
}

            .pm-add-card:hover .pm-add-label {
                color: white;
}

/* Edit PIN Button */
.pm-edit-pin-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 12px 16px;
    margin-top: 16px;
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 12px;
    color: #c4b5fd;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}

.pm-edit-pin-btn:hover {
    background: rgba(168, 85, 247, 0.3);
    border-color: rgba(168, 85, 247, 0.5);
    color: white;
    transform: translateY(-2px);
}

            /* Modal Overlay */
            .pm-modal-overlay {
                position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
            animation: pmFadeIn 0.3s ease;
}

            /* Modal */
            .pm-modal {
                background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border-radius: 24px;
            padding: 32px;
            max-width: 480px;
            width: 90%;
            border: 1px solid rgba(168, 85, 247, 0.2);
            box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
            animation: pmModalSlide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

            @keyframes pmModalSlide {
                from {opacity: 0; transform: translateY(-50px) scale(0.9); }
            to {opacity: 1; transform: translateY(0) scale(1); }
}

            .pm-modal-header {
                text - align: center;
            margin-bottom: 28px;
}

            .pm-modal-icon {
                font - size: 48px;
            display: block;
            margin-bottom: 12px;
}

            .pm-modal-icon.danger {
                animation: pmShake 0.5s ease;
}

            @keyframes pmShake {
                0 %, 100 % { transform: translateX(0); }
    25% {transform: translateX(-8px); }
            75% {transform: translateX(8px); }
}

            .pm-modal h2 {
                color: white;
            font-size: 24px;
            font-weight: 700;
}

            /* Edit Form */
            .pm-edit-form {
                display: flex;
            flex-direction: column;
            gap: 16px;
            margin-bottom: 28px;
}

            .pm-label {
                color: #9ca3af;
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
}

            .pm-input {
                width: 100%;
            padding: 14px 16px;
            background: rgba(255, 255, 255, 0.08);
            border: 2px solid rgba(255, 255, 255, 0.15);
            border-radius: 12px;
            color: white;
            font-size: 16px;
            outline: none;
            transition: all 0.3s ease;
}

            .pm-input:focus {
                border - color: #a855f7;
            background: rgba(168, 85, 247, 0.1);
}

            .pm-avatar-grid {
                display: grid;
            grid-template-columns: repeat(8, 1fr);
            gap: 8px;
}

            .pm-avatar-option {
                width: 44px;
            height: 44px;
            background: rgba(255, 255, 255, 0.08);
            border: 2px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            font-size: 22px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
}

            .pm-avatar-option:hover {
                border - color: rgba(168, 85, 247, 0.5);
            background: rgba(168, 85, 247, 0.1);
            transform: scale(1.1);
}

            .pm-avatar-option.selected {
                border - color: #a855f7;
            background: rgba(168, 85, 247, 0.3);
            transform: scale(1.1);
}

            /* Delete Message */
            .pm-delete-msg {
                color: #9ca3af;
            text-align: center;
            line-height: 1.6;
            margin-bottom: 28px;
}

            .pm-delete-msg strong {
                color: white;
}

            .pm-delete-warning {
                color: #f87171;
            font-size: 13px;
            display: block;
            margin-top: 8px;
}

            /* Modal Buttons */
            .pm-modal-buttons {
                display: flex;
            gap: 12px;
}

            .pm-btn-cancel {
                flex: 1;
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.8);
            border: 2px solid rgba(255, 255, 255, 0.2);
}

            .pm-btn-cancel:hover {
                background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.4);
            color: white;
}

            .pm-btn-save {
                flex: 1;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            color: white;
            box-shadow: 0 8px 24px rgba(168, 85, 247, 0.3);
}

            .pm-btn-save:hover:not(:disabled) {
                transform: translateY(-2px);
            box-shadow: 0 12px 32px rgba(168, 85, 247, 0.4);
}

            .pm-btn-save:disabled {
                opacity: 0.5;
            cursor: not-allowed;
}

            .pm-btn-danger {
                flex: 1;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: white;
            box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
}

            .pm-btn-danger:hover {
                transform: translateY(-2px);
            box-shadow: 0 12px 32px rgba(239, 68, 68, 0.4);
}

/* PIN Verification Modal */
.pm-pin-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10002;
    animation: pmPinFadeIn 0.3s ease;
}

@keyframes pmPinFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.pm-pin-modal {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border-radius: 20px;
    padding: 32px;
    max-width: 480px;
    width: 95%;
    border: 1px solid rgba(168, 85, 247, 0.3);
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
    animation: pmPinModalSlide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes pmPinModalSlide {
    from { opacity: 0; transform: translateY(-30px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

.pm-pin-header {
    text-align: center;
    margin-bottom: 24px;
}

.pm-pin-icon {
    font-size: 48px;
    display: block;
    margin-bottom: 12px;
    animation: pmPinBounce 0.6s ease;
}

@keyframes pmPinBounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

.pm-pin-header h2 {
    color: white;
    font-size: 24px;
    font-weight: 700;
    margin: 0 0 8px 0;
}

.pm-pin-header p {
    color: #9ca3af;
    font-size: 14px;
    margin: 0;
}

.pm-pin-header strong {
    color: #c4b5fd;
}

.pm-pin-input-container {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin: 24px 0;
    position: relative;
    cursor: text;
}

.pm-pin-digit {
    width: 56px;
    height: 64px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    color: white;
    transition: all 0.2s ease;
}

.pm-pin-digit.filled {
    border-color: rgba(168, 85, 247, 0.7);
    background: rgba(168, 85, 247, 0.15);
    animation: pmPinPop 0.2s ease;
}

@keyframes pmPinPop {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); }
}

.pm-pin-digit.error {
    border-color: rgba(239, 68, 68, 0.7);
    animation: pmPinShake 0.5s ease;
}

@keyframes pmPinShake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-8px); }
    80% { transform: translateX(8px); }
}

.pm-hidden-pin-input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 64px;
    opacity: 0;
    font-size: 32px;
    text-align: center;
    background: transparent;
    border: none;
    outline: none;
}

.pm-pin-error {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #f87171;
    font-size: 14px;
    margin-bottom: 16px;
    animation: pmPinFadeIn 0.3s ease;
}

.pm-pin-buttons {
    display: flex;
    gap: 12px;
    margin-top: 24px;
}

.pm-pin-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
}

.pm-pin-btn.cancel {
    background: rgba(255, 255, 255, 0.1);
    color: #9ca3af;
}

.pm-pin-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.15);
    color: white;
}

.pm-pin-btn.submit {
    background: linear-gradient(135deg, #a855f7, #7c3aed);
    color: white;
}

.pm-pin-btn.submit:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.4);
}

.pm-pin-btn.submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

            /* Responsive */
            @media (max-width: 768px) {
    .profile - manager - overlay {
                padding: 20px;
    }

            .pm-title {
                font - size: 24px;
    }

            .pm-profiles-grid {
                grid - template - columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 16px;
    }

            .pm-avatar-grid {
                grid - template - columns: repeat(6, 1fr);
    }
}
            `;
