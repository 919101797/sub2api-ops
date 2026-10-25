import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createReadStream } from 'node:fs'

import { PROMPT_WS_CAPTURE_CONTENT_TYPE } from '../prompt-audit/routes.js'

export interface WsAuditEnvelope {
  id: string
  connectionId: string
  sequence: number
  capturedAt: string
  endpoint: string
  payload: string | Buffer
}

export interface WsAuditLogger {
  error(values: Record<string, unknown>, message: string): void
  info(values: Record<string, unknown>, message: string): void
  warn(values: Record<string, unknown>, message: string): void
}

function envelopeFileName(id: string): string {
  return `${createHash('sha256').update(id).digest('hex')}.capture`
}

function validateEnvelope(value: unknown): WsAuditEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid WS audit envelope')
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.id)) throw new Error('Invalid WS audit id')
  if (typeof candidate.connectionId !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(candidate.connectionId)) throw new Error('Invalid WS connection id')
  if (!Number.isSafeInteger(candidate.sequence) || Number(candidate.sequence) < 1) throw new Error('Invalid WS message sequence')
  if (typeof candidate.capturedAt !== 'string' || !Number.isFinite(Date.parse(candidate.capturedAt))) throw new Error('Invalid WS capture time')
  if (typeof candidate.endpoint !== 'string' || candidate.endpoint.length < 1 || candidate.endpoint.length > 128) throw new Error('Invalid WS endpoint')
  if (typeof candidate.payload !== 'string' && !Buffer.isBuffer(candidate.payload)) throw new Error('Invalid WS payload')
  return candidate as unknown as WsAuditEnvelope
}

interface StoredEnvelope extends Omit<WsAuditEnvelope, 'payload'> { payloadBytes: number; path: string; offset: number }

export class WsAuditOutbox {
  private bytes = 0
  private operation = Promise.resolve()

  constructor(
    private readonly directory: string,
    private readonly maximumBytes = 512 * 1024 * 1024,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const all = await readdir(this.directory)
    if (all.some(name => /^[a-f0-9]{64}\.json$/.test(name))) throw new Error('发件箱包含旧格式消息，请先用旧版本完成投递')
    const names = all.filter((name) => /^[a-f0-9]{64}\.capture$/.test(name))
    const sizes = await Promise.all(names.map((name) => stat(join(this.directory, name)).then((value) => value.size)))
    this.bytes = sizes.reduce((total, size) => total + size, 0)
  }

  async persist(envelope: WsAuditEnvelope): Promise<void> {
    return this.serialized(async () => {
      validateEnvelope(envelope)
      const { payload, ...metadata } = envelope
      const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
      const header = Buffer.from(JSON.stringify({ ...metadata, payloadBytes: raw.length }))
      const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length)
      const contentBytes = 4 + header.length + raw.length
      if (this.bytes + contentBytes > this.maximumBytes) throw new Error('WS audit outbox storage limit exceeded')
      const destination = join(this.directory, envelopeFileName(envelope.id))
      const temporary = join(this.directory, `.${envelopeFileName(envelope.id)}.${randomUUID()}.tmp`)
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(prefix); await file.writeFile(header); await file.writeFile(raw); await file.sync() }
        finally { await file.close() }
        await rename(temporary, destination)
        const directory = await open(this.directory, 'r')
        await directory.sync().finally(() => directory.close())
        this.bytes += contentBytes
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async entries(): Promise<StoredEnvelope[]> {
    const names = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.capture$/.test(name))
    const entries = await Promise.all(names.map(async (name): Promise<StoredEnvelope> => {
      const path = join(this.directory, name)
      const file = await open(path, 'r')
      try {
        const prefix = Buffer.alloc(4)
        if ((await file.read(prefix, 0, 4, 0)).bytesRead !== 4) throw new Error('Invalid WS capture header')
        const length = prefix.readUInt32BE()
        if (length > 4096 || length < 1) throw new Error('Invalid WS capture header length')
        const header = Buffer.alloc(length)
        if ((await file.read(header, 0, length, 4)).bytesRead !== length) throw new Error('Incomplete WS capture header')
        const metadata = JSON.parse(header.toString()) as Omit<StoredEnvelope, 'path' | 'offset'>
        validateEnvelope({ ...metadata, payload: '' })
        if (!Number.isSafeInteger(metadata.payloadBytes) || metadata.payloadBytes < 0 || (await file.stat()).size !== 4 + length + metadata.payloadBytes) throw new Error('Invalid WS capture length')
        return { ...metadata, path, offset: 4 + length }
      } finally { await file.close() }
    }))
    return entries.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.sequence - right.sequence)
  }

  async remove(id: string): Promise<void> {
    return this.serialized(async () => {
      const path = join(this.directory, envelopeFileName(id))
      const size = await stat(path).then((value) => value.size).catch(() => 0)
      await rm(path, { force: true })
      this.bytes = Math.max(0, this.bytes - size)
    })
  }

  async pendingCount(): Promise<number> {
    return (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.capture$/.test(name)).length
  }

  async usage(): Promise<{ messages: number; bytes: number; maximumBytes: number }> {
    return { messages: await this.pendingCount(), bytes: this.bytes, maximumBytes: this.maximumBytes }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}

