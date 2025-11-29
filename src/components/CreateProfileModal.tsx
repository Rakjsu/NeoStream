import { useState, useRef } from 'react';
import { profileService } from '../services/profileService';

interface CreateProfileModalProps {
    onClose: () => void;
    onProfileCreated: () => void;
}

const DEFAULT_EMOJIS = ['👤', '👨', '👩', '🧑', '👦', '👧', '🧒', '👨‍💼', '👩‍💼', '🧑‍🎓', '👨‍🎓', '👩‍🎓', '🧑‍💻', '👨‍💻', '👩‍💻', '🦸', '🦸‍♂️', '🦸‍♀️'];

export function CreateProfileModal({ onClose, onProfileCreated }: CreateProfileModalProps) {
    const [name, setName] = useState('');
    const [selectedEmoji, setSelectedEmoji] = useState('👤');
    const [avatarImage, setAvatarImage] = useState<string | null>(null);
    const [useEmoji, setUseEmoji] = useState(true);
    const [usePin, setUsePin] = useState(false);
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Check file size (max 50KB)
        if (file.size > 50 * 1024) {
            setError('Imagem muito grande! Máximo 50KB.');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            setAvatarImage(reader.result as string);
            setUseEmoji(false);
        };
        reader.readAsDataURL(file);
    };

    const handleCreate = async () => {
        setError('');

        // Validate name
        if (!name.trim()) {
            setError('Nome é obrigatório');
            return;
        }

        if (name.length > 20) {
            setError('Nome deve ter no máximo 20 caracteres');
            return;
        }

        // Validate PIN if enabled
        if (usePin) {
            if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
                setError('PIN deve ter exatamente 4 dígitos');
                return;
            }

            if (pin !== confirmPin) {
                setError('PINs não conferem');
                return;
            }
        }

        const avatar = useEmoji ? selectedEmoji : (avatarImage || '👤');
        const profileData = {
            name: name.trim(),
            avatar,
            pin: usePin ? pin : undefined
        };

        const newProfile = await profileService.createProfile(profileData);
        if (newProfile) {
            onProfileCreated();
            onClose();
        } else {
            setError('Erro ao criar perfil. Limite de 5 perfis atingido?');
        }
    };

    return (
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
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    backgroundColor: '#1e293b',
                    borderRadius: '16px',
                    padding: '40px',
                    maxWidth: '500px',
                    width: '90%',
                    maxHeight: '90vh',
                    overflowY: 'auto'
                }}
            >
                <h2 style={{ color: 'white', fontSize: '32px', marginBottom: '24px' }}>
                    Criar Novo Perfil
                </h2>

                {/* Name */}
                <div style={{ marginBottom: '24px' }}>
                    <label style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px', display: 'block', marginBottom: '8px' }}>
                        Nome
                    </label>
                    <input
                        type="text"
                        maxLength={20}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Digite o nome"
                        style={{
                            width: '100%',
                            padding: '12px',
                            fontSize: '16px',
                            borderRadius: '8px',
                            border: '2px solid rgba(255, 255, 255, 0.2)',
                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                            color: 'white'
                        }}
                    />
                    <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '12px' }}>
                        {name.length}/20
                    </span>
                </div>

                {/* Avatar Selection */}
                <div style={{ marginBottom: '24px' }}>
                    <label style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px', display: 'block', marginBottom: '8px' }}>
                        Avatar
                    </label>

                    {/* Toggle between Emoji and Image */}
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                        <button
                            onClick={() => setUseEmoji(true)}
                            style={{
                                flex: 1,
                                padding: '8px',
                                borderRadius: '8px',
                                border: useEmoji ? '2px solid #3b82f6' : '2px solid rgba(255, 255, 255, 0.2)',
                                backgroundColor: useEmoji ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                color: 'white',
                                cursor: 'pointer'
                            }}
                        >
                            😀 Emoji
                        </button>
                        <button
                            onClick={() => {
                                setUseEmoji(false);
                                fileInputRef.current?.click();
                            }}
                            style={{
                                flex: 1,
                                padding: '8px',
                                borderRadius: '8px',
                                border: !useEmoji ? '2px solid #3b82f6' : '2px solid rgba(255, 255, 255, 0.2)',
                                backgroundColor: !useEmoji ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                color: 'white',
                                cursor: 'pointer'
                            }}
                        >
                            🖼️ Imagem
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            style={{ display: 'none' }}
                        />
                    </div>

                    {/* Emoji Grid */}
                    {useEmoji && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(6, 1fr)',
                            gap: '8px'
                        }}>
                            {DEFAULT_EMOJIS.map((emoji) => (
                                <button
                                    key={emoji}
                                    onClick={() => setSelectedEmoji(emoji)}
                                    style={{
                                        padding: '12px',
                                        fontSize: '32px',
                                        borderRadius: '8px',
                                        border: selectedEmoji === emoji ? '2px solid #3b82f6' : '2px solid rgba(255, 255, 255, 0.1)',
                                        backgroundColor: selectedEmoji === emoji ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Image Preview */}
                    {!useEmoji && avatarImage && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <img
                                src={avatarImage}
                                alt="Avatar preview"
                                style={{
                                    width: '80px',
                                    height: '80px',
                                    borderRadius: '8px',
                                    objectFit: 'cover'
                                }}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    border: '2px solid rgba(255, 255, 255, 0.2)',
                                    backgroundColor: 'transparent',
                                    color: 'white',
                                    cursor: 'pointer'
                                }}
                            >
                                Alterar Imagem
                            </button>
                        </div>
                    )}
                </div>

                {/* PIN Protection */}
                <div style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={usePin}
                            onChange={(e) => setUsePin(e.target.checked)}
                            style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                        />
                        <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px' }}>
                            🔒 Proteger com PIN (4 dígitos)
                        </span>
                    </label>
                </div>

                {/* PIN Inputs */}
                {usePin && (
                    <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                            <input
                                type="password"
                                maxLength={4}
                                value={pin}
                                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                                placeholder="PIN"
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    fontSize: '24px',
                                    textAlign: 'center',
                                    letterSpacing: '8px',
                                    borderRadius: '8px',
                                    border: '2px solid rgba(255, 255, 255, 0.2)',
                                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                    color: 'white'
                                }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <input
                                type="password"
                                maxLength={4}
                                value={confirmPin}
                                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                                placeholder="Confirmar PIN"
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    fontSize: '24px',
                                    textAlign: 'center',
                                    letterSpacing: '8px',
                                    borderRadius: '8px',
                                    border: '2px solid rgba(255, 255, 255, 0.2)',
                                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                    color: 'white'
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '16px' }}>
                        {error}
                    </p>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={onClose}
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
                        onClick={handleCreate}
                        disabled={!name.trim()}
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: name.trim() ? '#3b82f6' : 'rgba(59, 130, 246, 0.3)',
                            color: 'white',
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: name.trim() ? 'pointer' : 'not-allowed'
                        }}
                    >
                        Criar Perfil
                    </button>
                </div>
            </div>
        </div>
    );
}
