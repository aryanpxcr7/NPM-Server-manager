import path from 'node:path'
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import type { ExternalTerminalShell, IpcResult, ProjectColor, UpdateMode } from '@shared/types'
import { PROJECT_COLORS } from '@shared/types'
import { getProjectDetail, importProject, openTerminal } from './projects'
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
  restartExternal,
  restartServer,
  serverEvents,
  startServer,
  stopServer
} from './servers'
import {
  getProject,
  getProjects,
  removeProject,
  renameProject,
  setProjectColor
} from './store'
import {
  closeSession,
  createSession,
  getBuffer,
  listSessions,
  listShells,
  resizeSession,
  terminalEvents,
  writeSession
} from './terminal'
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

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  onQuitChoice: (choice: 'stop' | 'leave' | 'cancel') => Promise<void>
): void {
  handle('app:quit-choice', (choice: unknown) => {
    if (choice !== 'stop' && choice !== 'leave' && choice !== 'cancel') {
      throw new Error('Unknown quit choice.')
    }
    return onQuitChoice(choice)
  })

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

  handle('projects:set-color', (id: unknown, color: unknown) => {
    const valid = color === null || (typeof color === 'string' && PROJECT_COLORS.includes(color as ProjectColor))
    if (!valid) throw new Error('Unknown colour.')
    return setProjectColor(requireString(id, 'a project id'), color as ProjectColor | null)
  })

  handle('projects:open-terminal', (id: unknown, shell: unknown) => {
    const project = getProject(requireString(id, 'a project id'))
    if (!project) throw new Error('Project not found.')
    if (shell !== 'cmd' && shell !== 'powershell') {
      throw new Error('Choose Command Prompt or PowerShell.')
    }
    return openTerminal(project.path, shell as ExternalTerminalShell)
  })

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
  handle('servers:restart-external', (pid: unknown, projectId: unknown, script: unknown) => {
    if (typeof pid !== 'number') throw new Error('Expected a process id.')
    return restartExternal(
      pid,
      requireString(projectId, 'a project id'),
      requireString(script, 'a script name')
    )
  })
  handle('servers:kill', (pid: unknown) => {
    if (typeof pid !== 'number') throw new Error('Expected a process id.')
    return killPid(pid)
  })
  handle('servers:clear-finished', () => {
    clearFinishedRuns()
    return true
  })

  // --- Terminal -----------------------------------------------------------
  handle('terminal:shells', () => listShells())
  handle('terminal:list', () => listSessions())
  handle('terminal:buffer', (id: unknown) => getBuffer(requireString(id, 'a terminal id')))

  handle('terminal:create', (options: unknown) => {
    const raw = (options ?? {}) as Record<string, unknown>
    return createSession({
      // Only ever a folder we already know about: the renderer passes a project
      // id, never a path it made up.
      projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
      shellId: typeof raw.shellId === 'string' ? raw.shellId : null,
      cols: typeof raw.cols === 'number' ? raw.cols : undefined,
      rows: typeof raw.rows === 'number' ? raw.rows : undefined
    })
  })

  handle('terminal:write', (id: unknown, data: unknown) => {
    if (typeof data !== 'string') throw new Error('Expected terminal input.')
    writeSession(requireString(id, 'a terminal id'), data)
    return true
  })

  handle('terminal:resize', (id: unknown, cols: unknown, rows: unknown) => {
    if (typeof cols !== 'number' || typeof rows !== 'number') {
      throw new Error('Expected terminal dimensions.')
    }
    resizeSession(requireString(id, 'a terminal id'), cols, rows)
    return true
  })

  handle('terminal:close', (id: unknown) => {
    closeSession(requireString(id, 'a terminal id'))
    return true
  })

  // The terminal's own copy and paste. The renderer has no clipboard access it
  // can rely on over file://, and xterm needs the text synchronously enough that
  // a permission prompt would be in the way.
  handle('clipboard:read', () => clipboard.readText())
  handle('clipboard:write', (text: unknown) => {
    // Not requireString: a terminal selection of whitespace is still a selection.
    if (typeof text !== 'string') throw new Error('Expected text to copy.')
    clipboard.writeText(text)
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
  // Output can still arrive while the window is being torn down -- a terminal
  // being killed on quit emits right up to the last moment -- and sending to a
  // destroyed webContents throws from inside the emitter.
  const push = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  serverEvents.on('log', (line) => push('servers:log-line', line))
  serverEvents.on('run-changed', (run) => push('servers:run-changed', run))

  terminalEvents.on('data', (chunk) => push('terminal:data', chunk))
  terminalEvents.on('session', (session) => push('terminal:session', session))
}
