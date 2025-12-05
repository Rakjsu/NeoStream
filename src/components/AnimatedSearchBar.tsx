import { useState, useRef, useEffect } from 'react';

interface AnimatedSearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export function AnimatedSearchBar({ value, onChange, placeholder = "Buscar..." }: AnimatedSearchBarProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
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
            onChange('');
        } else {
            setIsExpanded(true);
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        if (value === '') {
            setTimeout(() => setIsExpanded(false), 200);
        }
    };

    return (
        <>
            <style>{`
                @keyframes pulseGlow {
                    0%, 100% { 
                        box-shadow: 0 0 20px rgba(99, 102, 241, 0.4), 
                                    0 0 40px rgba(99, 102, 241, 0.2),
                                    inset 0 0 20px rgba(99, 102, 241, 0.1);
                    }
                    50% { 
                        box-shadow: 0 0 30px rgba(99, 102, 241, 0.6), 
                                    0 0 60px rgba(99, 102, 241, 0.3),
                                    inset 0 0 30px rgba(99, 102, 241, 0.15);
                    }
                }
                
                @keyframes iconBounce {
                    0%, 100% { transform: scale(1); }
                    25% { transform: scale(0.9); }
                    50% { transform: scale(1.15); }
                    75% { transform: scale(1.05); }
                }
                
                @keyframes rotateIn {
                    from { transform: rotate(-90deg) scale(0); opacity: 0; }
                    to { transform: rotate(0deg) scale(1); opacity: 1; }
                }
                
                @keyframes slideExpand {
                    from { width: 0; opacity: 0; transform: scaleX(0); }
                    to { width: 320px; opacity: 1; transform: scaleX(1); }
                }
                
                @keyframes borderFlow {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                
                .search-container {
                    position: absolute;
                    top: 24px;
                    right: 24px;
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    gap: 0;
                }
                
                .search-input-wrapper {
                    position: relative;
                    overflow: hidden;
                    border-radius: 50px;
                }
                
                .search-input-wrapper::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: 50px;
                    padding: 2px;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7, #6366f1);
                    background-size: 300% 300%;
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }
                
                .search-input-wrapper.focused::before {
                    opacity: 1;
                    animation: borderFlow 3s ease infinite;
                }
                
                .search-input {
                    background: rgba(15, 15, 25, 0.9);
                    color: white;
                    font-size: 15px;
                    font-weight: 500;
                    border: 1px solid rgba(99, 102, 241, 0.3);
                    border-radius: 50px;
                    outline: none;
                    backdrop-filter: blur(20px);
                    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                    letter-spacing: 0.3px;
                }
                
                .search-input::placeholder {
                    color: rgba(148, 163, 184, 0.7);
                    font-weight: 400;
                }
                
                .search-input:focus {
                    border-color: rgba(99, 102, 241, 0.6);
                }
                
                .search-btn {
                    width: 52px;
                    height: 52px;
                    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%);
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4),
                                0 0 40px rgba(99, 102, 241, 0.2);
                    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                    position: relative;
                    z-index: 10;
                    margin-left: -26px;
                }
                
                .search-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 30px rgba(99, 102, 241, 0.5),
                                0 0 60px rgba(99, 102, 241, 0.3);
                }
                
                .search-btn:active {
                    transform: scale(0.95);
                }
                
                .search-btn.expanded {
                    animation: pulseGlow 2s ease-in-out infinite;
                }
                
                .search-btn-icon {
                    transition: all 0.3s ease;
                }
                
                .search-btn:hover .search-btn-icon {
                    animation: iconBounce 0.5s ease;
                }
                
                .clear-icon {
                    animation: rotateIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
            `}</style>

            <div className="search-container">
                <div className={`search-input-wrapper ${isFocused ? 'focused' : ''}`}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onFocus={() => setIsFocused(true)}
                        onBlur={handleBlur}
                        placeholder={placeholder}
                        className="search-input"
                        style={{
                            width: isExpanded ? '320px' : '0px',
                            padding: isExpanded ? '16px 60px 16px 24px' : '0px',
                            opacity: isExpanded ? 1 : 0,
                            transform: isExpanded ? 'scaleX(1)' : 'scaleX(0)',
                            transformOrigin: 'right center'
                        }}
                    />
                </div>

                <button
                    onClick={handleToggle}
                    className={`search-btn ${isExpanded ? 'expanded' : ''}`}
                    style={{
                        marginLeft: isExpanded ? '-52px' : '0'
                    }}
                >
                    {isExpanded && value ? (
                        <svg
                            className="search-btn-icon clear-icon"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    ) : (
                        <svg
                            className="search-btn-icon"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="11" cy="11" r="7" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                    )}
                </button>
            </div>
        </>
    );
}

