import { contextBridge, ipcRenderer } from 'electron'
import type { NsmApi } from '@shared/api'
import type {
  IpcResult,
  ManagedRun,
  ServerLogLine,
  ExternalTerminalShell,
  TerminalChunk,
  TerminalSession,
  UpdateProgress
} from '@shared/types'

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
    reveal: (id) => call('projects:reveal', id),
    setColor: (id, color) => call('projects:set-color', id, color),
    openTerminal: (id, shell: ExternalTerminalShell) => call('projects:open-terminal', id, shell)
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
    restartExternal: (pid, projectId, script) =>
      call('servers:restart-external', pid, projectId, script),
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

  terminal: {
    shells: () => call('terminal:shells'),
    list: () => call('terminal:list'),
    buffer: (id) => call('terminal:buffer', id),
    create: (options) => call('terminal:create', options),
    write: (id, data) => call('terminal:write', id, data),
    resize: (id, cols, rows) => call('terminal:resize', id, cols, rows),
    close: (id) => call('terminal:close', id),

    onData: (handler) => {
      const listener = (_e: unknown, chunk: TerminalChunk): void => handler(chunk)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.off('terminal:data', listener)
    },
    onSession: (handler) => {
      const listener = (_e: unknown, session: TerminalSession): void => handler(session)
      ipcRenderer.on('terminal:session', listener)
      return () => ipcRenderer.off('terminal:session', listener)
    }
  },

  clipboard: {
    read: () => call('clipboard:read'),
    write: (text) => call('clipboard:write', text)
  },

  updates: {
    check: () => call('updates:check'),
    releasesPage: () => call('updates:releases-page'),
    download: (info) => call('updates:download', info),
    install: (installerPath) => call('updates:install', installerPath),
    onProgress: (handler) => {
      const listener = (_e: unknown, progress: UpdateProgress): void => handler(progress)
      ipcRenderer.on('updates:progress', listener)
      return () => ipcRenderer.off('updates:progress', listener)
    }
  },

  app: {
    onConfirmQuit: (handler) => {
      const listener = (_e: unknown, info: { liveRuns: number }): void => handler(info)
      ipcRenderer.on('app:confirm-quit', listener)
      return () => ipcRenderer.off('app:confirm-quit', listener)
    },
    quitChoice: (choice) => call('app:quit-choice', choice)
  },

  openExternal: (url) => call('shell:open-external', url)
}

contextBridge.exposeInMainWorld('nsm', api)
