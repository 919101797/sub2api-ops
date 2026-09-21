import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  AccountConfig,
  AccountRuntime,
  AuditEvent,
  EventSeverity,
  JobKind,
  JobRuntime,
  PersistedState,
} from '../shared/contracts.js'

const MAX_EVENTS = 500

function nowIso(): string {
  return new Date().toISOString()
}

function initialJob(kind: JobKind): JobRuntime {
  return {
    kind,
    health: 'idle',
    running: false,
    failures: 0,
    message: '等待首次运行',
  }
}

function initialState(): PersistedState {
  return {
    version: 2,
    updatedAt: nowIso(),
    accounts: {},
    jobs: {
      reset: initialJob('reset'),
      capacity: initialJob('capacity'),
    },
    events: [],
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class StateStore {
  private state: PersistedState = initialState()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as PersistedState
      if (parsed.version !== 2) {
        throw new Error(`Unsupported state version: ${String(parsed.version)}`)
      }
      this.state = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      await this.persist(this.state)
    }
  }

  snapshot(): PersistedState {
    return clone(this.state)
  }

  async update(mutator: (draft: PersistedState) => void | Promise<void>): Promise<PersistedState> {
    let result = this.snapshot()
    this.queue = this.queue.then(async () => {
      const draft = this.snapshot()
      await mutator(draft)
      draft.updatedAt = nowIso()
      this.state = draft
      await this.persist(draft)
      result = clone(draft)
    })
    await this.queue
    return result
  }

  async ensureAccounts(accounts: AccountConfig[]): Promise<void> {
    await this.update((draft) => {
      const configured = new Set(accounts.map((account) => account.key))
      for (const key of Object.keys(draft.accounts)) {
        if (!configured.has(key)) {
          delete draft.accounts[key]
        }
      }
      for (const account of accounts) {
        const current = draft.accounts[account.key]
        draft.accounts[account.key] = {
          key: account.key,
          email: account.email,
          label: account.label,
          reset: current?.reset ?? {},
          ...(current?.accountId ? { accountId: current.accountId } : {}),
          ...(current?.resolvedAt ? { resolvedAt: current.resolvedAt } : {}),
          ...(current?.capacity ? { capacity: current.capacity } : {}),
          ...(current?.lastError ? { lastError: current.lastError } : {}),
          ...(current?.lastErrorAt ? { lastErrorAt: current.lastErrorAt } : {}),
          ...(current?.lastErrorJob ? { lastErrorJob: current.lastErrorJob } : {}),
        }
      }
    })
  }

  async addEvent(input: {
    severity: EventSeverity
    category: AuditEvent['category']
    summary: string
    accountKey?: string
    details?: Record<string, unknown>
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: randomUUID(),
      createdAt: nowIso(),
      severity: input.severity,
      category: input.category,
      summary: input.summary,
      ...(input.accountKey ? { accountKey: input.accountKey } : {}),
      ...(input.details ? { details: input.details } : {}),
    }
    await this.update((draft) => {
      draft.events.unshift(event)
      draft.events = draft.events.slice(0, MAX_EVENTS)
    })
    return event
  }

  async updateAccount(key: string, mutator: (account: AccountRuntime) => void): Promise<void> {
    await this.update((draft) => {
      const account = draft.accounts[key]
      if (!account) {
        throw new Error(`Account state not initialized: ${key}`)
      }
      mutator(account)
    })
  }

  async startJob(kind: JobKind, manual: boolean): Promise<string> {
    const startedAt = nowIso()
    await this.update((draft) => {
      draft.jobs[kind] = {
        ...draft.jobs[kind],
        kind,
        health: 'running',
        running: true,
        lastStartedAt: startedAt,
        message: manual ? '正在手动执行' : '正在按计划执行',
      }
    })
    return startedAt
  }

  async finishJob(kind: JobKind, startedAt: string, failures: number, message: string): Promise<void> {
    const completedAt = nowIso()
    const duration = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
    await this.update((draft) => {
      draft.jobs[kind] = {
        ...draft.jobs[kind],
        kind,
        health: failures > 0 ? 'degraded' : 'healthy',
        running: false,
        lastCompletedAt: completedAt,
        lastDurationMs: duration,
        failures,
        message,
      }
    })
  }

  async setNextRun(kind: JobKind, nextRunAt: string): Promise<void> {
    await this.update((draft) => {
      draft.jobs[kind].nextRunAt = nextRunAt
    })
  }

  private async persist(value: PersistedState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true })
    const tempPath = join(directory, `.${randomUUID()}.tmp`)
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, this.path)
  }
}
