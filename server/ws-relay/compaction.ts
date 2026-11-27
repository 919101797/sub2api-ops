import { Readable } from 'node:stream'
import parser, { type Token } from 'stream-json/parser.js'

type CompactionFrame = { windowId: string; kind: 'compact' | 'resume' }

const values = new Set<Token['name']>(['startObject', 'startArray', 'startString', 'startNumber', 'nullValue', 'trueValue', 'falseValue'])

function* chunks(payload: Buffer) {
  const chunkSize = 64 * 1024
  for (let offset = 0; offset < payload.length; offset += chunkSize) yield payload.subarray(offset, offset + chunkSize)
}

export async function codexCompactionRequest(payload: Buffer, isBinary: boolean): Promise<CompactionFrame | null> {
  if (isBinary || !payload.includes('"x-codex-window-id"') || !payload.includes('"compaction')) return null

  let depth = 0
  let section = ''
  let key = ''
  let text: string | null = null
  let type = ''
  let windowId = ''
  let hasPreviousResponse = false
  let lastItemType = ''
  let hasTrigger = false
  let hasCompaction = false

  // Read the envelope without copying message bodies or the encrypted summary into the V8 heap.
  const tokens = Readable.from(chunks(payload)).compose(parser.asStream({ packValues: false }))
  try {
    for await (const token of tokens as AsyncIterable<Token>) {
      const name = token.name
      const directField = depth === 1 || (depth === 2 && section === 'client_metadata') || (depth === 3 && section === 'input')
      if (depth === 1 && key === 'previous_response_id' && values.has(name)) hasPreviousResponse = name !== 'nullValue'
      if (depth === 2 && section === 'input' && values.has(name)) lastItemType = ''
      if (directField && (name === 'startKey' || name === 'startString')) text = ''
      if (name === 'stringChunk' && text !== null) text = text.length + token.value.length <= 256 ? text + token.value : null
      if (name === 'endKey' && directField) {
        key = text ?? ''
        text = null
      }
      if (name === 'endString' && text !== null) {
        if (depth === 1 && key === 'type') type = text
        if (depth === 2 && section === 'client_metadata' && key === 'x-codex-window-id') windowId = text
        if (depth === 3 && section === 'input' && key === 'type') {
          lastItemType = text
          hasTrigger ||= text === 'compaction_trigger'
          hasCompaction ||= text === 'compaction'
        }
        text = null
      }
      if (name === 'startObject' || name === 'startArray') {
        if (depth === 1 && ((key === 'input' && name === 'startArray') || (key === 'client_metadata' && name === 'startObject'))) section = key
        depth++
      }
      if (name === 'endObject' || name === 'endArray') {
        depth--
        if (depth === 1) section = ''
      }
    }
  } catch {
    return null
  }
  if (type !== 'response.create' || !windowId) return null
  if (lastItemType === 'compaction_trigger') return { windowId, kind: 'compact' }
  if (!hasTrigger && hasCompaction && !hasPreviousResponse) return { windowId, kind: 'resume' }
  return null
}
