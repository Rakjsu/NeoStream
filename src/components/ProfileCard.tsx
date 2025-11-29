import type { Profile } from '../types/profile';

interface ProfileCardProps {
    profile: Profile;
    onClick: () => void;
    onEdit?: () => void;
}

export function ProfileCard({ profile, onClick, onEdit }: ProfileCardProps) {
    const isImageAvatar = profile.avatar.startsWith('data:image') || profile.avatar.startsWith('http');

    return (
        <div
            className="profile-card group cursor-pointer"
            onClick={onClick}
            style={{
                position: 'relative',
                width: '180px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
                padding: '16px',
                borderRadius: '12px',
                transition: 'all 0.3s ease',
                border: '2px solid transparent'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.borderColor = 'transparent';
            }}
        >
            {/* Avatar */}
            <div
                style={{
                    width: '150px',
                    height: '150px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '3px solid rgba(255, 255, 255, 0.2)'
                }}
            >
                {isImageAvatar ? (
                    <img
                        src={profile.avatar}
                        alt={profile.name}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                        }}
                    />
                ) : (
                    <span style={{ fontSize: '80px' }}>{profile.avatar}</span>
                )}
            </div>

            {/* Name */}
            <div style={{ textAlign: 'center', width: '100%' }}>
                <h3
                    style={{
                        color: 'white',
                        fontSize: '18px',
                        fontWeight: '600',
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {profile.name}
                </h3>
            </div>

            {/* PIN indicator */}
            {profile.pin && (
                <div
                    style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    <span style={{ fontSize: '16px' }}>🔒</span>
                </div>
            )}

            {/* Edit button (shown on hover) */}
            {onEdit && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                    }}
                    className="edit-button"
                    style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        backgroundColor: 'rgba(59, 130, 246, 0.9)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        opacity: 0,
                        transition: 'opacity 0.3s ease',
                        pointerEvents: 'none'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 1)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.9)';
                    }}
                >
                    ✏️ Editar
                </button>
            )}

            <style>{`
                .profile-card:hover .edit-button {
                    opacity: 1;
                    pointer-events: auto;
                }
            `}</style>
        </div>
    );
}
