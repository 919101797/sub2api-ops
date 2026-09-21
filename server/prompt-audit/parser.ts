import { createHash } from 'node:crypto'

import type { PromptCaptureKind } from '../../shared/contracts.js'

export const MAX_PROMPT_CHARACTERS = 1_000_000
export const MAX_PROMPT_MEDIA_COUNT = 4
export const MAX_PROMPT_MEDIA_BYTES = 8 * 1024 * 1024
export const MAX_PROMPT_MEDIA_TOTAL_BYTES = 12 * 1024 * 1024

export type PromptImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ParsedPromptMedia {
  mimeType: PromptImageMimeType
  extension: 'png' | 'jpg' | 'webp' | 'gif'
  byteSize: number
  sha256: string
  data: Buffer
}

export interface ParsedPrompt {
  model: string
  promptText: string
  promptHash: string
  charCount: number
  redacted: boolean
  truncated: boolean
  reviewRequired: boolean
  captureKind: PromptCaptureKind
  media: ParsedPromptMedia[]
}

export interface PromptSessionIdentity {
  value: string
  source: 'body_prompt_cache'
}

interface ExtractedPrompt {
  model: string
  prompt: string
  reviewRequired: boolean
  captureKind: PromptCaptureKind
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function extractPromptSessionIdentity(body: unknown): PromptSessionIdentity | null {
  if (!isRecord(body)) return null
  const promptCacheKey = typeof body.prompt_cache_key === 'string' ? body.prompt_cache_key.trim() : ''
  if (!promptCacheKey || promptCacheKey.length > 512) return null
  return { value: promptCacheKey, source: 'body_prompt_cache' }
}

function addText(parts: string[], value: unknown): void {
  if (typeof value !== 'string') return
  const text = value
    .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]{128,}/gi, '[图片或二进制内容已省略]')
    .replace(/\b[A-Za-z0-9+/]{512,}={0,2}\b/g, (candidate) => /[+/=]/.test(candidate) ? '[长 Base64 内容已省略]' : candidate)
    .trim()
  if (!text || text.includes('<system-reminder>')) return
  parts.push(text)
}

function collectMessageText(value: unknown, parts: string[]): void {
  if (typeof value === 'string') {
    addText(parts, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMessageText(item, parts)
    return
  }
  if (!isRecord(value)) return

  const type = typeof value.type === 'string' ? value.type.trim().toLowerCase() : ''
  if (type.includes('reasoning') || ['input_image', 'output_image', 'image', 'audio', 'file'].includes(type)) return
  if (!['', 'text', 'input_text', 'output_text', 'message', 'refusal'].includes(type)) return
  addText(parts, value.text)
  addText(parts, value.refusal)
  if ('content' in value) collectMessageText(value.content, parts)
}

function serialized(value: unknown): string {
  if (typeof value === 'string') {
    const parts: string[] = []
    addText(parts, value)
    return parts.join('\n')
  }
  try {
    const parts: string[] = []
    addText(parts, JSON.stringify(value, null, 2))
    return parts.join('\n')
  } catch {
    return ''
  }
}

function normalizedField(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function latestInput(body: unknown): unknown {
  if (!isRecord(body)) return undefined
  return Array.isArray(body.input) ? body.input.at(-1) : body.input
}

function imageFormat(data: Buffer): { mimeType: PromptImageMimeType; extension: ParsedPromptMedia['extension'] } | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' }
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' }
  }
  const header = data.subarray(0, 12).toString('ascii')
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return { mimeType: 'image/gif', extension: 'gif' }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' }
  return null
}

function decodeImageDataUri(value: unknown): ParsedPromptMedia | null {
  if (typeof value !== 'string') return null
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(value.trim())
  if (!match?.[1] || !match[2]) return null
  const encoded = match[2].replace(/\s/g, '')
  const estimatedBytes = Math.floor(encoded.length * 3 / 4)
  if (estimatedBytes <= 0 || estimatedBytes > MAX_PROMPT_MEDIA_BYTES) return null
  const data = Buffer.from(encoded, 'base64')
  if (data.length <= 0 || data.length > MAX_PROMPT_MEDIA_BYTES) return null
  const detected = imageFormat(data)
  const declared = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
  if (!detected || detected.mimeType !== declared) return null
  return {
    ...detected,
    byteSize: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    data,
  }
}

function imageDataUri(value: Record<string, unknown>): unknown {
  const type = normalizedField(value.type)
  if (!type.includes('image')) return undefined
  if (typeof value.image_url === 'string') return value.image_url
  if (isRecord(value.image_url) && typeof value.image_url.url === 'string') return value.image_url.url
  if (typeof value.url === 'string') return value.url
  if (typeof value.data === 'string') return value.data
  return undefined
}

export function extractPromptMedia(body: unknown): ParsedPromptMedia[] {
  const root = latestInput(body)
  const media: ParsedPromptMedia[] = []
  const hashes = new Set<string>()
  let totalBytes = 0

  const visit = (value: unknown): void => {
    if (media.length >= MAX_PROMPT_MEDIA_COUNT) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isRecord(value)) return
    const candidate = decodeImageDataUri(imageDataUri(value))
    if (candidate && !hashes.has(candidate.sha256) && totalBytes + candidate.byteSize <= MAX_PROMPT_MEDIA_TOTAL_BYTES) {
      media.push(candidate)
      hashes.add(candidate.sha256)
      totalBytes += candidate.byteSize
    }
    if ('content' in value) visit(value.content)
  }

  visit(root)
  return media
}

