interface ProgressBarProps {
    progress: number; // 0-100
    completed?: boolean;
}

export function ProgressBar({ progress, completed = false }: ProgressBarProps) {
    if (progress === 0) return null;

    return (
        <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            overflow: 'hidden',
            borderBottomLeftRadius: '16px',
            borderBottomRightRadius: '16px'
        }}>
            <div style={{
                height: '100%',
                width: `${Math.min(progress, 100)}%`,
                backgroundColor: completed ? '#10b981' : '#3b82f6',
                transition: 'width 0.3s ease, background-color 0.3s ease',
                boxShadow: completed ? '0 0 8px #10b981' : '0 0 8px #3b82f6'
            }} />
        </div>
    );
}
