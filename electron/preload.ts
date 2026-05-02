import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void

const invokeChannels = new Set([
    'airplay:cast',
    'airplay:discover',
    'airplay:stop',
    'auth:check',
    'auth:get-credentials',
    'auth:login',
    'auth:logout',
    'categories:get-live',
    'categories:get-series',
    'categories:get-vod',
    'content:get-counts',
    'dlna:add-device',
    'dlna:cast',
    'dlna:discover',
    'dlna:get-devices',
    'dlna:remove-device',
    'dlna:stop',
    'download:cache-image',
    'download:cancel',
    'download:delete-file',
    'download:delete-folder',
    'download:get-files',
    'download:get-storage-info',
    'download:open-file',
    'download:open-folder',
    'download:pause',
    'download:start',
    'epg:fetch-meuguia',
    'epg:fetch-mitv',
    'epg:get-cache-info',
    'epg:get-cached',
    'fetch-url',
    'opensubtitles:request',
    'ping',
    'pip:clickThrough',
    'pip:close',
    'pip:close-and-get',
    'pip:expand',
    'pip:getClickThrough',
    'pip:getNextEpisode',
    'pip:getState',
    'pip:open',
    'security:get-certificate-settings',
    'security:set-allow-invalid-provider-certificates',
    'streams:get-live',
    'streams:get-live-url',
    'streams:get-series',
    'streams:get-series-url',
    'streams:get-vod',
    'streams:get-vod-url',
    'update:check-now',
    'update:download',
    'update:get-config',
    'update:install',
    'update:set-config',
    'update:skip-version',
    'window:close',
    'window:is-maximized',
    'window:maximize',
    'window:minimize',
])

const sendChannels = new Set([
    'pip:control',
    'pip:state',
])

const receiveChannels = new Set([
    'download:progress',
    'main-process-message',
    'pip:clickThroughChanged',
    'pip:closed',
    'pip:control',
    'pip:expand',
    'pip:requestNextEpisode',
    'pip:state',
    'update:available',
    'update:checking',
    'update:download-progress',
    'update:downloaded',
    'update:error',
    'update:not-available',
])

const dynamicSendChannels = [/^pip:nextEpisodeResponse:\d+$/]
const listeners = new Map<IpcListener, IpcListener>()

const isAllowed = (channel: string, allowedChannels: Set<string>, dynamicChannels: RegExp[] = []) =>
    allowedChannels.has(channel) || dynamicChannels.some((pattern) => pattern.test(channel))

const assertAllowed = (channel: string, allowedChannels: Set<string>, dynamicChannels: RegExp[] = []) => {
    if (!isAllowed(channel, allowedChannels, dynamicChannels)) {
        throw new Error(`Blocked IPC channel: ${channel}`)
    }
}

contextBridge.exposeInMainWorld('ipcRenderer', {
    on(channel: string, listener: IpcListener) {
        assertAllowed(channel, receiveChannels)
        const wrappedListener: IpcListener = (event, ...args) => listener(event, ...args)
        listeners.set(listener, wrappedListener)
        ipcRenderer.on(channel, wrappedListener)
    },
    off(channel: string, listener: IpcListener) {
        assertAllowed(channel, receiveChannels)
        const wrappedListener = listeners.get(listener)
        if (wrappedListener) {
            ipcRenderer.off(channel, wrappedListener)
            listeners.delete(listener)
        }
    },
    send(channel: string, ...args: unknown[]) {
        assertAllowed(channel, sendChannels, dynamicSendChannels)
        ipcRenderer.send(channel, ...args)
    },
    invoke(channel: string, data?: unknown) {
        assertAllowed(channel, invokeChannels)
        return ipcRenderer.invoke(channel, data)
    },
})
