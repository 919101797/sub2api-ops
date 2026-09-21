import type { CapturedPrompt, PromptAuditRepository } from './repository.js'

interface AuditLogger {
  error(values: Record<string, unknown>, message: string): void
  info(values: Record<string, unknown>, message: string): void
  warn(values: Record<string, unknown>, message: string): void
}

const MAX_QUEUE_SIZE = 1_000
const MAX_QUEUE_BYTES = 64 * 1024 * 1024
const WRITER_CONCURRENCY = 2
const CLEANUP_INTERVAL_MS = 24 * 60 * 60_000

function promptBytes(prompt: CapturedPrompt): number {
  return Buffer.byteLength(prompt.promptText, 'utf8') + prompt.media.reduce((total, item) => total + item.byteSize, 0)
}

export class PromptAuditService {
  private readonly queue: CapturedPrompt[] = []
  private queuedBytes = 0
  private activeWriters = 0
  private enrichmentTimer?: NodeJS.Timeout
  private cleanupTimer?: NodeJS.Timeout
  private stopped = false

  constructor(
    private readonly repository: PromptAuditRepository,
    private readonly logger: AuditLogger,
  ) {}

  async initialize(): Promise<void> {
    await this.repository.verifySchema()
    await this.repository.applyConfiguredRetention()
    await this.runEnrichment()
    await this.runCleanup()
  }

  start(): void {
    this.enrichmentTimer = setInterval(() => void this.runEnrichment(), 10_000)
    this.cleanupTimer = setInterval(() => void this.runCleanup(), CLEANUP_INTERVAL_MS)
    this.enrichmentTimer.unref()
    this.cleanupTimer.unref()
  }

  enqueue(prompt: CapturedPrompt): boolean {
    const bytes = promptBytes(prompt)
    if (this.stopped || this.queue.length >= MAX_QUEUE_SIZE || this.queuedBytes + bytes > MAX_QUEUE_BYTES) {
      this.logger.warn({ requestId: prompt.requestId, queueDepth: this.queue.length, queuedBytes: this.queuedBytes }, '提示词审计队列已满，本条已丢弃')
      return false
    }
    this.queue.push(prompt)
    this.queuedBytes += bytes
    this.drain()
    return true
  }

  async store(prompt: CapturedPrompt): Promise<void> {
    if (this.stopped) throw new Error('Prompt audit service is stopping')
    await this.repository.insert(prompt)
  }

  private drain(): void {
    while (this.activeWriters < WRITER_CONCURRENCY && this.queue.length > 0) {
      const prompt = this.queue.shift()!
      this.queuedBytes -= promptBytes(prompt)
      this.activeWriters += 1
      void this.repository.insert(prompt)
        .catch((error) => this.logger.error({ err: error, requestId: prompt.requestId }, '提示词审计记录写入失败'))
        .finally(() => {
          this.activeWriters -= 1
          this.drain()
        })
    }
  }

  private async runEnrichment(): Promise<void> {
    try {
      const updated = await this.repository.enrich()
      if (updated > 0) this.logger.info({ updated }, '提示词审计身份与风险结果已关联')
    } catch (error) {
      this.logger.error({ err: error }, '提示词审计关联失败')
    }
  }

  private async runCleanup(): Promise<void> {
    try {
      const deleted = await this.repository.cleanup()
      if (deleted > 0) this.logger.info({ deleted }, '已清理过期提示词审计记录')
    } catch (error) {
      this.logger.error({ err: error }, '提示词审计清理失败')
    }
  }

  async close(): Promise<void> {
    this.stopped = true
    if (this.enrichmentTimer) clearInterval(this.enrichmentTimer)
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    const deadline = Date.now() + 5_000
    while ((this.queue.length > 0 || this.activeWriters > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await this.repository.close()
  }
}