function classifiedItem(value: unknown): Omit<ExtractedPrompt, 'model'> | null {
  if (!isRecord(value)) return null
  const role = normalizedField(value.role)
  const type = normalizedField(value.type)

  if (type === 'function_call') {
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '未命名工具'
    const argumentsText = serialized(value.arguments)
    return {
      prompt: argumentsText ? `工具：${name}\n参数：\n${argumentsText}` : `工具：${name}\n参数：空`,
      reviewRequired: false,
      captureKind: 'function_call',
    }
  }

  if (type === 'function_call_output') {
    const output = serialized(value.output)
    return {
      prompt: output ? `工具结果：\n${output}` : '工具结果：空',
      reviewRequired: false,
      captureKind: 'function_call_output',
    }
  }

  if (role === 'tool' || type.includes('tool') || type.startsWith('mcp_') || type.endsWith('_call') || type.endsWith('_call_output')) {
    const content = 'output' in value
      ? serialized(value.output)
      : 'arguments' in value
        ? serialized(value.arguments)
        : serialized(value.content)
    const descriptor = type || role || 'tool'
    return {
      prompt: content ? `工具上下文（${descriptor}）：\n${content}` : `工具上下文（${descriptor}）：无文本内容`,
      reviewRequired: false,
      captureKind: 'tool',
    }
  }

  const parts: string[] = []
  collectMessageText(value.content, parts)
  if (['input_text', 'output_text', 'text', 'refusal'].includes(type) || typeof value.text === 'string') {
    collectMessageText(value, parts)
  }
  const prompt = parts.join('\n')

  if (role === 'user' || (!role && type === 'input_text')) {
    return prompt ? { prompt, reviewRequired: true, captureKind: 'user' } : null
  }
  if (role === 'assistant') {
    return {
      prompt: prompt || '助手续跑：无可记录文本内容',
      reviewRequired: false,
      captureKind: 'assistant',
    }
  }
  if (role === 'developer' || role === 'system') {
    return {
      prompt: prompt || `${role === 'developer' ? '开发者' : '系统'}上下文：无可记录文本内容`,
      reviewRequired: false,
      captureKind: 'developer',
    }
  }
  if (prompt) return { prompt, reviewRequired: false, captureKind: 'other' }
  if (type || role) {
    return {
      prompt: `续跑上下文（${type || role}）：无可记录文本内容`,
      reviewRequired: false,
      captureKind: 'other',
    }
  }
  return null
}

export function extractLatestPrompt(body: unknown): ExtractedPrompt | null {
  if (!isRecord(body)) return null
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (typeof body.input === 'string') {
    const parts: string[] = []
    addText(parts, body.input)
    return parts.length > 0 ? { model, prompt: parts.join('\n'), reviewRequired: true, captureKind: 'user' } : null
  }
  const candidate = latestInput(body)
  const classified = classifiedItem(candidate)
  return classified ? { model, ...classified } : null
}

const REDACTION_RULES: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [REDACTED]'],
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  [/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret)\s*[:=]\s*["']?)[^\s,"'}]{8,}/gi, '$1[REDACTED]'],
  [/((?:password|passwd|pwd)\s*[:=]\s*["']?)[^\s,"'}]{4,}/gi, '$1[REDACTED]'],
]

export function redactPrompt(prompt: string): { text: string; redacted: boolean } {
  let text = prompt
  for (const [pattern, replacement] of REDACTION_RULES) text = text.replace(pattern, replacement)
  return { text, redacted: text !== prompt }
}

export function parsePrompt(body: unknown): ParsedPrompt | null {
  const extracted = extractLatestPrompt(body)
  const media = extractPromptMedia(body)
  if (!extracted && media.length === 0) return null
  const candidate = latestInput(body)
  const role = isRecord(candidate) ? normalizedField(candidate.role) : ''
  const type = isRecord(candidate) ? normalizedField(candidate.type) : ''
  const mediaOnlyUser = role === 'user' || type === 'input_image' || type === 'image_url'
  const mediaLabel = media.length > 0
    ? `附件图片：${media.length} 张（${[...new Set(media.map((item) => item.mimeType))].join('、')}）`
    : ''
  const combinedPrompt = [extracted?.prompt ?? '', mediaLabel].filter(Boolean).join('\n')
  const originalCharCount = combinedPrompt.length
  const redaction = redactPrompt(combinedPrompt)
  const truncated = redaction.text.length > MAX_PROMPT_CHARACTERS
  const promptText = truncated ? redaction.text.slice(0, MAX_PROMPT_CHARACTERS) : redaction.text
  return {
    model: extracted?.model || (isRecord(body) && typeof body.model === 'string' ? body.model.trim() : '') || '未知模型',
    promptText,
    promptHash: createHash('sha256').update(promptText).digest('hex'),
    charCount: originalCharCount,
    redacted: redaction.redacted,
    truncated,
    reviewRequired: extracted?.reviewRequired ?? mediaOnlyUser,
    captureKind: extracted?.captureKind ?? (mediaOnlyUser ? 'user' : 'other'),
    media,
  }
}

export function parseWebSocketPrompt(body: unknown): ParsedPrompt | null {
  if (!isRecord(body)) return null
  const type = normalizedField(body.type)
  if (!['response.create', 'response.append', 'response.inject'].includes(type)) return null

  if (isRecord(body.response)) {
    return parsePrompt({
      ...body.response,
      model: typeof body.response.model === 'string' ? body.response.model : body.model,
    })
  }
  return parsePrompt(body)
}
