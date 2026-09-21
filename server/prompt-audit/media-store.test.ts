// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PromptMediaStore } from './media-store.js'
import { extractPromptMedia } from './parser.js'

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0j8AAAAASUVORK5CYII='
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('PromptMediaStore', () => {
  it('持久化图片、统计空间并按相对路径删除', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sub2api-prompt-media-'))
    directories.push(directory)
    const store = new PromptMediaStore(directory)
    await store.initialize()
    const media = extractPromptMedia({ input: [{
      role: 'user',
      content: [{ type: 'input_image', image_url: `data:image/png;base64,${onePixelPng}` }],
    }] })
    const stored = await store.persist(42, new Date('2026-08-18T00:00:00Z'), media)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.relativePath).toMatch(/^2026\/08\/18\/42-1-/)
    expect(await store.readablePath(stored[0]!.relativePath)).not.toBeNull()
    expect(await store.usage()).toEqual({ files: 1, bytes: media[0]!.byteSize })
    await store.remove([stored[0]!.relativePath])
    expect(await store.usage()).toEqual({ files: 0, bytes: 0 })
  })
})
