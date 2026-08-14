import path from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcResult, UpdateMode } from '@shared/types'
import { getProjectDetail, importProject } from './projects'
import {
  applyUpdates,
  installPackages,
  planUpdates,
  scanPackages
} from './packages'
import { scanServers } from './scan'
import {
  clearFinishedRuns,
  getRunLog,
  killPid,
  listRuns,
  restartServer,
  serverEvents,
  startServer,
  stopServer
} from './servers'
import { getProject, getProjects, removeProject, renameProject } from './store'
import { resolveToolchain } from './toolchain'
import { checkForUpdate, downloadUpdate, installUpdate, releasesPage } from './updates'

/** Wraps a handler so the renderer always receives a result object, never a rejection. */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<R>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected ${label}.`)
  }
  return value
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  handle('toolchain:info', () => resolveToolchain())

  // --- Projects -----------------------------------------------------------
  handle('projects:list', () => getProjects())

  handle('projects:pick', async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Add project folder',
          properties: ['openDirectory', 'multiSelections']
        })
      : await dialog.showOpenDialog({
          title: 'Add project folder',
          properties: ['openDirectory', 'multiSelections']
        })

    if (result.canceled || result.filePaths.length === 0) return { added: [], errors: [] }

    const added: string[] = []
    const errors: string[] = []
    for (const dir of result.filePaths) {
      try {
        const project = await importProject(dir)
        added.push(project.name)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    return { added, errors }
  })

  handle('projects:add', (dir: unknown) => importProject(requireString(dir, 'a folder path')))
  handle('projects:detail', (id: unknown) => getProjectDetail(requireString(id, 'a project id')))
  handle('projects:remove', (id: unknown) => {
    removeProject(requireString(id, 'a project id'))
    return true
  })
  handle('projects:rename', (id: unknown, name: unknown) =>
    renameProject(requireString(id, 'a project id'), requireString(name, 'a name'))
  )

  handle('projects:reveal', (id: unknown) => {
    const project = getProject(requireString(id, 'a project id'))
    if (!project) throw new Error('Project not found.')
    shell.openPath(project.path)
    return true
  })

  // --- Packages -----------------------------------------------------------
  handle('packages:scan', (id: unknown) => scanPackages(requireString(id, 'a project id')))
  handle('packages:plan', (id: unknown, mode: unknown) =>
    planUpdates(requireString(id, 'a project id'), mode === 'latest' ? 'latest' : 'wanted')
  )
  handle('packages:update', (id: unknown, mode: unknown, only: unknown) =>
    applyUpdates(
      requireString(id, 'a project id'),
      (mode === 'latest' ? 'latest' : 'wanted') as UpdateMode,
      Array.isArray(only) ? only.filter((x): x is string => typeof x === 'string') : undefined
    )
  )
  handle('packages:install', (id: unknown) => installPackages(requireString(id, 'a project id')))

  // --- Servers ------------------------------------------------------------
  handle('servers:scan', () => scanServers())
  handle('servers:runs', () => listRuns())
  handle('servers:log', (runId: unknown) => getRunLog(requireString(runId, 'a run id')))
  handle('servers:start', (id: unknown, script: unknown) =>
    startServer(requireString(id, 'a project id'), requireString(script, 'a script name'))
  )
  handle('servers:stop', (runId: unknown) => stopServer(requireString(runId, 'a run id')))
  handle('servers:restart', (runId: unknown) => restartServer(requireString(runId, 'a run id')))
  handle('servers:kill', (pid: unknown) => {
    if (typeof pid !== 'number') throw new Error('Expected a process id.')
    return killPid(pid)
  })
  handle('servers:clear-finished', () => {
    clearFinishedRuns()
    return true
  })

  // --- Updates ------------------------------------------------------------
  handle('updates:check', () => checkForUpdate())
  handle('updates:releases-page', () => releasesPage())

  handle('updates:download', async (info: unknown) => {
    const asset = info as { assetUrl?: unknown; assetName?: unknown; assetSize?: unknown }
    if (typeof asset?.assetUrl !== 'string' || typeof asset?.assetName !== 'string') {
      throw new Error('This release has no installer attached.')
    }
    // Only ever download from the releases host we publish to.
    const parsed = new URL(asset.assetUrl)
    if (parsed.protocol !== 'https:' || !/(^|\.)github(usercontent)?\.com$/.test(parsed.hostname)) {
      throw new Error('Refusing to download from an unexpected host.')
    }

    return downloadUpdate(
      {
        assetUrl: asset.assetUrl,
        assetName: path.basename(asset.assetName),
        assetSize: typeof asset.assetSize === 'number' ? asset.assetSize : null
      },
      (received, total) => {
        getWindow()?.webContents.send('updates:progress', { received, total })
      }
    )
  })

  handle('updates:install', (installerPath: unknown) =>
    installUpdate(requireString(installerPath, 'the installer path'))
  )

  handle('shell:open-external', (url: unknown) => {
    const raw = requireString(url, 'a URL')
    // Only ever hand http(s) to the OS, never file:// or a custom scheme.
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http and https links can be opened.')
    }
    shell.openExternal(parsed.toString())
    return true
  })

  // --- Push events to the renderer ---------------------------------------
  serverEvents.on('log', (line) => getWindow()?.webContents.send('servers:log-line', line))
  serverEvents.on('run-changed', (run) => getWindow()?.webContents.send('servers:run-changed', run))
}
