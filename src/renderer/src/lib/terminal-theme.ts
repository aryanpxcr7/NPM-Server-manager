/**
 * The xterm.js palette, derived from the app's theme.
 *
 * xterm cannot read CSS custom properties -- it paints to a canvas from concrete
 * colours -- so this is the one place a colour is computed in TypeScript instead
 * of with `color-mix()` in the stylesheet. The rule it follows is the same one:
 * nothing is invented, every value comes out of the eighteen theme tokens, so a
 * new theme gets a matching terminal for free. See docs/DECISIONS.md §18 and §19.
 */
import type { Theme } from './themes'

export interface TerminalPalette {
  foreground: string
  background: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb {
  const value = hex.trim().replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  const n = Number.parseInt(full.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

/** `amount` of `b` mixed into `a`, the same operation `color-mix()` performs. */
function mix(a: string, b: string, amount: number): string {
  const from = parseHex(a)
  const to = parseHex(b)
  return toHex([0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * amount) as Rgb)
}

function alpha(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${amount})`
}

/**
 * The sixteen ANSI colours plus the surface ones.
 *
 * The bright variants are mixed *towards the theme's own text colour* rather than
 * towards white, which is what makes them read correctly on a light theme: on
 * Gruvbox Dark that lightens them, on Ayu Light it darkens them. Mixing towards
 * white would have made "bright" mean "invisible" on half the themes.
 */
export function terminalPalette(theme: Theme): TerminalPalette {
  const c = theme.colors
  const bright = (color: string): string => mix(color, c.text, 0.32)

  return {
    foreground: c.text,
    background: c['bg-inset'],
    cursor: c.accent,
    cursorAccent: c['bg-inset'],
    selectionBackground: alpha(c.accent, 0.32),

    // ANSI black and white are the ends of the neutral ramp, so they flip with
    // the theme: on a light background "black" has to be the dark end.
    black: theme.dark ? c['bg-inset'] : c.text,
    red: c.red,
    green: c.green,
    yellow: c.amber,
    blue: c.accent,
    magenta: c.violet,
    cyan: c.cyan,
    white: theme.dark ? c['text-dim'] : c['text-faint'],

    brightBlack: c['text-faint'],
    brightRed: bright(c.red),
    brightGreen: bright(c.green),
    brightYellow: bright(c.amber),
    brightBlue: c['accent-hover'],
    brightMagenta: c.pink,
    brightCyan: bright(c.cyan),
    brightWhite: theme.dark ? c.text : c['text-dim']
  }
}
