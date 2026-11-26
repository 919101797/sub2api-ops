import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import parser, { type Token } from 'stream-json/parser.js'
import stringer from 'stream-json/stringer.js'

const parserOptions = { packValues: false, ignoreBOM: true }
const contextFields = new Set(['type', 'namespace', 'name', 'call_id', 'output'])
const selectedPage = /^codex_apps_selected_page_part_[1-9]\d*_of_[1-9]\d*$/
const emptyPagePrefix = 'Companion Page snapshot part 1 of 1:\n'
const opening = new Set(['startArray', 'startObject'])
const closing = new Set(['endArray', 'endObject'])

// Track only the root input array and the direct fields of its object items.
async function* inputTokens(source: AsyncIterable<Token>) {
  let depth = 0
  let key: string | undefined
  let readingKey = false
  let inInput = false
  let index = -1
  let inItem = false
  for await (const token of source) {
    const { name } = token
    if (name === 'startKey' && (depth === 1 || (depth === 3 && inItem))) {
      readingKey = true
      key = ''
    }
    if (readingKey && name === 'stringChunk' && key !== undefined) {
      key = key.length + token.value.length <= 64 ? key + token.value : undefined
    }
    const rootInputKey = readingKey && name === 'endKey' && depth === 1 && key === 'input'
    if (name === 'endKey') readingKey = false
    if (name === 'startArray' && depth === 1 && key === 'input') inInput = true
    if (name === 'endArray' && depth === 2 && inInput) inInput = false
    const itemStart = inInput && depth === 2 && name === 'startObject'
    const itemEnd = inItem && depth === 3 && name === 'endObject'
    if (itemStart) {
      index++
      inItem = true
    }
    const field = inItem && depth === 3 && !readingKey && key && contextFields.has(key) ? key : undefined
    yield { token, itemStart, itemEnd, index: inItem ? index : undefined, field, rootInputKey }
    if (itemEnd) inItem = false
    if (opening.has(name)) depth++
    if (closing.has(name)) depth--
  }
}

function emptySnapshot(name: string, output: string) {
  if (output === '') return true
  const isPage = name === 'codex_apps_open_page'
  const isSelection = name === 'codex_apps_selected_page_part_1_of_1' && output.startsWith(emptyPagePrefix)
  if (!isPage && !isSelection) return false
  try {
    const value = JSON.parse(isPage ? output : output.slice(emptyPagePrefix.length))
    return value?.page_id === null && (isPage
      ? Object.keys(value).length === 1
      : value.document_view === null && Object.keys(value).length === 2)
  } catch {
    return false
  }
}

type ContextEdit = { index: number, name: string | null }

async function* findDesktopContext(tokens: AsyncIterable<Token>, onInputKey: () => void): AsyncGenerator<ContextEdit> {
  const fields = new Map<string, string | null | true | undefined>()
  let duplicateField = false
  for await (const { token, itemStart, itemEnd, index, field, rootInputKey } of inputTokens(tokens)) {
    if (rootInputKey) onInputKey()
    if (itemStart) {
      fields.clear()
      duplicateField = false
    }
    if (field) {
      const value = fields.get(field)
      switch (token.name) {
        case 'endKey':
          duplicateField ||= fields.has(field)
          fields.set(field, undefined)
          break
        case 'nullValue': fields.set(field, null); break
        case 'startString': fields.set(field, ''); break
        case 'stringChunk':
          // Only a short prefix is needed to identify the two empty page snapshots.
          if (typeof value === 'string') fields.set(field, value.length + token.value.length <= 512 ? value + token.value : true)
          break
      }
    }
    if (!itemEnd || index === undefined || duplicateField
      || fields.get('type') !== 'function_call_output' || fields.get('namespace') !== 'agent') continue
    const name = fields.get('name')
    const callId = fields.get('call_id')
    const output = fields.get('output')
    if (typeof name !== 'string' || !(name === 'browser_tabs' || name === 'codex_apps_open_page' || selectedPage.test(name))) continue
    if (fields.has('call_id') && callId !== null && callId !== '') continue
    if (output === true || typeof output === 'string') {
      yield { index, name: typeof output === 'string' && emptySnapshot(name, output) ? null : name }
    }
  }
}

function* keyTokens(value: string): Generator<Token> {
  yield { name: 'startKey' }
  yield { name: 'stringChunk', value }
  yield { name: 'endKey' }
}

function* stringTokens(value: string): Generator<Token> {
  yield { name: 'startString' }
  yield { name: 'stringChunk', value }
  yield { name: 'endString' }
}

async function* replaceDesktopContext(tokens: AsyncIterable<Token>, first: ContextEdit,
  edits: AsyncGenerator<ContextEdit>): AsyncGenerator<Token> {
  let edit: ContextEdit | undefined = first
  for await (const { token, index, field, itemEnd } of inputTokens(tokens)) {
    const name = edit && edit.index === index ? edit.name : undefined
    if (name === undefined) {
      yield token
    } else if (name !== null && field === 'output') {
      if (token.name === 'startString') {
        yield { name: 'startObject' }
        yield* keyTokens('type')
        yield* stringTokens('message')
        yield* keyTokens('role')
        yield* stringTokens('user')
        yield* keyTokens('content')
        yield token
        yield { name: 'stringChunk', value: `[Untrusted reference: ${name}]\n` }
      } else if (token.name === 'stringChunk') {
        yield token
      } else if (token.name === 'endString') {
        yield token
        yield { name: 'endObject' }
      }
    }
    if (name !== undefined && itemEnd) {
      const next = await edits.next()
      edit = next.done ? undefined : next.value
    }
  }
}

export async function normalizeCodexContext(sourcePath: string, targetPath: string, signal: AbortSignal) {
  // Read ahead only to the next edit so even a long list of snapshots stays bounded.
  const scanner = createReadStream(sourcePath).compose(parser.asStream(parserOptions), { signal })
  let inputKeys = 0
  const edits = findDesktopContext(scanner, () => { inputKeys++ })
  try {
    const first = await edits.next()
    if (first.done) return
    await pipeline(createReadStream(sourcePath), parser.asStream(parserOptions),
      tokens => replaceDesktopContext(tokens, first.value, edits), stringer.asStream(),
      createWriteStream(targetPath, { mode: 0o600, flags: 'wx' }), { signal })
    if (inputKeys === 1) return (await stat(targetPath)).size
  } catch (error) {
    // Leave malformed or excessively nested JSON to the upstream's usual validation.
    if (error instanceof Error && /^(?:Parser |parser: JSON nesting depth)/.test(error.message)) return
    throw error
  } finally {
    await edits.return(undefined)
  }
}
