/**
 * Fails if `out/` is stale relative to `src/`, i.e. if the bundle about to be
 * packaged does not include the current sources.
 *
 * This exists because v0.2.0 shipped without its headline feature: the build
 * command was `rm -rf <dir> && npm run build && electron-builder`, the `rm` failed
 * on a locked file, `&&` short-circuited past the build, and electron-builder
 * packaged a weeks-old `out/` under the new version number. Nothing complained.
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function newestMtime(dir, skip = new Set()) {
  let newest = 0
  let newestFile = ''
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const { mtimeMs } = statSync(full)
        if (mtimeMs > newest) {
          newest = mtimeMs
          newestFile = full
        }
      }
    }
  }
  walk(dir)
  return { mtime: newest, file: newestFile }
}

function oldestMtime(dir) {
  let oldest = Infinity
  let oldestFile = ''
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const { mtimeMs } = statSync(full)
        if (mtimeMs < oldest) {
          oldest = mtimeMs
          oldestFile = full
        }
      }
    }
  }
  walk(dir)
  return { mtime: oldest, file: oldestFile }
}

const out = path.join(ROOT, 'out')
const src = path.join(ROOT, 'src')

if (!existsSync(out)) {
  console.error('verify-build: out/ does not exist. Run `npm run build` first.')
  process.exit(1)
}
for (const required of ['main/index.js', 'preload/index.js', 'renderer/index.html']) {
  if (!existsSync(path.join(out, required))) {
    console.error(`verify-build: out/${required} is missing. The build did not complete.`)
    process.exit(1)
  }
}

const newestSrc = newestMtime(src)
const oldestOut = oldestMtime(out)

if (newestSrc.mtime > oldestOut.mtime) {
  console.error('verify-build: out/ is STALE — it predates the current sources.')
  console.error(`  newest source: ${path.relative(ROOT, newestSrc.file)}`)
  console.error(`                 ${new Date(newestSrc.mtime).toISOString()}`)
  console.error(`  oldest output: ${path.relative(ROOT, oldestOut.file)}`)
  console.error(`                 ${new Date(oldestOut.mtime).toISOString()}`)
  console.error('  Run `npm run build` before packaging.')
  process.exit(1)
}

const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
console.log(`verify-build: out/ is current, packaging version ${version}`)
