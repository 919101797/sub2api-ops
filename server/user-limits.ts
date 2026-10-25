import { Pool, type PoolConfig } from 'pg'

export interface UserLimitState {
  id: number
  status: string
  concurrency: number
  rpm_limit: number
}

export class UserLimitsRepository {
  private readonly pool: Pool

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      ...config,
      max: 1,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      statement_timeout: 3_000,
      application_name: 'sub2api-ops-user-limits',
      options: '-c default_transaction_read_only=on',
    })
  }

  async users(): Promise<UserLimitState[]> {
    const result = await this.pool.query<Omit<UserLimitState, 'id'> & { id: string | number }>(`
      SELECT id, status, concurrency, rpm_limit
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY id
    `)
    return result.rows.map((row) => ({ ...row, id: Number(row.id) }))
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
