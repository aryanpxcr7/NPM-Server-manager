import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Project } from '@shared/types'

interface StoreShape {
  version: 1
  projects: Project[]
}

const EMPTY: StoreShape = { version: 1, projects: [] }

let cache: StoreShape | null = null

function storePath(): string {
  return path.join(app.getPath('userData'), 'projects.json')
}

function load(): StoreShape {
  if (cache) return cache
  const file = storePath()
  if (!existsSync(file)) {
    cache = { ...EMPTY, projects: [] }
    return cache
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as StoreShape
    cache = {
      version: 1,
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    }
  } catch {
    // A corrupt store should not brick the app; keep the bad file for forensics.
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* best effort */
    }
    cache = { ...EMPTY, projects: [] }
  }
  return cache
}

function persist(): void {
  const file = storePath()
  mkdirSync(path.dirname(file), { recursive: true })
  // Write to a sibling then rename, so a crash mid-write cannot truncate the store.
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8')
  renameSync(tmp, file)
}

export function getProjects(): Project[] {
  return [...load().projects].sort((a, b) => a.name.localeCompare(b.name))
}

export function getProject(id: string): Project | undefined {
  return load().projects.find((p) => p.id === id)
}

export function findProjectByPath(dir: string): Project | undefined {
  const normalized = normalizePath(dir)
  return load().projects.find((p) => normalizePath(p.path) === normalized)
}

export function addProject(project: Project): Project {
  const store = load()
  const existing = findProjectByPath(project.path)
  if (existing) return existing
  store.projects.push(project)
  persist()
  return project
}

export function removeProject(id: string): void {
  const store = load()
  const next = store.projects.filter((p) => p.id !== id)
  if (next.length === store.projects.length) return
  store.projects = next
  persist()
}

export function renameProject(id: string, name: string): Project | undefined {
  const store = load()
  const project = store.projects.find((p) => p.id === id)
  if (!project) return undefined
  project.name = name
  persist()
  return project
}

/** Case-insensitive, separator-agnostic comparison key for Windows paths. */
export function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}
