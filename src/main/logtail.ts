import { closeSync, createReadStream, existsSync, openSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

/**
 * Follows an append-only log file and emits complete lines.
 *
 * Dev servers write straight to disk rather than through a pipe (see
 * docs/DECISIONS.md §10), so the app reads their output by tailing the file.
 * Polling is used instead of fs.watch because fs.watch on Windows does not fire
 * reliably for appends to an already-open file.
 */
export class LogTailer {
  private offset = 0
  private timer: NodeJS.Timeout | null = null
  private reading = false
  private remainder = ''
  private decoder = new StringDecoder('utf8')

  constructor(
    private readonly file: string,
    private readonly onLines: (lines: string[]) => void,
    private readonly intervalMs = 250
  ) {}

  /** Begins following. Pass a starting byte offset to skip already-seen output. */
  start(fromOffset = 0): void {
    this.offset = fromOffset
    if (this.timer) return
    this.timer = setInterval(() => void this.poll(), this.intervalMs)
    void this.poll()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Flush a trailing line that never got its newline.
    if (this.remainder.trim()) {
      this.onLines([this.remainder])
      this.remainder = ''
    }
  }

  get bytesRead(): number {
    return this.offset
  }

  private async poll(): Promise<void> {
    if (this.reading) return
    this.reading = true
    try {
      if (!existsSync(this.file)) return
      const { size } = statSync(this.file)

      // A truncated or replaced file means the run restarted; resync from the top.
      if (size < this.offset) {
        this.offset = 0
        this.remainder = ''
      }
      if (size === this.offset) return

      const chunk = await this.read(this.offset, size)
      this.offset = size

      // Decoder carries incomplete multi-byte sequences across reads.
      const text = this.remainder + this.decoder.write(chunk)
      const parts = text.split(/\r?\n/)
      // The last element is whatever follows the final newline.
      this.remainder = parts.pop() ?? ''
      if (parts.length > 0) this.onLines(parts)
    } catch {
      // A transient read error should not kill the tailer; the next poll retries.
    } finally {
      this.reading = false
    }
  }

  private read(start: number, end: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      createReadStream(this.file, { start, end: end - 1 })
        .on('data', (c) => chunks.push(c as Buffer))
        .on('end', () => resolve(Buffer.concat(chunks)))
        .on('error', reject)
    })
  }
}

/** Opens a log file for a child process to append to, returning its fd. */
export function openLogFd(file: string): number {
  return openSync(file, 'a')
}

export function closeLogFd(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    /* already closed */
  }
}
