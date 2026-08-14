/**
 * The shape of `window.nsm`, declared here rather than in the preload script so
 * the renderer can type against it without pulling Electron into its program.
 * The preload implementation is checked against this type.
 */
import type {
  CommandResult,
  DetectedServer,
  ManagedRun,
  PackageScanResult,
  Project,
  ProjectColor,
  ProjectDetail,
  ServerLogLine,
  TerminalBuffer,
  TerminalChunk,
  TerminalSession,
  TerminalShell,
  UpdateInfo,
  UpdateMode,
  UpdatePlanEntry,
  UpdateProgress
} from './types'

export interface ToolchainInfo {
  nodeExe: string
  npmCli: string
  nodeVersion: string
  npmVersion: string
}

export interface PickResult {
  added: string[]
  errors: string[]
}

export interface NsmApi {
  toolchain: () => Promise<ToolchainInfo>

  projects: {
    list: () => Promise<Project[]>
    pick: () => Promise<PickResult>
    add: (dir: string) => Promise<Project>
    detail: (id: string) => Promise<ProjectDetail>
    remove: (id: string) => Promise<boolean>
    rename: (id: string, name: string) => Promise<Project>
    reveal: (id: string) => Promise<boolean>
    setColor: (id: string, color: ProjectColor | null) => Promise<Project>
    openTerminal: (id: string) => Promise<void>
  }

  packages: {
    scan: (id: string) => Promise<PackageScanResult>
    plan: (id: string, mode: UpdateMode) => Promise<UpdatePlanEntry[]>
    update: (id: string, mode: UpdateMode, only?: string[]) => Promise<CommandResult>
    install: (id: string) => Promise<CommandResult>
  }

  servers: {
    scan: () => Promise<DetectedServer[]>
    runs: () => Promise<ManagedRun[]>
    log: (runId: string) => Promise<ServerLogLine[]>
    start: (projectId: string, script: string) => Promise<ManagedRun>
    stop: (runId: string) => Promise<void>
    restart: (runId: string) => Promise<ManagedRun>
    /**
     * Stops a server this app did not start and runs its npm script again, so it
     * comes back as a managed run. Only offered when `restartable` is set.
     */
    restartExternal: (pid: number, projectId: string, script: string) => Promise<ManagedRun>
    kill: (pid: number) => Promise<void>
    clearFinished: () => Promise<boolean>
    onLog: (handler: (line: ServerLogLine) => void) => () => void
    onRunChanged: (handler: (run: ManagedRun) => void) => () => void
  }

  terminal: {
    /** Shells found on this machine, best first. */
    shells: () => Promise<TerminalShell[]>
    list: () => Promise<TerminalSession[]>
    /** Scrollback so far, for a panel that mounted after the session started. */
    buffer: (id: string) => Promise<TerminalBuffer>
    create: (options: {
      projectId?: string | null
      shellId?: string | null
      cols?: number
      rows?: number
    }) => Promise<TerminalSession>
    write: (id: string, data: string) => Promise<boolean>
    resize: (id: string, cols: number, rows: number) => Promise<boolean>
    close: (id: string) => Promise<boolean>
    onData: (handler: (chunk: TerminalChunk) => void) => () => void
    onSession: (handler: (session: TerminalSession) => void) => () => void
  }

  clipboard: {
    read: () => Promise<string>
    write: (text: string) => Promise<boolean>
  }

  updates: {
    check: () => Promise<UpdateInfo>
    releasesPage: () => Promise<string>
    /** Downloads the installer, resolving to its path on disk. */
    download: (
      info: Pick<UpdateInfo, 'assetUrl' | 'assetName' | 'assetSize'>
    ) => Promise<string>
    /** Launches the installer and quits the app. */
    install: (installerPath: string) => Promise<void>
    onProgress: (handler: (progress: UpdateProgress) => void) => () => void
  }

  app: {
    /** Fires when the window is closing with servers still running. */
    onConfirmQuit: (handler: (info: { liveRuns: number }) => void) => () => void
    quitChoice: (choice: 'stop' | 'leave' | 'cancel') => Promise<void>
  }

  openExternal: (url: string) => Promise<boolean>
}

declare global {
  interface Window {
    nsm: NsmApi
  }
}
