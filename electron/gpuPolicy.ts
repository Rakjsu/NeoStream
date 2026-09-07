/**
 * Política de aceleração por hardware — parte PURA (sem imports, como
 * trayClosePolicy.ts, pra ser testável sem mock de electron).
 *
 * ## A autópsia
 *
 * O main abria com quatro `appendSwitch` sob o comentário "Enable Hardware
 * Acceleration and HEVC". Conferidos contra o Chromium 152.0.7977.65, que é o
 * do Electron 44.1.1 (o que este projeto usa):
 *
 * - `ignore-gpu-blacklist` — MORTO. O nome virou `ignore-gpu-blocklist`
 *   (gpu/config/gpu_switches.cc). Ou seja: o app NUNCA ignorou a lista de
 *   bloqueio, ao contrário do que o comentário prometia.
 * - `enable-gpu-rasterization` — vivo. É o único dos quatro que fazia algo.
 * - `enable-zero-copy` — MORTO. Não existe mais em content_switches,
 *   cc/base/switches, gpu_switches nem viz/common/switches.
 * - `enable-features=VaapiVideoDecoder,VaapiVideoEncoder` — nomes MORTOS. As
 *   equivalentes de Linux hoje se chamam `AcceleratedVideoDecoder` e
 *   `AcceleratedVideoEncoder`. E o comentário "Linux/Mac mostly" errava duas
 *   vezes: VA-API não existe no macOS (lá é VideoToolbox) e o produto é
 *   entregue sobretudo para Windows.
 *
 * Switch desconhecido é ignorado EM SILÊNCIO pelo Chromium — por isso nada
 * quebrou e ninguém percebeu. Nenhum dos quatro tem relação com HEVC: no
 * Windows isso depende de extensão do sistema, como a própria linha seguinte
 * do código antigo admitia.
 *
 * ## A escolha do padrão
 *
 * `auto` NÃO manda `ignore-gpu-blocklist` — que é exatamente o que o app faz
 * hoje, já que o nome errado nunca valeu. Assim, corrigir o nome não vira uma
 * mudança de comportamento silenciosa para toda a base instalada: forçar a
 * GPU numa placa que o Chromium bloqueou de propósito costuma dar tela preta,
 * e o escape ficaria atrás de uma tela de Configurações que talvez nem abra.
 * Quem tem GPU boa marcada errado escolhe `force`; quem tem driver quebrado
 * escolhe `off`.
 */

export const HW_ACCEL_MODES = ['auto', 'force', 'off'] as const

export type HwAccelMode = (typeof HW_ACCEL_MODES)[number]

/** Igual ao efeito de hoje: a lista de bloqueio do Chromium é obedecida. */
export const DEFAULT_HW_ACCEL: HwAccelMode = 'auto'

/** Valor gravado (ou lixo, ou ausente) → modo válido. */
export function normalizeHwAccelMode(raw: unknown): HwAccelMode {
    return (HW_ACCEL_MODES as readonly string[]).includes(raw as string)
        ? (raw as HwAccelMode)
        : DEFAULT_HW_ACCEL
}

export interface GpuPolicy {
    /** Pares [switch, valor?] para `app.commandLine.appendSwitch`. */
    switches: [string, string?][]
    /** `app.disableHardwareAcceleration()` — só no modo desligado. */
    disableHardwareAcceleration: boolean
}

/** O que aplicar no boot para cada modo. PURO. */
export function gpuSwitchesFor(mode: HwAccelMode): GpuPolicy {
    if (mode === 'off') return { switches: [], disableHardwareAcceleration: true }
    const switches: [string, string?][] = [['enable-gpu-rasterization']]
    // Nome CORRIGIDO. Só entra quando o usuário pede explicitamente.
    if (mode === 'force') switches.unshift(['ignore-gpu-blocklist'])
    return { switches, disableHardwareAcceleration: false }
}
