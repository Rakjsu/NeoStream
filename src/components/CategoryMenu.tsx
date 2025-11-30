import { useState, useEffect } from 'react';
import netflixLogo from '../assets/logos/netflix.png';
import brasilParaleloLogo from '../assets/logos/brasil-paralelo.png';
import disneyLogo from '../assets/logos/disney-new.png';
import amazonPrimeLogo from '../assets/logos/amazon-prime.png';
import globoplayLogo from '../assets/logos/globoplay.jpg';
import lookeLogo from '../assets/logos/looke.png';
import paramountLogo from '../assets/logos/paramount.png';
import discoveryLogo from '../assets/logos/discovery.png';
import marvelLogo from '../assets/logos/marvel.png';
import appleTvLogo from '../assets/logos/apple-tv.png';
import maxLogo from '../assets/logos/max.png';
import crunchyrollLogo from '../assets/logos/crunchyroll.png';

interface CategoryMenuProps {
    onSelectCategory: (categoryId: string) => void;
    selectedCategory: string | null;
}

interface Category {
    category_id: string;
    category_name: string;
    parent_id: number;
}

export function CategoryMenu({ onSelectCategory, selectedCategory }: CategoryMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && categories.length === 0) {
            fetchCategories();
        }
    }, [isOpen]);

    const fetchCategories = async () => {
        setLoading(true);
        try {
            const result = await window.ipcRenderer.invoke('auth:get-credentials');
            if (result.success) {
                const { url, username, password } = result.credentials;
                const response = await fetch(
                    `${url}/player_api.php?username=${username}&password=${password}&action=get_series_categories`
                );
                const data = await response.json();
                setCategories(data || []);
            }
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setLoading(false);
        }
    };

    const getCategoryIcon = (categoryName: string): JSX.Element => {
        const name = categoryName.toLowerCase();
        const size = 18;

        // Ação
        if (name.includes('ação') || name.includes('action')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
        if (name.includes('aventura') || name.includes('adventure')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>;

        // Drama & Romance
        if (name.includes('drama')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="7" /><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" /></svg>;
        if (name.includes('romance') || name.includes('romantic')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>;

        // Comédia
        if (name.includes('comédia') || name.includes('comedy') || name.includes('humor')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>;

        // Terror & Suspense
        if (name.includes('terror') || name.includes('horror')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v4a8 8 0 0 0 16 0v-4a8 8 0 0 0-8-8z" /><path d="M8 14s1.5 1 4 1 4-1 4-1" /></svg>;
        if (name.includes('suspense') || name.includes('thriller')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
        if (name.includes('mistério') || name.includes('mystery')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;

        // Ficção Científica & Fantasia
        if (name.includes('ficção') || name.includes('sci-fi') || name.includes('science')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>;
        if (name.includes('fantasia') || name.includes('fantasy')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 2 L12 8 L8 2 L4 8 L12 22 L20 8 Z" /></svg>;

        // Animação & Infantil
        if (name.includes('animação') || name.includes('animation') || name.includes('desenho')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>;
        if (name.includes('infantil') || name.includes('kids') || name.includes('criança')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
        if (name.includes('anime')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;

        // Documentários
        if (name.includes('documentário') || name.includes('documentary')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></svg>;
        if (name.includes('natureza') || name.includes('nature')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>;

        // Crime & Policial
        if (name.includes('crime') || name.includes('policial') || name.includes('detective')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
        if (name.includes('gangster') || name.includes('máfia')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;

        // Guerra & Militar
        if (name.includes('guerra') || name.includes('war') || name.includes('militar')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 2 8 16" /><line x1="12" y1="22" x2="12" y2="16" /><line x1="8" y1="16" x2="16" y2="16" /></svg>;

        // Esportes
        if (name.includes('esporte') || name.includes('sport')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>;

        // Música & Musical
        if (name.includes('música') || name.includes('music') || name.includes('musical')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;

        // Família
        if (name.includes('família') || name.includes('family')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;

        // Western
        if (name.includes('western') || name.includes('faroeste')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2 L4 7 L4 22 L20 22 L20 7 Z" /><path d="M12 2 L12 22" /></svg>;

        // Épico & História
        if (name.includes('épico') || name.includes('epic')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
        if (name.includes('história') || name.includes('historical') || name.includes('period')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;

        // Reality & Talk Show
        if (name.includes('reality')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" /></svg>;
        if (name.includes('talk') || name.includes('show')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" /></svg>;

        // Teen & Novela
        if (name.includes('teen') || name.includes('adolescent')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
        if (name.includes('novela') || name.includes('soap')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>;

        // Biografia
        if (name.includes('biografia') || name.includes('biography')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><circle cx="12" cy="8" r="2" /><path d="M15 13a3 3 0 1 0-6 0" /></svg>;

        // Marcas / Brands (Logo icon)
        if (name.includes('marca') || name.includes('brand')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" /><line x1="2" y1="17" x2="7" y2="17" /><line x1="17" y1="17" x2="22" y2="17" /><line x1="17" y1="7" x2="22" y2="7" /></svg>;

        // Notícias / News
        if (name.includes('notícia') || name.includes('news') || name.includes('jornal')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" /></svg>;

        // Culinária / Cooking
        if (name.includes('culinária') || name.includes('cooking') || name.includes('chef') || name.includes('receita')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg>;

        // Viagem / Travel
        if (name.includes('viagem') || name.includes('travel') || name.includes('turismo')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;

        // Religião / Religion
        if (name.includes('religião') || name.includes('religion') || name.includes('gospel')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20M12 2a7 7 0 0 0 0 20M12 2a7 7 0 0 1 0 20" /></svg>;

        // Política / Politics
        if (name.includes('política') || name.includes('politics') || name.includes('político')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>;

        // Saúde / Health
        if (name.includes('saúde') || name.includes('health') || name.includes('medicina') || name.includes('medical')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>;

        // Tecnologia / Technology
        if (name.includes('tecnologia') || name.includes('technology') || name.includes('tech')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" /></svg>;

        // Auto / Automotive
        if (name.includes('auto') || name.includes('carro') || name.includes('car')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" /></svg>;

        // Legendado / Subtitled (CC icon)
        if (name.includes('legendado') || name.includes('subtitle') || name.includes('caption')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M7 15h4M13 15h4M7 11h2M13 11h2" /></svg>;

        // Lançamento / New Release (sparkle/star icon)
        if (name.includes('lançamento') || name.includes('lancamento') || name.includes('novo') || name.includes('new') || name.includes('estreia') || name.includes('release')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18M3 12h18M6.34 6.34l11.32 11.32M17.66 6.34L6.34 17.66" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>;

        if (name.includes('netflix')) return <img src={netflixLogo} alt="Netflix" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('brasil paralelo') || name.includes('bp')) return <img src={brasilParaleloLogo} alt="Brasil Paralelo" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('disney')) return <img src={disneyLogo} alt="Disney" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('amazon')) return <img src={amazonPrimeLogo} alt="Amazon Prime" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('globoplay') || name.includes('globo play')) return <img src={globoplayLogo} alt="Globoplay" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('looke')) return <img src={lookeLogo} alt="Looke" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('paramount')) return <img src={paramountLogo} alt="Paramount+" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('discovery')) return <img src={discoveryLogo} alt="Discovery" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('marvel')) return <img src={marvelLogo} alt="Marvel" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('apple tv') || name.includes('appletv')) return <img src={appleTvLogo} alt="Apple TV" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('max') || name.includes('hbo max')) return <img src={maxLogo} alt="Max" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('crunchyroll')) return <img src={crunchyrollLogo} alt="Crunchyroll" style={{ width: size, height: size, objectFit: 'contain' }} />;

        // Default
        return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    };

    return (
        <>
            <style>{`
                @keyframes slideIn {
                    from { 
                        transform: translateX(-100%);
                        opacity: 0;
                    }
                    to { 
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes shimmer {
                    0% { background-position: -1000px 0; }
                    100% { background-position: 1000px 0; }
                }
                .category-item {
                    position: relative;
                    overflow: hidden;
                }
                .category-item::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: -100%;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
                    transition: left 0.5s ease;
                }
                .category-item:hover::before {
                    left: 100%;
                }
            `}</style>

            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="transition-all duration-200 active:scale-90"
                style={{
                    position: 'absolute',
                    top: '20px',
                    left: '2px',
                    zIndex: 90,
                    width: '48px',
                    height: '48px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                    padding: 0
                }}
            >
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="transition-all duration-200"
                    style={{
                        color: isOpen ? '#ffffff' : '#ffffff',
                        stroke: isOpen ? '#ffffff' : '#ffffff',
                        transform: 'scale(1)'
                    }}
                    onMouseEnter={(e) => {
                        if (!isOpen) {
                            e.currentTarget.style.color = '#ef4444';
                            e.currentTarget.style.stroke = '#ef4444';
                            e.currentTarget.style.transform = 'scale(1.25)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#ffffff';
                        e.currentTarget.style.stroke = '#ffffff';
                        e.currentTarget.style.transform = 'scale(1)';
                    }}
                >
                    {isOpen ? (
                        <>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </>
                    ) : (
                        <>
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </>
                    )}
                </svg>
            </button>

            {/* Backdrop */}
            {isOpen && (
                <div
                    onClick={() => setIsOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'radial-gradient(circle at center, rgba(0,0,0,0.6), rgba(0,0,0,0.8))',
                        zIndex: 999,
                        backdropFilter: 'blur(8px)',
                        animation: 'fadeIn 0.3s ease'
                    }}
                />
            )}

            {/* Menu Panel */}
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: '380px',
                    background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%)',
                    zIndex: 1000,
                    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                    transition: 'transform 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                    boxShadow: isOpen ? '8px 0 32px rgba(0, 0, 0, 0.6), 0 0 80px rgba(59, 130, 246, 0.1)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    backdropFilter: 'blur(20px)',
                    borderRight: '1px solid rgba(59, 130, 246, 0.2)',
                    animation: isOpen ? 'slideIn 0.4s ease' : 'none'
                }}
            >
                {/* Header with gradient */}
                <div style={{
                    padding: '32px 24px',
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Animated background */}
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)',
                        animation: 'shimmer 3s infinite',
                        backgroundSize: '1000px 100%'
                    }}></div>

                    {/* Close Button X */}
                    <button
                        onClick={() => setIsOpen(false)}
                        className="transition-all duration-200"
                        style={{
                            position: 'absolute',
                            top: '16px',
                            right: '16px',
                            zIndex: 2,
                            width: '36px',
                            height: '36px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                            e.currentTarget.style.borderColor = '#ef4444';
                            e.currentTarget.style.transform = 'scale(1.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>

                    <div style={{ position: 'relative', zIndex: 1 }}>
                        <h2 style={{
                            margin: 0,
                            background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            fontSize: '28px',
                            fontWeight: '800',
                            letterSpacing: '-0.5px',
                            marginBottom: '8px'
                        }}>
                            Categorias
                        </h2>
                        <p style={{
                            margin: 0,
                            color: 'rgba(255, 255, 255, 0.6)',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}>
                            Explore por gênero
                        </p>
                    </div>
                </div>

                {/* Categories List with scrollbar styling */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '16px',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(59, 130, 246, 0.5) transparent'
                }}>
                    {loading && (
                        <div style={{
                            padding: '48px 24px',
                            textAlign: 'center'
                        }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                margin: '0 auto 16px',
                                borderRadius: '50%',
                                border: '3px solid rgba(59, 130, 246, 0.2)',
                                borderTopColor: '#3b82f6',
                                animation: 'spin 1s linear infinite'
                            }}></div>
                            <p style={{
                                color: 'rgba(255, 255, 255, 0.6)',
                                fontSize: '14px',
                                fontWeight: '500'
                            }}>
                                Carregando categorias...
                            </p>
                        </div>
                    )}

                    {/* All Categories Option - Premium */}
                    <button
                        onClick={() => {
                            onSelectCategory('');
                            setIsOpen(false);
                        }}
                        className="category-item"
                        style={{
                            width: '100%',
                            padding: '16px 20px',
                            background: selectedCategory === '' || selectedCategory === null
                                ? 'rgba(251, 191, 36, 0.15)'
                                : 'rgba(255, 255, 255, 0.03)',
                            border: selectedCategory === '' || selectedCategory === null
                                ? '2px solid #fbbf24'
                                : '2px solid rgba(255, 255, 255, 0.05)',
                            borderRadius: '12px',
                            color: selectedCategory === '' || selectedCategory === null ? '#fbbf24' : 'white',
                            fontSize: '15px',
                            fontWeight: selectedCategory === '' || selectedCategory === null ? '600' : '500',
                            textAlign: 'left',
                            cursor: 'pointer',
                            marginBottom: '12px',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            boxShadow: selectedCategory === '' || selectedCategory === null
                                ? '0 4px 16px rgba(251, 191, 36, 0.4)'
                                : 'none'
                        }}
                        onMouseEnter={(e) => {
                            if (selectedCategory !== '' && selectedCategory !== null) {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                e.currentTarget.style.transform = 'translateX(8px) scale(1.02)';
                                e.currentTarget.style.borderColor = '#ef4444';
                                e.currentTarget.style.color = '#ef4444';
                                const iconDiv = e.currentTarget.querySelector('div');
                                if (iconDiv) iconDiv.style.background = 'rgba(239, 68, 68, 0.2)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (selectedCategory !== '' && selectedCategory !== null) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                e.currentTarget.style.transform = 'translateX(0) scale(1)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                                e.currentTarget.style.color = 'white';
                                const iconDiv = e.currentTarget.querySelector('div');
                                if (iconDiv) iconDiv.style.background = 'rgba(255, 255, 255, 0.1)';
                            }
                        }}
                    >
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: selectedCategory === '' || selectedCategory === null
                                ? 'rgba(251, 191, 36, 0.2)'
                                : 'rgba(255, 255, 255, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '20px',
                            transition: 'all 0.3s ease'
                        }}>
                            📺
                        </div>
                        <span style={{ flex: 1 }}>Todas as Séries</span>
                        {(selectedCategory === '' || selectedCategory === null) && (
                            <div style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#fbbf24',
                                boxShadow: '0 0 12px rgba(251, 191, 36, 0.8)'
                            }}></div>
                        )}
                    </button>

                    {/* Category Items - Premium Cards */}
                    {categories.map((category, index) => (
                        <button
                            key={category.category_id}
                            onClick={() => {
                                onSelectCategory(category.category_id);
                                setIsOpen(false);
                            }}
                            className="category-item"
                            style={{
                                width: '100%',
                                padding: '16px 20px',
                                background: selectedCategory === category.category_id
                                    ? 'rgba(251, 191, 36, 0.15)'
                                    : 'rgba(255, 255, 255, 0.03)',
                                border: selectedCategory === category.category_id
                                    ? '2px solid #fbbf24'
                                    : '2px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '12px',
                                color: selectedCategory === category.category_id ? '#fbbf24' : 'white',
                                fontSize: '15px',
                                fontWeight: selectedCategory === category.category_id ? '600' : '500',
                                textAlign: 'left',
                                cursor: 'pointer',
                                marginBottom: '12px',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                opacity: 0,
                                animation: `fadeIn 0.4s ease ${index * 0.05}s forwards`,
                                boxShadow: selectedCategory === category.category_id
                                    ? '0 4px 16px rgba(251, 191, 36, 0.4)'
                                    : 'none'
                            }}
                            onMouseEnter={(e) => {
                                if (selectedCategory !== category.category_id) {
                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                    e.currentTarget.style.transform = 'translateX(8px) scale(1.02)';
                                    e.currentTarget.style.borderColor = '#ef4444';
                                    e.currentTarget.style.color = '#ef4444';
                                    const iconDiv = e.currentTarget.querySelector('div');
                                    if (iconDiv) iconDiv.style.background = 'rgba(239, 68, 68, 0.2)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (selectedCategory !== category.category_id) {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                    e.currentTarget.style.transform = 'translateX(0) scale(1)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                                    e.currentTarget.style.color = 'white';
                                    const iconDiv = e.currentTarget.querySelector('div');
                                    if (iconDiv) iconDiv.style.background = 'rgba(255, 255, 255, 0.1)';
                                }
                            }}
                        >
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                background: selectedCategory === category.category_id
                                    ? 'rgba(251, 191, 36, 0.2)'
                                    : 'rgba(255, 255, 255, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '18px',
                                transition: 'all 0.3s ease'
                            }}>
                                {getCategoryIcon(category.category_name)}
                            </div>
                            <span style={{ flex: 1 }}>{category.category_name}</span>
                            {selectedCategory === category.category_id && (
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: '#fbbf24',
                                    boxShadow: '0 0 12px rgba(251, 191, 36, 0.8)'
                                }}></div>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </>
    );
}
