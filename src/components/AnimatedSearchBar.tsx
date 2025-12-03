import { useState, useRef, useEffect } from 'react';

interface AnimatedSearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export function AnimatedSearchBar({ value, onChange, placeholder = "Buscar..." }: AnimatedSearchBarProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isExpanded && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isExpanded]);

    const handleToggle = () => {
        if (isExpanded && value === '') {
            setIsExpanded(false);
        } else if (isExpanded && value !== '') {
            // Clear search when clicking X
            onChange('');
        } else {
            setIsExpanded(true);
        }
    };

    return (
        <>
            <style>{`
            @keyframes scaleGlow {
                0%, 100% { transform: scale(1); box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4); }
                50% { transform: scale(1.1); box-shadow: 0 0 20px rgba(59, 130, 246, 0.6); }
            }
                .search-icon:hover {
                    animation: scaleGlow 0.6s ease-in-out;
                }
            `}</style>
            <div style={{
                position: 'absolute',
                top: '32px',
                right: '32px',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{
                        width: isExpanded ? '300px' : '0px',
                        padding: isExpanded ? '12px 16px' : '0px',
                        backgroundColor: 'rgba(30, 30, 30, 0.95)',
                        color: 'white',
                        fontSize: '16px',
                        border: '2px solid rgba(59, 130, 246, 0.5)',
                        borderRadius: '24px',
                        outline: 'none',
                        transition: 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                        opacity: isExpanded ? 1 : 0,
                        backdropFilter: 'blur(10px)',
                        boxShadow: isExpanded ? '0 4px 16px rgba(0, 0, 0, 0.4)' : 'none'
                    }}
                />
                <button
                    onClick={handleToggle}
                    className="search-icon"
                    style={{
                        width: '48px',
                        height: '48px',
                        backgroundColor: 'rgba(37, 99, 235, 0.9)',
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                        color: 'white',
                        boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
                        transition: 'all 0.3s ease',
                        backdropFilter: 'blur(10px)'
                    }}
                >
                    {isExpanded && value ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                    )}
                </button>
            </div>
        </>
    );
}
