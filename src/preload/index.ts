import { contextBridge, ipcRenderer } from 'electron'
import type { NsmApi } from '@shared/api'
import type { IpcResult, ManagedRun, ServerLogLine } from '@shared/types'

/** Unwraps the main process result envelope, turning failures into rejections. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

const api: NsmApi = {
  toolchain: () => call('toolchain:info'),

  projects: {
    list: () => call('projects:list'),
    pick: () => call('projects:pick'),
    add: (dir) => call('projects:add', dir),
    detail: (id) => call('projects:detail', id),
    remove: (id) => call('projects:remove', id),
    rename: (id, name) => call('projects:rename', id, name),
    reveal: (id) => call('projects:reveal', id)
  },

  packages: {
    scan: (id) => call('packages:scan', id),
    plan: (id, mode) => call('packages:plan', id, mode),
    update: (id, mode, only) => call('packages:update', id, mode, only),
    install: (id) => call('packages:install', id)
  },

  servers: {
    scan: () => call('servers:scan'),
    runs: () => call('servers:runs'),
    log: (runId) => call('servers:log', runId),
    start: (projectId, script) => call('servers:start', projectId, script),
    stop: (runId) => call('servers:stop', runId),
    restart: (runId) => call('servers:restart', runId),
    kill: (pid) => call('servers:kill', pid),
    clearFinished: () => call('servers:clear-finished'),

    onLog: (handler) => {
      const listener = (_e: unknown, line: ServerLogLine): void => handler(line)
      ipcRenderer.on('servers:log-line', listener)
      return () => ipcRenderer.off('servers:log-line', listener)
    },
    onRunChanged: (handler) => {
      const listener = (_e: unknown, run: ManagedRun): void => handler(run)
      ipcRenderer.on('servers:run-changed', listener)
      return () => ipcRenderer.off('servers:run-changed', listener)
    }
  },

  openExternal: (url) => call('shell:open-external', url)
}

contextBridge.exposeInMainWorld('nsm', api)
