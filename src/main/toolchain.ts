import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface Toolchain {
  /** Absolute path to the user's node.exe. */
  nodeExe: string
  /** Absolute path to npm-cli.js, so we can run npm without a shell. */
  npmCli: string
  nodeVersion: string
  npmVersion: string
}

let cached: Toolchain | null = null
let cachedError: string | null = null

/**
 * Electron ships its own Node, but projects should run under the Node the user
 * actually installed (nvm switches, engine constraints, native addons). We locate
 * node.exe on PATH and the npm-cli.js that sits beside it, which lets us spawn
 * `node npm-cli.js run <script>` directly -- no shell, so nothing in a project
 * path or script name can ever be interpreted as a command.
 */
export async function resolveToolchain(): Promise<Toolchain> {
  if (cached) return cached
  if (cachedError) throw new Error(cachedError)

  try {
    const nodeExe = await whichNode()
    const npmCli = findNpmCli(nodeExe)
    if (!npmCli) {
      throw new Error(
        `Found Node at ${nodeExe} but could not locate npm-cli.js beside it. Is npm installed?`
      )
    }

    const [nodeVersion, npmVersion] = await Promise.all([
      execFileAsync(nodeExe, ['--version']).then((r) => r.stdout.trim()),
      execFileAsync(nodeExe, [npmCli, '--version']).then((r) => r.stdout.trim())
    ])

    cached = { nodeExe, npmCli, nodeVersion, npmVersion }
    return cached
  } catch (err) {
    cachedError = err instanceof Error ? err.message : String(err)
    throw new Error(cachedError)
  }
}

async function whichNode(): Promise<string> {
  // `where` returns every match on PATH, one per line; the first wins.
  try {
    const { stdout } = await execFileAsync('where', ['node.exe'], { windowsHide: true })
    const first = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)[0]
    if (first && existsSync(first)) return first
  } catch {
    // `where` exits 1 when nothing matches; fall through to the known locations.
  }

  const guesses = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(process.env.APPDATA ?? '', 'npm', 'node.exe')
  ]
  for (const guess of guesses) {
    if (guess && existsSync(guess)) return guess
  }

  throw new Error(
    'Could not find node.exe on your PATH. Install Node.js from nodejs.org, then restart this app.'
  )
}

function findNpmCli(nodeExe: string): string | null {
  const nodeDir = path.dirname(nodeExe)
  const candidates = [
    // Standard Windows install and nvm-windows version dirs.
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    // Some installs put the libs under lib/.
    path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ]
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (existsSync(resolved)) return resolved
  }
  return null
}

/** Runs an npm subcommand to completion and captures its output. */
export async function runNpm(
  args: string[],
  cwd: string,
  options: { maxBuffer?: number; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { nodeExe, npmCli } = await resolveToolchain()

  return new Promise((resolve) => {
    execFile(
      nodeExe,
      [npmCli, ...args],
      {
        cwd,
        windowsHide: true,
        maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
        timeout: options.timeout ?? 120_000,
        env: { ...process.env, NO_COLOR: '1', NPM_CONFIG_COLOR: 'false' }
      },
      (error, stdout, stderr) => {
        // Several npm subcommands (notably `outdated` and `ls`) exit non-zero to
        // signal findings rather than failure, so the caller inspects the code.
        const exitCode =
          error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === 'number'
            ? ((error as unknown as { code: number }).code satisfies number)
            : error
              ? 1
              : 0
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode })
      }
    )
  })
}
