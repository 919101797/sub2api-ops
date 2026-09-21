import { readdir, mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

import type { ParsedPromptMedia } from './parser.js'

export interface StoredPromptMedia {
  mimeType: ParsedPromptMedia['mimeType']
  byteSize: number
  sha256: string
  relativePath: string
  fileName: string
}

export interface PromptMediaDiskUsage {
  files: number
  bytes: number
}

export class PromptMediaStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
  }

  async persist(recordId: number, capturedAt: Date, media: ParsedPromptMedia[]): Promise<StoredPromptMedia[]> {
    if (media.length === 0) return []
    const datePath = [
      String(capturedAt.getUTCFullYear()),
      String(capturedAt.getUTCMonth() + 1).padStart(2, '0'),
      String(capturedAt.getUTCDate()).padStart(2, '0'),
    ].join('/')
    const directory = this.absolute(datePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const stored: StoredPromptMedia[] = []
    try {
      for (const [index, item] of media.entries()) {
        const fileName = `${recordId}-${index + 1}-${item.sha256.slice(0, 16)}.${item.extension}`
        const relativePath = `${datePath}/${fileName}`
        await writeFile(this.absolute(relativePath), item.data, { flag: 'wx', mode: 0o600 })
        stored.push({
          mimeType: item.mimeType,
          byteSize: item.byteSize,
          sha256: item.sha256,
          relativePath,
          fileName,
        })
      }
      return stored
    } catch (error) {
      await this.remove(stored.map((item) => item.relativePath))
      throw error
    }
  }

  async remove(relativePaths: string[]): Promise<void> {
    await Promise.all(relativePaths.map(async (relativePath) => {
      try {
        await unlink(this.absolute(relativePath))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }))
  }

  async readablePath(relativePath: string): Promise<string | null> {
    const path = this.absolute(relativePath)
    try {
      const details = await stat(path)
      return details.isFile() ? path : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async usage(): Promise<PromptMediaDiskUsage> {
    const walk = async (directory: string): Promise<PromptMediaDiskUsage> => {
      let files = 0
      let bytes = 0
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          const nested = await walk(path)
          files += nested.files
          bytes += nested.bytes
        } else if (entry.isFile()) {
          const details = await stat(path)
          files += 1
          bytes += details.size
        }
      }
      return { files, bytes }
    }
    return walk(this.root)
  }

  fileName(relativePath: string): string {
    return basename(relativePath)
  }

  private absolute(relativePath: string): string {
    const path = resolve(this.root, relativePath)
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) throw new Error('Invalid prompt media path')
    return path
  }
}
