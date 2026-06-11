import { useEffect, useRef, useState } from 'react';

interface LazyImageProps {
    src: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
    /** Rendered when the image fails to load (defaults to a 🎬 placeholder) */
    fallback?: React.ReactNode;
}

const defaultFallback = (
    <div
        style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 48
        }}
    >
        🎬
    </div>
);

/**
 * Dependency-free lazy image: the <img> is only mounted once the wrapper
 * approaches the viewport (IntersectionObserver, 200px rootMargin).
 */
export function LazyImage({ src, alt, className, style, fallback }: LazyImageProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    // Tracking the failed src (instead of a boolean) auto-resets when src changes
    const [errorSrc, setErrorSrc] = useState<string | null>(null);
    const error = errorSrc === src;

    useEffect(() => {
        if (visible) return;
        const element = wrapperRef.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '200px' }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [visible]);

    if (error) {
        return <>{fallback !== undefined ? fallback : defaultFallback}</>;
    }

    return (
        <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
            {visible && (
                <img
                    src={src}
                    alt={alt}
                    className={className}
                    style={style}
                    loading="lazy"
                    onError={() => setErrorSrc(src)}
                />
            )}
        </div>
    );
}
