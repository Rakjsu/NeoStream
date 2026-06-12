import { useState, useRef, useEffect, useMemo } from 'react';
import { debounce } from '../utils/debounce';

interface AnimatedSearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

const SEARCH_DEBOUNCE_MS = 300;

export function AnimatedSearchBar({ value, onChange, placeholder = "Buscar..." }: AnimatedSearchBarProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    // The input shows keystrokes immediately; the (expensive) parent filter
    // only runs after the user pauses typing.
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    const debouncedOnChange = useMemo(() => debounce(onChange, SEARCH_DEBOUNCE_MS), [onChange]);
    useEffect(() => () => debouncedOnChange.cancel(), [debouncedOnChange]);

    // Keep the draft in sync when the parent clears/sets the value externally.
    useEffect(() => {
        setDraft(value);
    }, [value]);

    useEffect(() => {
        if (isExpanded && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isExpanded]);

    const handleInput = (next: string) => {
        setDraft(next);
        debouncedOnChange(next);
    };

    const handleToggle = () => {
        if (isExpanded && draft === '') {
            setIsExpanded(false);
        } else if (isExpanded && draft !== '') {
            debouncedOnChange.cancel();
            setDraft('');
            onChange('');
        } else {
            setIsExpanded(true);
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        if (draft === '') {
            setTimeout(() => setIsExpanded(false), 200);
        }
    };

    return (
        <>
            <style>{`
                @keyframes pulseGlow {
                    0%, 100% { 
                        box-shadow: 0 0 20px rgba(var(--ns-accent-rgb), 0.4), 
                                    0 0 40px rgba(var(--ns-accent-rgb), 0.2),
                                    inset 0 0 20px rgba(var(--ns-accent-rgb), 0.1);
                    }
                    50% { 
                        box-shadow: 0 0 30px rgba(var(--ns-accent-rgb), 0.6), 
                                    0 0 60px rgba(var(--ns-accent-rgb), 0.3),
                                    inset 0 0 30px rgba(var(--ns-accent-rgb), 0.15);
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
                    background: linear-gradient(135deg, var(--ns-accent-dark), var(--ns-accent), var(--ns-accent-grad-to), var(--ns-accent-dark));
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
                    border: 1px solid rgba(var(--ns-accent-rgb), 0.3);
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
                    border-color: rgba(var(--ns-accent-rgb), 0.6);
                }
                
                .search-btn {
                    width: 52px;
                    height: 52px;
                    background: linear-gradient(135deg, var(--ns-accent-dark) 0%, var(--ns-accent) 50%, var(--ns-accent-grad-to) 100%);
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 20px rgba(var(--ns-accent-rgb), 0.4),
                                0 0 40px rgba(var(--ns-accent-rgb), 0.2);
                    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                    position: relative;
                    z-index: 10;
                    margin-left: -26px;
                }
                
                .search-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 30px rgba(var(--ns-accent-rgb), 0.5),
                                0 0 60px rgba(var(--ns-accent-rgb), 0.3);
                }
                
                .search-btn:active {
                    transform: scale(0.95);
                }
                
                .search-btn.expanded {
                    animation: pulseGlow 2s ease-in-out infinite;
                }
                
                /* Shimmer effect overlay */
                .search-btn::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: 50%;
                    background: linear-gradient(
                        90deg,
                        transparent 0%,
                        rgba(255, 255, 255, 0.3) 50%,
                        transparent 100%
                    );
                    background-size: 200% 100%;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }
                
                .search-btn:hover::before {
                    opacity: 1;
                    animation: shimmerEffect 1.5s ease-in-out infinite;
                }
                
                @keyframes shimmerEffect {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                
                .search-btn-icon {
                    transition: all 0.3s ease;
                    position: relative;
                    z-index: 1;
                }
                
                .search-btn:hover .search-btn-icon {
                    animation: iconBounce 0.5s ease;
                    filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.8));
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
                        value={draft}
                        onChange={(e) => handleInput(e.target.value)}
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
                    {isExpanded && draft ? (
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

