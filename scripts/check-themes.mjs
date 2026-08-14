/**
 * Contrast and completeness check for the theme palettes.
 *
 * The palettes in `src/renderer/src/lib/themes.ts` are hand-written from each
 * editor theme's published colours, and a single wrong digit produces text that
 * cannot be read on its own background. This bundles that module with esbuild --
 * the same esbuild vite already depends on -- and measures every pair the UI
 * actually puts together.
 *
 * Thresholds are WCAG contrast ratios, chosen for how each colour is used rather
 * than a blanket AA/AAA: body text is small, button labels are 13px semibold
 * (large-text territory), and the faint colour only ever carries incidental
 * detail like a path or a timestamp.
 *
 *   npm run check:themes
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const TOKENS = [
  'bg', 'bg-raised', 'bg-inset', 'panel', 'border', 'border-strong',
  'text', 'text-dim', 'text-faint',
  'accent', 'accent-hover', 'accent-fg',
  'green', 'amber', 'red', 'violet', 'pink', 'cyan'
]

const MIN = {
  text: 5.5,
  dim: 4.0,
  faint: 2.2,
  accentFg: 3.0,
  accentOnBg: 3.0
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const linear = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const outDir = mkdtempSync(path.join(tmpdir(), 'nsm-themes-'))
try {
  const outfile = path.join(outDir, 'themes.mjs')
  await build({
    entryPoints: ['src/renderer/src/lib/themes.ts'],
    outfile,
    format: 'esm',
    logLevel: 'error'
  })
  const { THEMES } = await import(pathToFileURL(outfile).href)

  let failures = 0
  const seen = new Set()

  for (const theme of THEMES) {
    const c = theme.colors
    const problems = []

    if (seen.has(theme.id)) problems.push('duplicate id')
    seen.add(theme.id)

    for (const token of TOKENS) {
      if (!(token in c)) problems.push(`missing ${token}`)
      else if (!/^#[0-9a-f]{6}$/.test(c[token])) problems.push(`${token} is not #rrggbb (${c[token]})`)
    }
    const extra = Object.keys(c).filter((key) => !TOKENS.includes(key))
    if (extra.length > 0) problems.push(`unknown tokens: ${extra.join(', ')}`)
    if (problems.length > 0) {
      console.log(`FAIL ${theme.id}\n  ${problems.join('\n  ')}`)
      failures += problems.length
      continue
    }

    const measured = {
      text: contrast(c.text, c.bg),
      dim: contrast(c['text-dim'], c.bg),
      faint: contrast(c['text-faint'], c.bg),
      accentFg: contrast(c['accent-fg'], c.accent),
      accentOnBg: contrast(c.accent, c.bg)
    }
    for (const [key, value] of Object.entries(measured)) {
      if (value < MIN[key]) problems.push(`${key} ${value.toFixed(2)} < ${MIN[key]}`)
    }
    // A "dark" theme with a light background would get the wrong scrim and shadow.
    if (theme.dark !== luminance(c.bg) < 0.3) {
      problems.push(`dark: ${theme.dark} but bg luminance is ${luminance(c.bg).toFixed(3)}`)
    }
    if (c.bg === c.panel && c.bg === c['bg-inset']) problems.push('bg, panel and bg-inset are identical')

    const row = Object.entries(measured)
      .map(([key, value]) => `${key} ${value.toFixed(1)}`)
      .join('  ')
    console.log(`${problems.length > 0 ? 'FAIL' : '  ok'} ${theme.dark ? 'D' : 'L'} ${theme.name.padEnd(18)} ${row}`)
    for (const problem of problems) console.log(`       ${problem}`)
    failures += problems.length
  }

  console.log(`\n${THEMES.length} themes checked, ${failures} problem${failures === 1 ? '' : 's'}.`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
