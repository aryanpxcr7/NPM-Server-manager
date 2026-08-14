import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { PackageManager, Project, ProjectDetail, ProjectScript, ScriptKind } from '@shared/types'
import { addProject, findProjectByPath, getProject } from './store'

export interface RawPackageJson {
  name?: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export async function readPackageJson(dir: string): Promise<RawPackageJson | null> {
  const file = path.join(dir, 'package.json')
  try {
    return JSON.parse(await readFile(file, 'utf8')) as RawPackageJson
  } catch {
    return null
  }
}

export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/**
 * Opens a terminal in the project folder.
 *
 * Windows Terminal is preferred when present; otherwise a classic console. Paths
 * are passed as argv, never interpolated into a command string, so a folder name
 * containing quotes or ampersands cannot become a command.
 */
export async function openTerminal(dir: string): Promise<void> {
  if (!existsSync(dir)) throw new Error(`Folder no longer exists: ${dir}`)

  const attempts: Array<{ file: string; args: string[] }> = [
    { file: 'wt.exe', args: ['-d', dir] },
    // `start` needs a window title as its first quoted argument, hence the ''.
    { file: process.env.ComSpec ?? 'cmd.exe', args: ['/c', 'start', '', '/D', dir, 'cmd.exe'] }
  ]

  let lastError: Error | null = null
  for (const attempt of attempts) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(attempt.file, attempt.args, {
          cwd: dir,
          detached: true,
          stdio: 'ignore',
          // A terminal the user asked for is the one window that should appear.
          windowsHide: false
        })
        child.on('error', reject)
        child.on('spawn', () => {
          child.unref()
          resolve()
        })
      })
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw new Error(`Could not open a terminal: ${lastError?.message ?? 'unknown error'}`)
}

/** Registers a folder as a project, rejecting anything without a package.json. */
export async function importProject(dir: string): Promise<Project> {
  const resolved = path.resolve(dir)
  if (!existsSync(resolved)) throw new Error(`Folder no longer exists: ${resolved}`)

  const existing = findProjectByPath(resolved)
  if (existing) return existing

  const pkg = await readPackageJson(resolved)
  if (!pkg) {
    throw new Error(`No readable package.json in ${path.basename(resolved)}. Pick the folder that contains it.`)
  }

  return addProject({
    id: randomUUID(),
    name: pkg.name?.trim() || path.basename(resolved),
    path: resolved,
    addedAt: Date.now(),
    packageManager: detectPackageManager(resolved),
    color: null
  })
}

export async function getProjectDetail(id: string): Promise<ProjectDetail> {
  const project = getProject(id)
  if (!project) throw new Error('Project not found.')

  if (!existsSync(project.path)) {
    return {
      project,
      packageJson: null,
      scripts: [],
      hasNodeModules: false,
      error: `Folder is missing: ${project.path}`
    }
  }

  const pkg = await readPackageJson(project.path)
  if (!pkg) {
    return {
      project,
      packageJson: null,
      scripts: [],
      hasNodeModules: existsSync(path.join(project.path, 'node_modules')),
      error: 'package.json is missing or contains invalid JSON.'
    }
  }

  return {
    project,
    packageJson: { name: pkg.name ?? null, version: pkg.version ?? null },
    scripts: classifyScripts(pkg.scripts ?? {}),
    hasNodeModules: existsSync(path.join(project.path, 'node_modules')),
    error: null
  }
}

const KIND_ORDER: Record<ScriptKind, number> = { dev: 0, build: 1, start: 2, test: 3, other: 4 }

/**
 * Sorts scripts so the Start Server dialog leads with dev and build, which is
 * what the user is reaching for the overwhelming majority of the time.
 */
function classifyScripts(scripts: Record<string, string>): ProjectScript[] {
  return Object.entries(scripts)
    .map(([name, command]) => ({ name, command, kind: classify(name, command) }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))
}

function classify(name: string, command: string): ScriptKind {
  const n = name.toLowerCase()
  if (n === 'dev' || n === 'develop' || n.startsWith('dev:') || n === 'serve' || n === 'watch') {
    return 'dev'
  }
  if (n === 'build' || n.startsWith('build:') || n === 'compile') return 'build'
  if (n === 'start' || n.startsWith('start:') || n === 'preview') return 'start'
  if (n === 'test' || n.startsWith('test:') || n === 'lint' || n === 'typecheck') return 'test'

  // Fall back to what the command actually invokes.
  const c = command.toLowerCase()
  if (/\b(vite|next dev|nodemon|webpack serve|--watch)\b/.test(c)) return 'dev'
  if (/\b(vite build|next build|tsc|webpack|rollup|esbuild)\b/.test(c)) return 'build'
  return 'other'
}