export class WsAuditDelivery {
  private timer: NodeJS.Timeout | undefined
  private draining: Promise<void> | undefined
  private stopped = false
  private wakeRequested = false
  private retryDelayMs: number

  constructor(
    private readonly outbox: WsAuditOutbox,
    private readonly captureUrl: string,
    private readonly captureSecret: string,
    private readonly logger: WsAuditLogger,
    private readonly minimumRetryDelayMs = 500,
    private readonly maximumRetryDelayMs = 30_000,
  ) {
    this.retryDelayMs = minimumRetryDelayMs
  }

  start(): void {
    this.wake()
  }

  wake(): void {
    if (this.stopped) return
    if (this.draining) {
      this.wakeRequested = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.draining = this.drain().finally(() => {
        this.draining = undefined
        if (this.wakeRequested) {
          this.wakeRequested = false
          this.wake()
        }
      })
    }, 0)
    this.timer.unref()
  }

  private scheduleRetry(): void {
    if (this.stopped || this.timer) return
    const delay = this.retryDelayMs
    this.retryDelayMs = Math.min(this.maximumRetryDelayMs, this.retryDelayMs * 2)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.wake()
    }, delay)
    this.timer.unref()
  }

  private async drain(): Promise<void> {
    try {
      for (const envelope of await this.outbox.entries()) {
        if (this.stopped) return
        if (!await this.deliver(envelope)) {
          this.scheduleRetry()
          return
        }
        await this.outbox.remove(envelope.id)
        this.retryDelayMs = this.minimumRetryDelayMs
      }
    } catch (error) {
      this.logger.error({ err: error }, 'WS 审计 outbox 处理失败')
      this.scheduleRetry()
    }
  }

  private async deliver(envelope: StoredEnvelope): Promise<boolean> {
    const stream = createReadStream(envelope.path, { start: envelope.offset })
    try {
      const response = await fetch(this.captureUrl, {
        method: 'POST',
        headers: {
          'content-type': PROMPT_WS_CAPTURE_CONTENT_TYPE,
          'content-length': String(envelope.payloadBytes),
          'x-ops-capture-secret': this.captureSecret,
          'x-request-id': envelope.id,
          'x-ws-connection-id': envelope.connectionId,
          'x-ws-message-sequence': String(envelope.sequence),
          'x-captured-at': envelope.capturedAt,
          'x-original-uri': envelope.endpoint,
        },
        body: stream as unknown as NonNullable<Parameters<typeof fetch>[1]>['body'],
        duplex: 'half',
        signal: AbortSignal.timeout(5_000),
      } as RequestInit & { duplex: 'half' })
      await response.body?.cancel()
      if (response.ok) return true
      this.logger.warn({ requestId: envelope.id, statusCode: response.status }, 'WS 审计采集端点暂不可用')
      return false
    } catch (error) {
      this.logger.warn({ err: error, requestId: envelope.id }, 'WS 审计消息将在本地重试')
      return false
    } finally { stream.destroy() }
  }

  async close(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    await this.draining
  }
}
