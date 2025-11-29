import { useState, useEffect } from 'react';

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

    return (
        <>
            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(-100%); }
                    to { transform: translateX(0); }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); }
                    to { transform: translateX(-100%); }
                }
            `}</style>

            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    position: 'absolute',
                    top: '32px',
                    left: '32px',
                    zIndex: 90,
                    width: '48px',
                    height: '48px',
                    backgroundColor: 'rgba(37, 99, 235, 0.9)',
                    border: 'none',
                    borderRadius: '8px',
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
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.1)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(37, 99, 235, 0.6)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.4)';
                }}
            >
                {isOpen ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                )}
            </button>

            {/* Backdrop */}
            {isOpen && (
                <div
                    onClick={() => setIsOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        zIndex: 999,
                        backdropFilter: 'blur(2px)'
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
                    width: '300px',
                    backgroundColor: 'rgba(17, 24, 39, 0.98)',
                    zIndex: 1000,
                    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isOpen ? '4px 0 24px rgba(0, 0, 0, 0.5)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    backdropFilter: 'blur(10px)'
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '24px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    <h2 style={{
                        margin: 0,
                        color: 'white',
                        fontSize: '20px',
                        fontWeight: 'bold'
                    }}>
                        Categorias
                    </h2>
                </div>

                {/* Categories List */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '12px'
                }}>
                    {loading && (
                        <div style={{
                            padding: '24px',
                            textAlign: 'center',
                            color: '#9ca3af'
                        }}>
                            Carregando...
                        </div>
                    )}

                    {/* All Categories Option */}
                    <button
                        onClick={() => {
                            onSelectCategory('');
                            setIsOpen(false);
                        }}
                        style={{
                            width: '100%',
                            padding: '12px 16px',
                            backgroundColor: selectedCategory === '' || selectedCategory === null
                                ? 'rgba(37, 99, 235, 0.2)'
                                : 'transparent',
                            border: selectedCategory === '' || selectedCategory === null
                                ? '1px solid rgba(37, 99, 235, 0.5)'
                                : '1px solid transparent',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '15px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            marginBottom: '8px',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            if (selectedCategory !== '' && selectedCategory !== null) {
                                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (selectedCategory !== '' && selectedCategory !== null) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                            }
                        }}
                    >
                        📺 Todas as Séries
                    </button>

                    {categories.map((category) => (
                        <button
                            key={category.category_id}
                            onClick={() => {
                                onSelectCategory(category.category_id);
                                setIsOpen(false);
                            }}
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                backgroundColor: selectedCategory === category.category_id
                                    ? 'rgba(37, 99, 235, 0.2)'
                                    : 'transparent',
                                border: selectedCategory === category.category_id
                                    ? '1px solid rgba(37, 99, 235, 0.5)'
                                    : '1px solid transparent',
                                borderRadius: '8px',
                                color: 'white',
                                fontSize: '15px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                marginBottom: '8px',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                if (selectedCategory !== category.category_id) {
                                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (selectedCategory !== category.category_id) {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            📁 {category.category_name}
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}
