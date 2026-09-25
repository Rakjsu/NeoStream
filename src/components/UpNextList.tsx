import { epgService } from '../services/epgService';

interface UpNextProgram {
    id?: string;
    title: string;
    start: string;
}

interface UpNextListProps {
    programs: UpNextProgram[];
    /** Rótulo da seção, já traduzido por quem monta ("A seguir"). */
    heading: string;
}

/**
 * 📺 "A seguir" da ficha do canal na TV ao vivo.
 *
 * Os itens são SÓ informativos (título + horário): nenhum deles tem ação de
 * clique. Por isso não levam `cursor: pointer` nem a classe `epg-item`, cujo
 * hover desliza o card — era a tela prometendo um clique que não fazia nada
 * (D026). Lembrete e gravação do próximo programa ficam no Guia (EPG).
 * Quem um dia pendurar uma ação aqui devolve a affordance JUNTO com um
 * `<button>` de verdade.
 */
export function UpNextList({ programs, heading }: UpNextListProps) {
    if (programs.length === 0) return null;
    return (
        <div>
            <div style={{ fontSize: '13px', color: 'rgba(148, 163, 184, 1)', marginBottom: '14px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {heading}
            </div>
            {programs.map((program, index) => (
                <div
                    key={program.id || index}
                    className="epg-program-item"
                    style={{
                        marginBottom: '10px',
                        padding: 'clamp(10px, 1.5vw, 14px) clamp(12px, 1.5vw, 16px)',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '10px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        animationDelay: `${index * 0.1}s`
                    }}
                >
                    <div style={{ fontSize: 'clamp(12px, 1.2vw, 14px)', color: 'white', fontWeight: '500', marginBottom: '6px' }}>
                        {program.title}
                    </div>
                    <div style={{ fontSize: '12px', color: 'rgba(148, 163, 184, 0.8)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ opacity: 0.7 }}>🕐</span>
                        {epgService.formatTime(program.start)}
                    </div>
                </div>
            ))}
        </div>
    );
}
