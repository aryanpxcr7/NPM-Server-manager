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
  ProjectDetail,
  ServerLogLine,
  UpdateMode,
  UpdatePlanEntry
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
    kill: (pid: number) => Promise<void>
    clearFinished: () => Promise<boolean>
    onLog: (handler: (line: ServerLogLine) => void) => () => void
    onRunChanged: (handler: (run: ManagedRun) => void) => () => void
  }

  openExternal: (url: string) => Promise<boolean>
}

declare global {
  interface Window {
    nsm: NsmApi
  }
}
