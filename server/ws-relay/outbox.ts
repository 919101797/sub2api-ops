import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PROMPT_WS_CAPTURE_CONTENT_TYPE } from '../prompt-audit/routes.js'

export interface WsAuditEnvelope {
  id: string
  connectionId: string
  sequence: number
  capturedAt: string
  endpoint: string
  payload: string
}

export interface WsAuditLogger {
  error(values: Record<string, unknown>, message: string): void
  info(values: Record<string, unknown>, message: string): void
  warn(values: Record<string, unknown>, message: string): void
}

function envelopeFileName(id: string): string {
  return `${createHash('sha256').update(id).digest('hex')}.json`
}

function validateEnvelope(value: unknown): WsAuditEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid WS audit envelope')
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.id)) throw new Error('Invalid WS audit id')
  if (typeof candidate.connectionId !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(candidate.connectionId)) throw new Error('Invalid WS connection id')
  if (!Number.isSafeInteger(candidate.sequence) || Number(candidate.sequence) < 1) throw new Error('Invalid WS message sequence')
  if (typeof candidate.capturedAt !== 'string' || !Number.isFinite(Date.parse(candidate.capturedAt))) throw new Error('Invalid WS capture time')
  if (typeof candidate.endpoint !== 'string' || candidate.endpoint.length < 1 || candidate.endpoint.length > 128) throw new Error('Invalid WS endpoint')
  if (typeof candidate.payload !== 'string') throw new Error('Invalid WS payload')
  return candidate as unknown as WsAuditEnvelope
}

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
    const names = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    const sizes = await Promise.all(names.map((name) => stat(join(this.directory, name)).then((value) => value.size)))
    this.bytes = sizes.reduce((total, size) => total + size, 0)
  }

  async persist(envelope: WsAuditEnvelope): Promise<void> {
    return this.serialized(async () => {
      validateEnvelope(envelope)
      const content = `${JSON.stringify(envelope)}\n`
      const contentBytes = Buffer.byteLength(content)
      if (this.bytes + contentBytes > this.maximumBytes) throw new Error('WS audit outbox storage limit exceeded')
      const destination = join(this.directory, envelopeFileName(envelope.id))
      const temporary = join(this.directory, `.${envelopeFileName(envelope.id)}.${randomUUID()}.tmp`)
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', flush: true, mode: 0o600 })
      try {
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

  async entries(): Promise<WsAuditEnvelope[]> {
    const names = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    const entries = await Promise.all(names.map(async (name) => {
      const value = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as unknown
      return validateEnvelope(value)
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
    return (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).length
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

  private async deliver(envelope: WsAuditEnvelope): Promise<boolean> {
    try {
      const response = await fetch(this.captureUrl, {
        method: 'POST',
        headers: {
          'content-type': PROMPT_WS_CAPTURE_CONTENT_TYPE,
          'x-ops-capture-secret': this.captureSecret,
          'x-request-id': envelope.id,
          'x-ws-connection-id': envelope.connectionId,
          'x-ws-message-sequence': String(envelope.sequence),
          'x-captured-at': envelope.capturedAt,
          'x-original-uri': envelope.endpoint,
        },
        body: envelope.payload,
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) return true
      this.logger.warn({ requestId: envelope.id, statusCode: response.status }, 'WS 审计采集端点暂不可用')
      return false
    } catch (error) {
      this.logger.warn({ err: error, requestId: envelope.id }, 'WS 审计消息将在本地重试')
      return false
    }
  }

  async close(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    await this.draining
  }
}
