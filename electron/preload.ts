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
    'backup:auto-config-get',
    'backup:auto-config-set',
    'backup:auto-save',
    'backup:choose-dir',
    'backup:export-playlists',
    'backup:import-playlists',
    'backup:load-file',
    'backup:save-file',
    'categories:get-live',
    'playlists:add-stalker',
    'stalker:create-link',
    'sync:config-get',
    'sync:config-set',
    'sync:choose-dir',
    'sync:run-now',
    'sync:save',
    'categories:get-series',
    'categories:get-vod',
    'content:get-counts',
    'diagnostics:export-report',
    'diagnostics:provider-health',
    'diagnostics:open-logs',
    'dlna:add-device',
    'dlna:cast',
    'dlna:discover',
    'dlna:get-devices',
    'dlna:get-status',
    'dlna:pause',
    'dlna:remove-device',
    'dlna:resume',
    'dlna:seek',
    'dlna:set-volume',
    'dlna:stop',
    'dvr:active',
    'dvr:delete-file',
    'dvr:list-files',
    'dvr:open-folder',
    'dvr:start',
    'dvr:stop',
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
    'epg:provider-available',
    'epg:provider-channel',
    'epg:provider-search',
    'fetch-url',
    'mpv:available',
    'mpv:download-cancel',
    'mpv:download-start',
    'mpv:pause',
    'mpv:play',
    'mpv:resume',
    'mpv:seek',
    'mpv:add-subtitle',
    'mpv:set-aspect',
    'mpv:set-audio-track',
    'mpv:sub-delay',
    'mpv:set-fullscreen',
    'mpv:set-path',
    'mpv:set-subtitle-track',
    'mpv:set-volume',
    'mpv:status',
    'mpv:stop',
    'notify:show',
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
    'playlists:add',
    'playlists:add-m3u',
    'playlists:get-active-id',
    'playlists:list',
    'playlists:remove',
    'playlists:rename',
    'playlists:switch',
    'security:get-certificate-settings',
    'security:set-allow-invalid-provider-certificates',
    'storage:clear-cache',
    'storage:open-area',
    'storage:usage',
    'transcode:start',
    'transcode:stop',
    'streams:get-live',
    'system:get-config',
    'system:set-config',
    'streams:get-live-url',
    'streams:get-series',
    'streams:get-series-url',
    'streams:get-timeshift-url',
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
    'log:renderer',
    'media:state',
    'pip:control',
    'pip:state',
])

const receiveChannels = new Set([
    'backup:auto-collect',
    'sync:apply-remote',
    'download:progress',
    'media:control',
    'tray:navigate',
    'dvr:progress',
    'dvr:stopped',
    'main-process-message',
    'mpv:download-progress',
    'notify:clicked',
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
