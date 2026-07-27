import { type MobileTarget } from '../utils/mobileTargets';

interface MobileTargetPickerProps {
    targets: MobileTarget[];
    title: string;
    cancelLabel: string;
    onPick: (deviceId: string) => void;
    onClose: () => void;
}

/**
 * 📱 Escolha do celular quando há MAIS DE UM app pareado. Com um só aparelho
 * a lista nem aparece (o envio é direto) — ela existe pra que o push pare de
 * atingir todos os celulares da casa de uma vez.
 */
export function MobileTargetPicker({ targets, title, cancelLabel, onPick, onClose }: MobileTargetPickerProps) {
    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                background: 'rgba(0, 0, 0, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24
            }}
        >
            <div
                onClick={event => event.stopPropagation()}
                style={{
                    minWidth: 260,
                    maxWidth: 360,
                    padding: 18,
                    borderRadius: 14,
                    background: '#16161f',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                }}
            >
                <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: 600, margin: 0 }}>
                    📱 {title}
                </p>
                {targets.map(target => (
                    <button
                        key={target.id}
                        onClick={() => onPick(target.id)}
                        style={{
                            padding: '12px 14px',
                            borderRadius: 10,
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: 'rgba(255, 255, 255, 0.9)',
                            fontSize: 14,
                            textAlign: 'left',
                            cursor: 'pointer'
                        }}
                    >
                        {target.label}
                    </button>
                ))}
                <button
                    onClick={onClose}
                    style={{
                        padding: '8px 14px',
                        borderRadius: 10,
                        border: 'none',
                        background: 'transparent',
                        color: 'rgba(255, 255, 255, 0.55)',
                        fontSize: 13,
                        cursor: 'pointer'
                    }}
                >
                    {cancelLabel}
                </button>
            </div>
        </div>
    );
}
