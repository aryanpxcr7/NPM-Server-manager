/**
 * URL detection for log output.
 *
 * Dev servers announce themselves in a dozen shapes -- Vite's
 * `➜  Local:   http://localhost:5173/`, Next's `- Local: http://localhost:3000`,
 * a bare `listening on localhost:8080`. Anything addressable becomes a link; the
 * scheme-less form is completed with `http://` because that is what a dev server
 * speaks.
 *
 * Control characters are excluded from the match so an ANSI-coloured line
 * (`ESC[36mhttp://localhost:5173/ESC[39m`) yields the URL alone rather than the
 * escape sequence that follows it.
 */

const NOT_IN_URL = "\\s<>\"'`\\u0000-\\u001f"

const LINK_PATTERN = new RegExp(
  [
    `https?://[^${NOT_IN_URL}]+`,
    // Bare host:port. A port is required, so the word "localhost" in prose is
    // not turned into a link.
    `(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1?\\]):\\d{1,5}(?:/[^${NOT_IN_URL}]*)?`
  ].join('|'),
  'gi'
)

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** One run of log text; `href` is set when the run is a link. */
export interface LinkPart {
  text: string
  href: string | null
}

/**
 * Trailing punctuation almost always belongs to the sentence, not the URL.
 * A closing bracket is kept only when the URL opened one.
 */
function trimTrailing(match: string): string {
  let end = match.length
  while (end > 0) {
    const ch = match[end - 1]
    if ('.,;:!?*_"\''.includes(ch)) {
      end--
    } else if (ch === ')' && !match.slice(0, end).includes('(')) {
      end--
    } else if (ch === ']' && !match.slice(0, end).includes('[')) {
      end--
    } else {
      break
    }
  }
  return match.slice(0, end)
}

function toHref(text: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // 0.0.0.0 and :: mean "every interface"; a browser needs a reachable name.
    if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = 'localhost'
    return url.toString()
  } catch {
    return null
  }
}

/** Splits a line into alternating plain and link runs, in order. */
export function splitLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = []
  let cursor = 0

  LINK_PATTERN.lastIndex = 0
  for (let m = LINK_PATTERN.exec(text); m !== null; m = LINK_PATTERN.exec(text)) {
    const raw = trimTrailing(m[0])
    const href = raw.length > 0 ? toHref(raw) : null
    if (!href) continue

    if (m.index > cursor) parts.push({ text: text.slice(cursor, m.index), href: null })
    parts.push({ text: raw, href })
    cursor = m.index + raw.length
    // The trimmed tail must be re-examined, or a URL glued to the next one is lost.
    LINK_PATTERN.lastIndex = cursor
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), href: null })
  return parts
}

/**
 * The loopback URL a starting server is advertising, if this line carries one.
 *
 * Deliberately loopback-only: startup banners are full of documentation and
 * telemetry links, and "open the server when it is ready" must not open those.
 */
export function firstServerUrl(text: string): string | null {
  for (const part of splitLinks(text)) {
    if (!part.href) continue
    try {
      if (LOOPBACK.has(new URL(part.href).hostname)) return part.href
    } catch {
      // Unparseable at this point is impossible, but a throw here must not
      // break log rendering.
    }
  }
  return null
}
