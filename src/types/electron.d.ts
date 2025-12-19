interface IpcRenderer {
    on(channel: string, listener: (event: any, ...args: any[]) => void): void
    off(channel: string, listener: (event: any, ...args: any[]) => void): void
    send(channel: string, ...args: any[]): void
    invoke(channel: string, data?: any): Promise<any>
}

interface Window {
    ipcRenderer: IpcRenderer
}
