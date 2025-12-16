import { useState, useEffect } from 'react';
import { parentalService } from '../services/parentalService';
import { useLanguage } from '../services/languageService';
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
import adultoLogo from '../assets/logos/adulto.png';
import diversoLogo from '../assets/logos/diverso.png';
import doramaLogo from '../assets/logos/dorama.png';
import cinemaLogo from '../assets/logos/cinema.png';
import cinemaTvLogo from '../assets/logos/cinema_TV.png';
import dcLogo from '../assets/logos/DC.png';
import fourKLogo from '../assets/logos/4K.png';

interface CategoryMenuProps {
    onSelectCategory: (categoryId: string) => void;
    selectedCategory: string | null;
    type?: 'vod' | 'series' | 'live'; // Type of content
    isKidsProfile?: boolean; // Whether current profile is a Kids profile
}

interface Category {
    category_id: string;
    category_name: string;
    parent_id: number;
}

export function CategoryMenu({ onSelectCategory, selectedCategory, type = 'series', isKidsProfile = false }: CategoryMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(false);
    const { t } = useLanguage();

    // Categories blocked for Kids profiles
    const BLOCKED_CATEGORY_PATTERNS = ['adult', 'adulto', '+18', '18+', 'xxx', 'terror', 'horror', 'erotic', 'erótico'];

    // Categories allowed for Kids in LiveTV (only show these)
    const KIDS_ALLOWED_LIVE_PATTERNS = ['infantil', 'infantis', 'kids', 'criança', '24 horas infantis'];

    const isCategoryBlocked = (categoryName: string): boolean => {
        const lowerName = categoryName.toLowerCase();

        // Check parental control settings (applies to all profiles)
        if (parentalService.shouldHideContent(categoryName)) {
            return true;
        }

        // Kids profile specific logic
        if (isKidsProfile) {
            // For LiveTV: only allow kids categories (whitelist approach)
            if (type === 'live') {
                return !KIDS_ALLOWED_LIVE_PATTERNS.some(pattern => lowerName.includes(pattern));
            }

            // For VOD/Series: block adult categories (blacklist approach)
            return BLOCKED_CATEGORY_PATTERNS.some(pattern => lowerName.includes(pattern));
        }

        return false;
    };

    useEffect(() => {
        if (isOpen && categories.length === 0) {
            fetchCategories();
        }
    }, [isOpen]);

    const fetchCategories = async () => {
        setLoading(true);
        try {
            // Use IPC handler based on type
            let action = 'categories:get-series'; // default
            if (type === 'vod') action = 'categories:get-vod';
            else if (type === 'live') action = 'categories:get-live';

            const result = await window.ipcRenderer.invoke(action);
            if (result.success) {
                setCategories(result.data || []);
            }
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setLoading(false);
        }
    };

    const getCategoryIcon = (categoryName: string): React.ReactElement => {
        const name = categoryName.toLowerCase();
        const size = 28;

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

        if (name.includes('adulto') || name.includes('adult')) return <img src={adultoLogo} alt="Adulto" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('diverso') || name.includes('diverso')) return <img src={diversoLogo} alt="Diverso" style={{ width: size, height: size, objectFit: 'contain' }} />;

        if (name.includes('dorama') || name.includes('k-drama') || name.includes('kdrama') || name.includes('korean')) return <img src={doramaLogo} alt="Dorama" style={{ width: size, height: size, objectFit: 'contain' }} />;

        // Cinema logos
        if (name.includes('cinema tv') || name.includes('cinematv')) return <img src={cinemaTvLogo} alt="Cinema TV" style={{ width: size, height: size, objectFit: 'contain' }} />;
        if (name.includes('cinema')) return <img src={cinemaLogo} alt="Cinema" style={{ width: size, height: size, objectFit: 'contain' }} />;

        // DC Comics
        if (name.includes('dc comics') || name.includes('dc ') || name === 'dc') return <img src={dcLogo} alt="DC" style={{ width: size, height: size, objectFit: 'contain' }} />;

        // 4K
        if (name.includes('4k') || name.includes('ultra hd') || name.includes('uhd')) return <img src={fourKLogo} alt="4K" style={{ width: size, height: size, objectFit: 'contain' }} />;

        // Turcas / Turkish (crescent moon and star)
        if (name.includes('turcas') || name.includes('turca') || name.includes('turkish') || name.includes('turkey')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /><circle cx="17" cy="8" r="1.5" /></svg>;

        // Religião / Religion (cross icon)
        if (name.includes('religião') || name.includes('religiões') || name.includes('religioso') || name.includes('religiosa') || name.includes('religion') || name.includes('gospel') || name.includes('cristão') || name.includes('cristã') || name.includes('catholic') || name.includes('católico') || name.includes('evangélico') || name.includes('igreja')) return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M11 2h2v8h8v2h-8v10h-2V12H3v-2h8V2z" /></svg>;

        // Default
        return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    };

    return (
        <>
            <style>{`
                /* Panel spring animation */
                @keyframes panelSlideIn {
                    0% { 
                        transform: translateX(-100%) scale(0.95);
                        opacity: 0;
                    }
                    60% { 
                        transform: translateX(5%) scale(1.02);
                        opacity: 1;
                    }
                    100% { 
                        transform: translateX(0) scale(1);
                        opacity: 1;
                    }
                }
                
                @keyframes panelSlideOut {
                    from { 
                        transform: translateX(0) scale(1);
                        opacity: 1;
                    }
                    to { 
                        transform: translateX(-100%) scale(0.95);
                        opacity: 0;
                    }
                }
                
                /* Items stagger animation */
                @keyframes itemFadeIn {
                    from { 
                        opacity: 0;
                        transform: translateX(-20px);
                    }
                    to { 
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
                
                /* Header shimmer */
                @keyframes shimmer {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                }
                
                /* Gradient border animation */
                @keyframes borderGlow {
                    0%, 100% { 
                        background-position: 0% 50%;
                        box-shadow: 0 0 20px rgba(99, 102, 241, 0.3);
                    }
                    50% { 
                        background-position: 100% 50%;
                        box-shadow: 0 0 30px rgba(168, 85, 247, 0.4);
                    }
                }
                
                /* Pulse for selected item */
                @keyframes selectedPulse {
                    0%, 100% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.4); }
                    50% { box-shadow: 0 0 35px rgba(251, 191, 36, 0.6); }
                }
                
                /* Loading spinner */
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                
                /* Hamburger animation */
                .hamburger-line {
                    transition: all 0.3s cubic-bezier(0.68, -0.6, 0.32, 1.6);
                    transform-origin: center;
                }
                
                .hamburger-open .line-1 {
                    transform: translateY(6px) rotate(45deg);
                }
                
                .hamburger-open .line-2 {
                    opacity: 0;
                    transform: scaleX(0);
                }
                
                .hamburger-open .line-3 {
                    transform: translateY(-6px) rotate(-45deg);
                }
                
                /* Category panel */
                .category-panel {
                    animation: panelSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }
                
                .category-panel.closing {
                    animation: panelSlideOut 0.3s ease-out forwards;
                }
                
                /* Category item hover effects */
                .category-item {
                    position: relative;
                    overflow: hidden;
                    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                
                .category-item::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: 14px;
                    padding: 2px;
                    background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899, #6366f1);
                    background-size: 300% 300%;
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }
                
                .category-item:hover::before {
                    opacity: 1;
                    animation: borderGlow 2s ease infinite;
                }
                
                .category-item:hover {
                    transform: translateX(8px) scale(1.02);
                    background: rgba(99, 102, 241, 0.1) !important;
                }
                
                .category-item.selected {
                    animation: selectedPulse 2s ease-in-out infinite;
                }
                
                /* Custom scrollbar */
                .category-scroll::-webkit-scrollbar {
                    width: 8px;
                }
                
                .category-scroll::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 4px;
                }
                
                .category-scroll::-webkit-scrollbar-thumb {
                    background: linear-gradient(180deg, #6366f1, #a855f7);
                    border-radius: 4px;
                    border: 2px solid transparent;
                    background-clip: content-box;
                }
                
                .category-scroll::-webkit-scrollbar-thumb:hover {
                    background: linear-gradient(180deg, #818cf8, #c084fc);
                    background-clip: content-box;
                }
                
                /* Toggle button glow */
                .toggle-btn {
                    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                
                .toggle-btn:hover {
                    transform: scale(1.15);
                    filter: drop-shadow(0 0 12px rgba(99, 102, 241, 0.6));
                }
                
                .toggle-btn:active {
                    transform: scale(0.9);
                }
            `}</style>

            {/* Toggle Button - Animated Hamburger */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`toggle-btn ${isOpen ? 'hamburger-open' : ''}`}
                style={{
                    position: 'absolute',
                    top: '20px',
                    left: '4px',
                    zIndex: 90,
                    width: '48px',
                    height: '48px',
                    background: isOpen
                        ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(168, 85, 247, 0.3) 100%)'
                        : 'transparent',
                    border: 'none',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: 0
                }}
            >
                <span
                    className="hamburger-line line-1"
                    style={{
                        width: '22px',
                        height: '2.5px',
                        background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                        borderRadius: '2px',
                        display: 'block'
                    }}
                />
                <span
                    className="hamburger-line line-2"
                    style={{
                        width: '22px',
                        height: '2.5px',
                        background: 'linear-gradient(90deg, #a855f7, #ec4899)',
                        borderRadius: '2px',
                        display: 'block'
                    }}
                />
                <span
                    className="hamburger-line line-3"
                    style={{
                        width: '22px',
                        height: '2.5px',
                        background: 'linear-gradient(90deg, #ec4899, #6366f1)',
                        borderRadius: '2px',
                        display: 'block'
                    }}
                />
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
                className={`category-panel ${!isOpen ? 'closing' : ''}`}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: '380px',
                    background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
                    zIndex: 1000,
                    display: isOpen ? 'flex' : 'none',
                    flexDirection: 'column',
                    backdropFilter: 'blur(24px)',
                    borderRight: '2px solid',
                    borderImage: 'linear-gradient(180deg, rgba(99, 102, 241, 0.5), rgba(168, 85, 247, 0.5), rgba(236, 72, 153, 0.3)) 1',
                    boxShadow: '8px 0 40px rgba(0, 0, 0, 0.5), 0 0 100px rgba(99, 102, 241, 0.15)'
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
                            {t('categories', 'title')}
                        </h2>
                        <p style={{
                            margin: 0,
                            color: 'rgba(255, 255, 255, 0.6)',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}>
                            {t('categories', 'exploreByGenre')}
                        </p>
                    </div>
                </div>

                {/* Categories List with scrollbar styling */}
                <div
                    className="category-scroll"
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: '16px',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(99, 102, 241, 0.5) transparent'
                    }}
                >
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
                                {t('categories', 'loadingCategories')}
                            </p>
                        </div>
                    )}

                    {/* All Categories Option - Premium */}
                    <button
                        onClick={() => {
                            onSelectCategory('all');
                            setIsOpen(false);
                        }}
                        className="category-item"
                        style={{
                            width: '100%',
                            padding: '16px 20px',
                            background: selectedCategory === 'all' || selectedCategory === '' || selectedCategory === null
                                ? 'rgba(251, 191, 36, 0.15)'
                                : 'rgba(255, 255, 255, 0.03)',
                            border: selectedCategory === 'all' || selectedCategory === '' || selectedCategory === null
                                ? '2px solid #fbbf24'
                                : '2px solid rgba(255, 255, 255, 0.05)',
                            borderRadius: '12px',
                            color: selectedCategory === 'all' || selectedCategory === '' || selectedCategory === null ? '#fbbf24' : 'white',
                            fontSize: '15px',
                            fontWeight: selectedCategory === 'all' || selectedCategory === '' || selectedCategory === null ? '600' : '500',
                            textAlign: 'left',
                            cursor: 'pointer',
                            marginBottom: '12px',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            boxShadow: selectedCategory === 'all' || selectedCategory === '' || selectedCategory === null
                                ? '0 4px 16px rgba(251, 191, 36, 0.4)'
                                : 'none'
                        }}
                        onMouseEnter={(e) => {
                            if (selectedCategory !== 'all' && selectedCategory !== '' && selectedCategory !== null) {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                e.currentTarget.style.transform = 'translateX(8px) scale(1.02)';
                                e.currentTarget.style.borderColor = '#ef4444';
                                e.currentTarget.style.color = '#ef4444';
                                const iconDiv = e.currentTarget.querySelector('div');
                                if (iconDiv) iconDiv.style.background = 'rgba(239, 68, 68, 0.2)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (selectedCategory !== 'all' && selectedCategory !== '' && selectedCategory !== null) {
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
                            background: selectedCategory === 'all' || selectedCategory === '' || selectedCategory === null
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
                        <span style={{ flex: 1 }}>
                            {type === 'vod' ? t('categories', 'allMovies') : type === 'live' ? t('categories', 'allChannels') : t('categories', 'allSeries')}
                        </span>
                        {(selectedCategory === 'all' || selectedCategory === '' || selectedCategory === null) && (
                            <div style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#fbbf24',
                                boxShadow: '0 0 12px rgba(251, 191, 36, 0.8)'
                            }}></div>
                        )}
                    </button>

                    {/* Continue Watching - Special Category (Series and VOD) */}
                    {(type === 'series' || type === 'vod') && (
                        <button
                            onClick={() => {
                                onSelectCategory('CONTINUE_WATCHING');
                                setIsOpen(false);
                            }}
                            style={{
                                width: '100%',
                                padding: '16px 20px',
                                background: selectedCategory === 'CONTINUE_WATCHING'
                                    ? 'rgba(59, 130, 246, 0.15)'
                                    : 'rgba(255, 255, 255, 0.03)',
                                border: selectedCategory === 'CONTINUE_WATCHING'
                                    ? '2px solid #3b82f6'
                                    : '2px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '12px',
                                color: selectedCategory === 'CONTINUE_WATCHING' ? '#3b82f6' : 'white',
                                fontSize: '15px',
                                fontWeight: selectedCategory === 'CONTINUE_WATCHING' ? '600' : '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '14px',
                                cursor: 'pointer',
                                marginBottom: '12px',
                                textAlign: 'left',
                                transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                                if (selectedCategory !== 'CONTINUE_WATCHING') {
                                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                                    e.currentTarget.style.transform = 'translateX(4px) scale(1.02)';
                                    e.currentTarget.style.borderColor = '#3b82f6';
                                    e.currentTarget.style.color = '#3b82f6';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (selectedCategory !== 'CONTINUE_WATCHING') {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                    e.currentTarget.style.transform = 'translateX(0) scale(1)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                                    e.currentTarget.style.color = 'white';
                                }
                            }}
                        >
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                background: selectedCategory === 'CONTINUE_WATCHING'
                                    ? 'rgba(59, 130, 246, 0.2)'
                                    : 'rgba(255, 255, 255, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '20px',
                                transition: 'all 0.3s ease'
                            }}>
                                ▶️
                            </div>
                            <span style={{ flex: 1 }}>{t('categories', 'continueWatching')}</span>
                            {selectedCategory === 'CONTINUE_WATCHING' && (
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: '#3b82f6',
                                    boxShadow: '0 0 12px rgba(59, 130, 246, 0.8)'
                                }}></div>
                            )}
                        </button>
                    )}

                    {/* Completed - Special Category (Series only) */}
                    {type === 'series' && (
                        <button
                            onClick={() => {
                                onSelectCategory('COMPLETED');
                                setIsOpen(false);
                            }}
                            style={{
                                width: '100%',
                                padding: '16px 20px',
                                background: selectedCategory === 'COMPLETED'
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(255, 255, 255, 0.03)',
                                border: selectedCategory === 'COMPLETED'
                                    ? '2px solid #10b981'
                                    : '2px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '12px',
                                color: selectedCategory === 'COMPLETED' ? '#10b981' : 'white',
                                fontSize: '15px',
                                fontWeight: selectedCategory === 'COMPLETED' ? '600' : '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '14px',
                                cursor: 'pointer',
                                marginBottom: '16px',
                                textAlign: 'left',
                                transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                                if (selectedCategory !== 'COMPLETED') {
                                    e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)';
                                    e.currentTarget.style.transform = 'translateX(4px) scale(1.02)';
                                    e.currentTarget.style.borderColor = '#10b981';
                                    e.currentTarget.style.color = '#10b981';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (selectedCategory !== 'COMPLETED') {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                    e.currentTarget.style.transform = 'translateX(0) scale(1)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                                    e.currentTarget.style.color = 'white';
                                }
                            }}
                        >
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                background: selectedCategory === 'COMPLETED'
                                    ? 'rgba(16, 185, 129, 0.2)'
                                    : 'rgba(255, 255, 255, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '20px',
                                transition: 'all 0.3s ease'
                            }}>
                                🏆
                            </div>
                            <span style={{ flex: 1 }}>{t('categories', 'completedSeries')}</span>
                            {selectedCategory === 'COMPLETED' && (
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: '#10b981',
                                    boxShadow: '0 0 12px rgba(16, 185, 129, 0.8)'
                                }}></div>
                            )}
                        </button>
                    )}

                    {/* Watched Movies - Special Category (VOD only) */}
                    {type === 'vod' && (
                        <button
                            onClick={() => {
                                onSelectCategory('WATCHED');
                                setIsOpen(false);
                            }}
                            style={{
                                width: '100%',
                                padding: '16px 20px',
                                background: selectedCategory === 'WATCHED'
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(255, 255, 255, 0.03)',
                                border: selectedCategory === 'WATCHED'
                                    ? '2px solid #10b981'
                                    : '2px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '12px',
                                color: selectedCategory === 'WATCHED' ? '#10b981' : 'white',
                                fontSize: '15px',
                                fontWeight: selectedCategory === 'WATCHED' ? '600' : '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '14px',
                                cursor: 'pointer',
                                marginBottom: '16px',
                                textAlign: 'left',
                                transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                                if (selectedCategory !== 'WATCHED') {
                                    e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)';
                                    e.currentTarget.style.transform = 'translateX(4px) scale(1.02)';
                                    e.currentTarget.style.borderColor = '#10b981';
                                    e.currentTarget.style.color = '#10b981';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (selectedCategory !== 'WATCHED') {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                    e.currentTarget.style.transform = 'translateX(0) scale(1)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                                    e.currentTarget.style.color = 'white';
                                }
                            }}
                        >
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                background: selectedCategory === 'WATCHED'
                                    ? 'rgba(16, 185, 129, 0.2)'
                                    : 'rgba(255, 255, 255, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '20px',
                                transition: 'all 0.3s ease'
                            }}>
                                ✅
                            </div>
                            <span style={{ flex: 1 }}>{t('categories', 'watchedMovies')}</span>
                            {selectedCategory === 'WATCHED' && (
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: '#10b981',
                                    boxShadow: '0 0 12px rgba(16, 185, 129, 0.8)'
                                }}></div>
                            )}
                        </button>
                    )}

                    {/* Category Items - Premium Cards */}
                    {categories.filter(cat => !isCategoryBlocked(cat.category_name)).map((category, index) => (
                        <button
                            key={category.category_id}
                            onClick={() => {
                                onSelectCategory(category.category_id);
                                setIsOpen(false);
                            }}
                            className={`category-item ${selectedCategory === category.category_id ? 'selected' : ''}`}
                            style={{
                                width: '100%',
                                padding: '16px 20px',
                                background: selectedCategory === category.category_id
                                    ? 'rgba(251, 191, 36, 0.15)'
                                    : 'rgba(255, 255, 255, 0.03)',
                                border: selectedCategory === category.category_id
                                    ? '2px solid #fbbf24'
                                    : '2px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '14px',
                                color: selectedCategory === category.category_id ? '#fbbf24' : 'white',
                                fontSize: '15px',
                                fontWeight: selectedCategory === category.category_id ? '600' : '500',
                                textAlign: 'left',
                                cursor: 'pointer',
                                marginBottom: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                opacity: 0,
                                animation: `itemFadeIn 0.4s ease ${index * 0.03}s forwards`,
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
