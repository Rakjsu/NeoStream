// 📱 Alvos do "enviar pro celular". O controle web já lista os clientes
// individualmente, mas o push ia pra TODOS os celulares pareados de uma vez:
// com dois aparelhos na casa, o filme que o pai manda pro dele abre também no
// do filho. Aqui os celulares viram alvos escolhíveis (rótulo único).

export interface RemoteClient {
    id: string;
    ip?: string;
    name?: string | null;
    role?: string;
    /** Id do aparelho vindo do hello — sobrevive à reconexão. */
    deviceId?: string | null;
}

export interface MobileTarget {
    /** Id mandado no IPC: o do aparelho quando existe, senão o da conexão. */
    id: string;
    label: string;
}

/**
 * Só os clientes que são o APP (a página do navegador não toca nada) — com
 * rótulo desambiguado pelo IP quando dois aparelhos têm o mesmo nome. PURO.
 */
export function toMobileTargets(clients: RemoteClient[]): MobileTarget[] {
    const mobiles = clients.filter(client => client.role === 'mobile');
    const names = new Map<string, number>();
    for (const client of mobiles) {
        const name = client.name?.trim() || 'celular';
        names.set(name, (names.get(name) ?? 0) + 1);
    }
    return mobiles.map(client => {
        const name = client.name?.trim() || 'celular';
        const ambiguous = (names.get(name) ?? 0) > 1;
        return {
            id: client.deviceId || client.id,
            label: ambiguous && client.ip ? `${name} · ${client.ip}` : name,
        };
    });
}

/** Celulares conectados agora (lista vazia = nenhum app pareado). */
export async function listMobileTargets(): Promise<MobileTarget[]> {
    const res = await window.ipcRenderer.invoke('web-remote:clients-list')
        .catch(() => null) as { clients?: RemoteClient[] } | null;
    return toMobileTargets(res?.clients ?? []);
}
