import { useNavigate, useLocation } from 'react-router-dom';
import { Tv, Film, PlaySquare, Settings, LogOut, Bookmark, Home, Users, Heart, Check, Download } from 'lucide-react';
import { profileService } from '../services/profileService';
import { useState, useEffect } from 'react';
import { UpdateNotificationBadge } from './UpdateNotificationBadge';
import { UpdateModal } from './UpdateModal';
import { ProfileManager } from './ProfileManager';
import { updateService } from '../services/updateService';
import { NotificationsPanel } from './NotificationsPanel';
import { useLanguage } from '../services/languageService';
import type { UpdateInfo } from '../types/update';
import type { Profile } from '../types/profile';

export function Sidebar() {
    const navigate = useNavigate();
    const location = useLocation();
    const [activeProfile, setActiveProfile] = useState(() => profileService.getActiveProfile());
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const [showProfilePopup, setShowProfilePopup] = useState(false);
    const [showProfileManager, setShowProfileManager] = useState(false);
    const [profiles, setProfiles] = useState<Profile[]>([]);

    // PIN verification states
    const [pendingProfile, setPendingProfile] = useState<Profile | null>(null);
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState('');
    const { t } = useLanguage();

    useEffect(() => {
        setProfiles(profileService.getAllProfiles());

        // Listen for update available to store updateInfo
        const cleanup = updateService.onUpdateAvailable((info) => {
            setUpdateInfo(info);
        });

        return cleanup;
    }, []);

    // Profile transition state
    const [isTransitioning, setIsTransitioning] = useState(false);

    const handleSwitchProfile = (profile: Profile) => {
        // Check if profile has PIN
        if (profile.pin) {
            setPendingProfile(profile);
            setPinInput('');
            setPinError('');
            setShowProfilePopup(false);
        } else {
            // Trigger transition animation
            setIsTransitioning(true);
            setShowProfilePopup(false);
            setTimeout(() => {
                profileService.setActiveProfile(profile.id);
                setActiveProfile(profile);
                setIsTransitioning(false);
                // Reload page to refresh Continue Watching and Favorites
                window.location.reload();
            }, 300);
        }
    };

    const handlePinSubmit = async () => {
        if (!pendingProfile || pinInput.length !== 4) return;

        const isValid = await profileService.verifyPin(pendingProfile.id, pinInput);
        if (isValid) {
            // Trigger transition animation
            setIsTransitioning(true);
            setPendingProfile(null);
            setTimeout(() => {
                profileService.setActiveProfile(pendingProfile.id);
                setActiveProfile(pendingProfile);
                setIsTransitioning(false);
                // Reload page to refresh Continue Watching and Favorites
                window.location.reload();
            }, 300);
        } else {
            setPinError(t('nav', 'incorrectPin'));
            setPinInput('');
        }
    };

    const handleUpdateBadgeClick = () => {
        setShowUpdateModal(true);
    };

    const menuItems = [
        { icon: Home, label: t('nav', 'home'), path: '/dashboard/home', emoji: '🏠', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
        { icon: Tv, label: t('nav', 'liveTV'), path: '/dashboard/live', emoji: '📺', gradient: 'linear-gradient(135deg, #a855f7, #7c3aed)' },
        { icon: Film, label: t('nav', 'movies'), path: '/dashboard/vod', emoji: '🎬', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
        { icon: PlaySquare, label: t('nav', 'series'), path: '/dashboard/series', emoji: '📺', gradient: 'linear-gradient(135deg, #ec4899, #db2777)' },
        { icon: Bookmark, label: t('nav', 'myList'), path: '/dashboard/watch-later', emoji: '🔖', gradient: 'linear-gradient(135deg, #10b981, #059669)' },
        { icon: Heart, label: t('nav', 'favorites'), path: '/dashboard/favorites', emoji: '❤️', gradient: 'linear-gradient(135deg, #ef4444, #dc2626)' },
        { icon: Download, label: t('nav', 'downloads'), path: '/dashboard/downloads', emoji: '📥', gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)' },
        { icon: Settings, label: t('nav', 'settings'), path: '/dashboard/settings', emoji: '⚙️', gradient: 'linear-gradient(135deg, #6b7280, #4b5563)' },
    ];

    const handleLogout = async () => {
        localStorage.clear();
        profileService.clearActiveProfile();
        await window.ipcRenderer.invoke('auth:logout');
        navigate('/welcome');
    };

    return (
        <>
            <style>{sidebarStyles}</style>

            {/* Profile Popup Overlay - must be before sidebar for correct stacking */}
            {showProfilePopup && (
                <div
                    className="profile-popup-overlay"
                    onClick={() => setShowProfilePopup(false)}
                />
            )}

            {/* Profile Transition Overlay */}
            {isTransitioning && (
                <div className="profile-transition-overlay">
                    <div className="profile-transition-content">
                        <div className="profile-transition-spinner" />
                        <span>{t('nav', 'switchingProfile')}</span>
                    </div>
                </div>
            )}

            <div className="sidebar">
                {/* Animated Background */}
                <div className="sidebar-bg">
                    <div className="bg-gradient" />
                    <div className="bg-glow" />
                </div>

                {/* Logo */}
                <div className="logo-container">
                    <div className="logo-wrapper">
                        <svg className="logo-svg" width="44" height="44" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#a855f7" />
                                    <stop offset="100%" stopColor="#ec4899" />
                                </linearGradient>
                            </defs>
                            <path d="M 10,10 L 10,90 L 90,50 Z" fill="none" stroke="url(#logoGradient)" strokeWidth="6" strokeLinejoin="round" />
                            <rect className="bar bar-1" x="35" y="35" width="6" height="30" fill="url(#logoGradient)" rx="3" />
                            <rect className="bar bar-2" x="45" y="25" width="6" height="50" fill="url(#logoGradient)" rx="3" />
                            <rect className="bar bar-3" x="55" y="40" width="6" height="20" fill="url(#logoGradient)" rx="3" />
                        </svg>
                        <div className="logo-ring" />
                    </div>
                </div>

                {/* Navigation */}
                <nav className="nav-container">
                    {menuItems.map((item, index) => {
                        const isActive = location.pathname.startsWith(item.path);
                        const isHovered = hoveredItem === item.path;

                        return (
                            <button
                                key={item.path}
                                onClick={() => navigate(item.path)}
                                onMouseEnter={() => setHoveredItem(item.path)}
                                onMouseLeave={() => setHoveredItem(null)}
                                className={`nav-item ${isActive ? 'active' : ''}`}
                                style={{ animationDelay: `${index * 0.05}s` }}
                                title={item.label}
                            >
                                {/* Background Glow */}
                                <div
                                    className="item-glow"
                                    style={{
                                        background: item.gradient,
                                        opacity: isActive ? 0.2 : isHovered ? 0.15 : 0
                                    }}
                                />

                                {/* Icon */}
                                <div className="item-icon-wrapper">
                                    <item.icon
                                        className="item-icon"
                                        style={{
                                            stroke: isActive ? '#fff' : isHovered ? '#c4b5fd' : 'rgba(255,255,255,0.7)'
                                        }}
                                    />
                                </div>

                                {/* Active Indicator */}
                                {isActive && (
                                    <div className="active-indicator">
                                        <div className="indicator-bar" style={{ background: item.gradient }} />
                                    </div>
                                )}

                                {/* Tooltip */}
                                <div className={`tooltip ${isHovered ? 'visible' : ''}`}>
                                    <span className="tooltip-emoji">{item.emoji}</span>
                                    <span className="tooltip-label">{item.label}</span>
                                </div>
                            </button>
                        );
                    })}
                </nav>

                {/* Bottom Section */}
                <div className="bottom-section">
                    {/* Update Badge */}
                    <UpdateNotificationBadge onClick={handleUpdateBadgeClick} />

                    {/* Episode Notifications */}
                    <NotificationsPanel
                        onNavigateToSeries={(seriesId) => {
                            navigate(`/dashboard/series?id=${seriesId}`);
                        }}
                        onNavigateToDownloads={() => {
                            navigate('/dashboard/downloads');
                        }}
                    />

                    {/* Profile */}
                    {activeProfile && (
                        <button
                            className="profile-btn"
                            onClick={() => setShowProfilePopup(!showProfilePopup)}
                            onMouseEnter={() => setHoveredItem('profile')}
                            onMouseLeave={() => setHoveredItem(null)}
                            title={t('nav', 'switchProfile')}
                        >
                            <div className="profile-ring" />
                            <div className="profile-inner">
                                <svg width="26" height="26" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                    <defs>
                                        <linearGradient id="profileGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stopColor="#a855f7" />
                                            <stop offset="100%" stopColor="#ec4899" />
                                        </linearGradient>
                                    </defs>
                                    <circle cx="50" cy="35" r="14" fill="none" stroke="url(#profileGrad)" strokeWidth="6" />
                                    <path d="M 20,85 C 20,65 30,55 50,55 C 70,55 80,65 80,85" fill="none" stroke="url(#profileGrad)" strokeWidth="6" strokeLinecap="round" />
                                </svg>
                            </div>
                            {/* Profile Tooltip */}
                            <div className={`tooltip ${hoveredItem === 'profile' && !showProfilePopup ? 'visible' : ''}`}>
                                <span className="tooltip-emoji">👤</span>
                                <span className="tooltip-label">{activeProfile.name}</span>
                            </div>
                        </button>
                    )}


                    {/* Logout */}
                    <button
                        className="logout-btn"
                        onClick={handleLogout}
                        onMouseEnter={() => setHoveredItem('logout')}
                        onMouseLeave={() => setHoveredItem(null)}
                        title={t('nav', 'logout')}
                    >
                        <LogOut className="logout-icon" />
                        {/* Logout Tooltip */}
                        <div className={`tooltip danger ${hoveredItem === 'logout' ? 'visible' : ''}`}>
                            <span className="tooltip-emoji">🚪</span>
                            <span className="tooltip-label">{t('nav', 'logout')}</span>
                        </div>
                    </button>
                </div>
            </div>

            {/* Profile Popup - must be outside sidebar for correct z-index stacking */}
            {showProfilePopup && (
                <div className="profile-popup">
                    <div className="profile-popup-header">
                        <Users size={18} />
                        <span>{t('nav', 'switchProfile')}</span>
                    </div>
                    <div className="profile-popup-list">
                        {/* Filter out Kids profiles - they can only be switched via ProfileManager */}
                        {profiles.filter(p => !p.isKids).map((profile) => {
                            const isImageAvatar = profile.avatar?.startsWith('data:image') || profile.avatar?.startsWith('http');
                            return (
                                <button
                                    key={profile.id}
                                    className={`profile-popup-item ${activeProfile?.id === profile.id ? 'active' : ''}`}
                                    onClick={() => handleSwitchProfile(profile)}
                                >
                                    <div className="profile-popup-avatar">
                                        {isImageAvatar ? (
                                            <img src={profile.avatar} alt={profile.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                        ) : (
                                            profile.avatar || '👤'
                                        )}
                                    </div>
                                    <span className="profile-popup-name">{profile.name}</span>
                                    {activeProfile?.id === profile.id && (
                                        <span className="profile-popup-check">✓</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <button
                        className="profile-popup-settings"
                        onClick={() => {
                            setShowProfilePopup(false);
                            setShowProfileManager(true);
                        }}
                    >
                        <Settings size={16} />
                        <span>{t('nav', 'manageProfiles')}</span>
                    </button>
                </div>
            )}

            {/* Update Modal */}
            <UpdateModal
                isOpen={showUpdateModal}
                onClose={() => setShowUpdateModal(false)}
                updateInfo={updateInfo}
            />

            {/* Profile Manager Modal */}
            {showProfileManager && (
                <ProfileManager
                    onClose={() => {
                        setShowProfileManager(false);
                        setProfiles(profileService.getAllProfiles());
                        setActiveProfile(profileService.getActiveProfile());
                    }}
                />
            )}

            {/* PIN Verification Modal */}
            {pendingProfile && (
                <div className="sidebar-pin-overlay" onClick={() => setPendingProfile(null)}>
                    <div className="sidebar-pin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="sidebar-pin-header">
                            <span className="sidebar-pin-icon">🔐</span>
                            <h2>{t('nav', 'enterPin')}</h2>
                            <p>{t('nav', 'profile')}: <strong>{pendingProfile.name}</strong></p>
                        </div>

                        <div
                            className="sidebar-pin-container"
                            onClick={() => document.getElementById('sidebar-pin-input')?.focus()}
                        >
                            {[0, 1, 2, 3].map((index) => (
                                <div
                                    key={index}
                                    className={`sidebar-pin-digit ${pinInput.length > index ? 'filled' : ''} ${pinError ? 'error' : ''}`}
                                >
                                    {pinInput[index] ? '•' : ''}
                                </div>
                            ))}
                        </div>

                        <input
                            id="sidebar-pin-input"
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
                            className="sidebar-pin-hidden-input"
                        />

                        {pinError && (
                            <p className="sidebar-pin-error">
                                <span>⚠️</span> {pinError}
                            </p>
                        )}

                        <div className="sidebar-pin-buttons">
                            <button className="sidebar-pin-btn cancel" onClick={() => setPendingProfile(null)}>
                                {t('nav', 'cancel')}
                            </button>
                            <button
                                className="sidebar-pin-btn submit"
                                onClick={handlePinSubmit}
                                disabled={pinInput.length !== 4}
                            >
                                <Check size={18} />
                                {t('nav', 'enter')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Update Modal */}
            <UpdateModal
                isOpen={showUpdateModal}
                onClose={() => setShowUpdateModal(false)}
                updateInfo={updateInfo}
            />
        </>
    );
}

// CSS Styles
const sidebarStyles = `
/* Sidebar Container */
.sidebar {
    position: relative;
    width: 80px;
    min-width: 80px;
    max-width: 80px;
    height: 100%;
    display: flex;
    flex-direction: column;
    z-index: 100;
    overflow-x: visible;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(168, 85, 247, 0.4) transparent;
}

.sidebar::-webkit-scrollbar {
    width: 4px;
}

.sidebar::-webkit-scrollbar-track {
    background: transparent;
}

.sidebar::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #a855f7, #ec4899);
    border-radius: 2px;
}

/* Background */
.sidebar-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
}

.bg-gradient {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 50%, #0f0f1a 100%);
}

.bg-glow {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 200px;
    background: radial-gradient(ellipse at center top, rgba(168, 85, 247, 0.15) 0%, transparent 70%);
    pointer-events: none;
}

/* Logo */
.logo-container {
    position: relative;
    z-index: 10;
    padding: 20px 0;
    display: flex;
    justify-content: center;
    align-items: center;
}

.logo-wrapper {
    position: relative;
    cursor: pointer;
    transition: transform 0.3s ease;
}

.logo-wrapper:hover {
    transform: scale(1.1);
}

.logo-svg {
    position: relative;
    z-index: 2;
    filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.5));
    transition: filter 0.3s ease;
}

.logo-wrapper:hover .logo-svg {
    filter: drop-shadow(0 0 15px rgba(168, 85, 247, 0.8))
            drop-shadow(0 0 30px rgba(168, 85, 247, 0.5));
    animation: logoGlow 2s ease-in-out infinite;
}

@keyframes logoGlow {
    0%, 100% { 
        filter: drop-shadow(0 0 15px rgba(168, 85, 247, 0.8))
                drop-shadow(0 0 30px rgba(168, 85, 247, 0.5));
    }
    50% { 
        filter: drop-shadow(0 0 25px rgba(168, 85, 247, 1))
                drop-shadow(0 0 50px rgba(168, 85, 247, 0.7));
    }
}

.logo-ring {
    position: absolute;
    inset: -8px;
    border-radius: 50%;
    border: 2px solid rgba(168, 85, 247, 0.3);
    opacity: 0;
    transition: all 0.3s ease;
}

.logo-wrapper:hover .logo-ring {
    opacity: 1;
    animation: ringPulse 2s ease-in-out infinite;
}

@keyframes ringPulse {
    0%, 100% { transform: scale(1); opacity: 0.5; }
    50% { transform: scale(1.2); opacity: 1; }
}

/* Animated Bars */
.bar {
    animation: barBounce 1.2s ease-in-out infinite;
}

.bar-1 { animation-delay: 0s; }
.bar-2 { animation-delay: 0.2s; }
.bar-3 { animation-delay: 0.4s; }

@keyframes barBounce {
    0%, 100% { transform: scaleY(1); }
    50% { transform: scaleY(0.6); }
}

/* Navigation */
.nav-container {
    position: relative;
    z-index: 10;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
}

/* Nav Item */
.nav-item {
    position: relative;
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 16px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    animation: itemFadeIn 0.4s ease backwards;
}

@keyframes itemFadeIn {
    from {
        opacity: 0;
        transform: translateX(-10px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.nav-item:hover {
    transform: scale(1.1);
}

.nav-item:active {
    transform: scale(0.95);
}

.nav-item.active {
    background: rgba(255, 255, 255, 0.05);
}

/* Item Glow */
.item-glow {
    position: absolute;
    inset: 0;
    border-radius: 16px;
    filter: blur(8px);
    transition: opacity 0.3s ease;
}

/* Icon Wrapper */
.item-icon-wrapper {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
}

.item-icon {
    width: 24px;
    height: 24px;
    transition: all 0.3s ease;
}

.nav-item:hover .item-icon {
    transform: scale(1.15);
}

/* Active Indicator */
.active-indicator {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 32px;
    overflow: hidden;
    border-radius: 0 4px 4px 0;
}

.indicator-bar {
    width: 100%;
    height: 100%;
    animation: indicatorGlow 2s ease-in-out infinite;
}

@keyframes indicatorGlow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
}

/* Tooltip */
.tooltip {
    position: absolute;
    left: calc(100% + 12px);
    top: 50%;
    transform: translateY(-50%) translateX(-10px);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 12px;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
    z-index: 1000;
}

.tooltip.visible {
    opacity: 1;
    visibility: visible;
    transform: translateY(-50%) translateX(0);
}

.tooltip.danger {
    border-color: rgba(239, 68, 68, 0.4);
}

.tooltip-emoji {
    font-size: 18px;
}

.tooltip-label {
    font-size: 14px;
    font-weight: 600;
    color: white;
}

/* Bottom Section */
.bottom-section {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
}

/* Profile Button */
.profile-btn {
    position: relative;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.profile-btn:hover {
    transform: scale(1.15);
}

.profile-ring {
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: linear-gradient(135deg, #a855f7, #ec4899);
    opacity: 0.8;
    transition: all 0.3s ease;
}

.profile-btn:hover .profile-ring {
    animation: profilePulse 1.5s ease-in-out infinite;
}

@keyframes profilePulse {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.15); opacity: 1; }
}

.profile-inner {
    position: relative;
    z-index: 1;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: linear-gradient(135deg, #1a1a2e, #0f0f1a);
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Logout Button */
.logout-btn {
    position: relative;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.logout-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    transform: scale(1.1);
}

.logout-btn:active {
    transform: scale(0.95);
}

.logout-icon {
    width: 22px;
    height: 22px;
    stroke: rgba(255, 255, 255, 0.6);
    transition: all 0.3s ease;
}

.logout-btn:hover .logout-icon {
    stroke: #f87171;
}

/* Profile Popup Overlay */
.profile-popup-overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: rgba(0, 0, 0, 0.3);
}

/* Profile Popup */
.profile-popup {
    position: fixed;
    left: 92px;
    bottom: 80px;
    width: 220px;
    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 16px;
    padding: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: popupSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    z-index: 9999;
}

@keyframes popupSlideIn {
    from {
        opacity: 0;
        transform: translateX(-10px) scale(0.95);
    }
    to {
        opacity: 1;
        transform: translateX(0) scale(1);
    }
}

.profile-popup-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    font-weight: 600;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    margin-bottom: 8px;
}

.profile-popup-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
}

.profile-popup-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    width: 100%;
}

.profile-popup-item:hover {
    background: rgba(255, 255, 255, 0.08);
}

.profile-popup-item.active {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.15));
}

.profile-popup-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.3));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
}

.profile-popup-name {
    flex: 1;
    color: white;
    font-size: 14px;
    font-weight: 500;
    text-align: left;
}

.profile-popup-check {
    color: #10b981;
    font-size: 16px;
    font-weight: 700;
}

.profile-popup-settings {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
}

.profile-popup-settings:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
}

/* Sidebar PIN Modal */
.sidebar-pin-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: sidebarPinFadeIn 0.3s ease;
}

@keyframes sidebarPinFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.sidebar-pin-modal {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border-radius: 20px;
    padding: 32px;
    max-width: 480px;
    width: 95%;
    border: 1px solid rgba(168, 85, 247, 0.3);
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
    animation: sidebarPinModalSlide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes sidebarPinModalSlide {
    from { opacity: 0; transform: translateY(-30px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

.sidebar-pin-header {
    text-align: center;
    margin-bottom: 24px;
}

.sidebar-pin-icon {
    font-size: 48px;
    display: block;
    margin-bottom: 12px;
    animation: sidebarPinBounce 0.6s ease;
}

@keyframes sidebarPinBounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

.sidebar-pin-header h2 {
    color: white;
    font-size: 24px;
    font-weight: 700;
    margin: 0 0 8px 0;
}

.sidebar-pin-header p {
    color: #9ca3af;
    font-size: 14px;
    margin: 0;
}

.sidebar-pin-header strong {
    color: #c4b5fd;
}

.sidebar-pin-container {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin: 24px 0;
    position: relative;
    cursor: text;
}

.sidebar-pin-digit {
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

.sidebar-pin-digit.filled {
    border-color: rgba(168, 85, 247, 0.7);
    background: rgba(168, 85, 247, 0.15);
    animation: sidebarPinPop 0.2s ease;
}

@keyframes sidebarPinPop {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); }
}

.sidebar-pin-digit.error {
    border-color: rgba(239, 68, 68, 0.7);
    animation: sidebarPinShake 0.5s ease;
}

@keyframes sidebarPinShake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-8px); }
    80% { transform: translateX(8px); }
}

.sidebar-pin-hidden-input {
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

.sidebar-pin-error {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #f87171;
    font-size: 14px;
    margin-bottom: 16px;
    animation: sidebarPinFadeIn 0.3s ease;
}

.sidebar-pin-buttons {
    display: flex;
    gap: 12px;
    margin-top: 24px;
}

.sidebar-pin-btn {
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

.sidebar-pin-btn.cancel {
    background: rgba(255, 255, 255, 0.1);
    color: #9ca3af;
}

.sidebar-pin-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.15);
    color: white;
}

.sidebar-pin-btn.submit {
    background: linear-gradient(135deg, #a855f7, #7c3aed);
    color: white;
}

.sidebar-pin-btn.submit:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.4);
}

.sidebar-pin-btn.submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Profile Transition Overlay */
.profile-transition-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    animation: transitionFadeIn 0.2s ease;
}

@keyframes transitionFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.profile-transition-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    animation: transitionPulse 0.3s ease;
}

@keyframes transitionPulse {
    0% { transform: scale(0.9); opacity: 0; }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); opacity: 1; }
}

.profile-transition-spinner {
    width: 48px;
    height: 48px;
    border: 3px solid rgba(168, 85, 247, 0.2);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: transitionSpin 0.8s linear infinite;
}

@keyframes transitionSpin {
    to { transform: rotate(360deg); }
}

.profile-transition-content span {
    color: rgba(255, 255, 255, 0.8);
    font-size: 16px;
    font-weight: 500;
}
`;
