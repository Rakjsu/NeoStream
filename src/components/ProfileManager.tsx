import { useState } from 'react';
import { profileService } from '../services/profileService';
import type { Profile } from '../types/profile';
import { CreateProfileModal } from './CreateProfileModal';

interface ProfileManagerProps {
    onClose: () => void;
}

export function ProfileManager({ onClose }: ProfileManagerProps) {
    const [profiles, setProfiles] = useState<Profile[]>(profileService.getAllProfiles());
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<Profile | null>(null);

    const activeProfile = profileService.getActiveProfile();

    const handleDeleteProfile = (profile: Profile) => {
        if (profile.id === activeProfile?.id) {
            alert('Não é possível deletar o perfil ativo!');
            return;
        }

        if (profiles.length <= 1) {
            alert('Não é possível deletar o último perfil!');
            return;
        }

        setDeleteConfirm(profile);
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

    const handleProfileUpdated = () => {
        setProfiles(profileService.getAllProfiles());
        setEditingProfile(null);
    };

    return (
        <>
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '40px'
            }}>
                {/* Header */}
                <div style={{
                    width: '100%',
                    maxWidth: '1200px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '40px'
                }}>
                    <h1 style={{ color: 'white', fontSize: '36px', fontWeight: 'bold' }}>
                        Gerenciar Perfis
                    </h1>
                    <button
                        onClick={onClose}
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            border: '2px solid rgba(255, 255, 255, 0.3)',
                            color: 'white',
                            padding: '12px 24px',
                            borderRadius: '8px',
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                    >
                        Voltar
                    </button>
                </div>

                {/* Profiles Grid */}
                <div style={{
                    width: '100%',
                    maxWidth: '1200px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: '32px',
                    marginBottom: '40px'
                }}>
                    {profiles.map((profile) => {
                        const isActive = profile.id === activeProfile?.id;
                        const isImageAvatar = profile.avatar.startsWith('data:image') || profile.avatar.startsWith('http');

                        return (
                            <div
                                key={profile.id}
                                style={{
                                    position: 'relative',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '16px',
                                    padding: '24px',
                                    borderRadius: '12px',
                                    backgroundColor: isActive ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                    border: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                {/* Active Badge */}
                                {isActive && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '8px',
                                        right: '8px',
                                        backgroundColor: '#3b82f6',
                                        color: 'white',
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        fontSize: '12px',
                                        fontWeight: '600'
                                    }}>
                                        Ativo
                                    </div>
                                )}

                                {/* Avatar */}
                                <div style={{
                                    width: '120px',
                                    height: '120px',
                                    borderRadius: '12px',
                                    overflow: 'hidden',
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '3px solid rgba(255, 255, 255, 0.2)'
                                }}>
                                    {isImageAvatar ? (
                                        <img
                                            src={profile.avatar}
                                            alt={profile.name}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <span style={{ fontSize: '60px' }}>{profile.avatar}</span>
                                    )}
                                </div>

                                {/* Name */}
                                <h3 style={{
                                    color: 'white',
                                    fontSize: '18px',
                                    fontWeight: '600',
                                    textAlign: 'center',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    width: '100%'
                                }}>
                                    {profile.name}
                                </h3>

                                {/* PIN Indicator */}
                                {profile.pin && (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: '#9ca3af',
                                        fontSize: '14px'
                                    }}>
                                        <span>🔒</span>
                                        <span>PIN Ativo</span>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                                    <button
                                        onClick={() => setEditingProfile(profile)}
                                        style={{
                                            flex: 1,
                                            padding: '8px 16px',
                                            backgroundColor: 'rgba(59, 130, 246, 0.8)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            fontSize: '14px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.8)'}
                                    >
                                        ✏️ Editar
                                    </button>
                                    <button
                                        onClick={() => handleDeleteProfile(profile)}
                                        disabled={isActive || profiles.length <= 1}
                                        style={{
                                            flex: 1,
                                            padding: '8px 16px',
                                            backgroundColor: isActive || profiles.length <= 1 ? 'rgba(107, 114, 128, 0.3)' : 'rgba(239, 68, 68, 0.8)',
                                            color: isActive || profiles.length <= 1 ? '#6b7280' : 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            fontSize: '14px',
                                            fontWeight: '600',
                                            cursor: isActive || profiles.length <= 1 ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isActive && profiles.length > 1) {
                                                e.currentTarget.style.backgroundColor = '#ef4444';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isActive && profiles.length > 1) {
                                                e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.8)';
                                            }
                                        }}
                                    >
                                        🗑️ Deletar
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {/* Add New Profile Card */}
                    {profiles.length < 5 && (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '16px',
                                padding: '24px',
                                borderRadius: '12px',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '2px dashed rgba(255, 255, 255, 0.3)',
                                transition: 'all 0.3s ease',
                                cursor: 'pointer',
                                minHeight: '280px'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                            }}
                        >
                            <span style={{ fontSize: '60px' }}>➕</span>
                            <span style={{ color: 'white', fontSize: '16px', fontWeight: '600' }}>
                                Adicionar Perfil
                            </span>
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

            {/* Edit Profile Modal - Uses same modal as create since editing not fully implemented */}
            {editingProfile && (
                <CreateProfileModal
                    onClose={() => setEditingProfile(null)}
                    onProfileCreated={handleProfileUpdated}
                />
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10001
                }}>
                    <div style={{
                        backgroundColor: '#1f2937',
                        borderRadius: '16px',
                        padding: '32px',
                        maxWidth: '500px',
                        width: '90%',
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
                    }}>
                        <h2 style={{ color: 'white', fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>
                            Deletar Perfil?
                        </h2>
                        <p style={{ color: '#9ca3af', marginBottom: '24px', lineHeight: '1.6' }}>
                            Tem certeza que deseja deletar o perfil <strong style={{ color: 'white' }}>{deleteConfirm.name}</strong>?
                            Todos os dados associados a este perfil serão perdidos permanentemente.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmDelete}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ef4444'}
                            >
                                Deletar Perfil
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
