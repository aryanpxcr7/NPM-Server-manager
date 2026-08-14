/**
 * Generates the app and tray icons.
 *
 * Written by hand with zlib rather than pulling in an image library: the artwork
 * is a gradient rounded square with a bolt glyph, which is a few dozen lines of
 * pixel maths and saves a build-time dependency. Run with `npm run icons`.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build')

// --- PNG encoding ------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- Artwork -----------------------------------------------------------------

/** Signed distance to a rounded rectangle, used for the tile and its antialiasing. */
function roundedRectSDF(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - halfW + radius
  const qy = Math.abs(py) - halfH + radius
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

/** The lightning bolt, in a -0.5..0.5 unit square. */
const BOLT = [
  [0.08, -0.42],
  [-0.24, 0.04],
  [-0.02, 0.04],
  [-0.1, 0.42],
  [0.24, -0.06],
  [0.02, -0.06]
]

function insidePolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const half = size / 2
  const radius = size * 0.22
  // Supersample so both the tile edge and the glyph come out smooth.
  const S = 3

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S - half
          const py = y + (sy + 0.5) / S - half

          if (roundedRectSDF(px, py, half - size * 0.02, half - size * 0.02, radius) > 0) continue

          // Diagonal gradient: accent blue -> violet, matching the in-app mark.
          const t = Math.min(1, Math.max(0, (px + py) / size + 0.5))
          let cr = lerp(0x4c, 0xa3, t)
          let cg = lerp(0x8d, 0x71, t)
          let cb = lerp(0xff, 0xf7, t)

          if (insidePolygon(px / size, py / size, BOLT)) {
            cr = 0xff
            cg = 0xff
            cb = 0xff
          }

          r += cr
          g += cg
          b += cb
          a += 255
        }
      }

      const n = S * S
      const i = (y * size + x) * 4
      // Un-premultiply so partially covered edge pixels keep their full colour.
      const cov = a / n / 255
      rgba[i] = cov > 0 ? Math.round(r / (n * cov)) : 0
      rgba[i + 1] = cov > 0 ? Math.round(g / (n * cov)) : 0
      rgba[i + 2] = cov > 0 ? Math.round(b / (n * cov)) : 0
      rgba[i + 3] = Math.round(a / n)
    }
  }
  return encodePng(size, size, rgba)
}

// --- ICO container -----------------------------------------------------------

/** Vista-era .ico files may embed PNGs directly, which keeps this simple. */
function encodeIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)

  let offset = 6 + pngs.length * 16
  const entries = []
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size // 0 means 256
    e[1] = size >= 256 ? 0 : size
    e[2] = 0 // palette
    e[3] = 0 // reserved
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

// --- Emit --------------------------------------------------------------------

mkdirSync(OUT, { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const rendered = sizes.map((size) => ({ size, data: render(size) }))

writeFileSync(path.join(OUT, 'icon.ico'), encodeIco(rendered))
writeFileSync(path.join(OUT, 'icon.png'), rendered.find((r) => r.size === 256).data)
writeFileSync(path.join(OUT, 'tray.png'), rendered.find((r) => r.size === 32).data)

console.log(`wrote build/icon.ico (${sizes.length} sizes), build/icon.png (256), build/tray.png (32)`)
