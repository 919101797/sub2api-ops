import { Pool, type PoolClient } from 'pg'

import type {
  PromptAuditListResponse,
  PromptAuditRange,
  PromptAuditRecordDetail,
  PromptAuditRecordSummary,
  PromptAuditPurgeResponse,
  PromptAuditSessionResponse,
  PromptAuditStorageResponse,
  PromptAuditUserStatus,
  PromptCaptureKind,
  PromptRiskStatus,
  PromptSessionSource,
} from '../../shared/contracts.js'
import type { ParsedPrompt } from './parser.js'
import { PromptMediaStore, type StoredPromptMedia } from './media-store.js'

export interface PromptAuditDatabaseConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  mediaPath: string
  normalRetentionDays: number
  riskRetentionDays: number
}

export interface CapturedPrompt extends ParsedPrompt {
  requestId: string
  endpoint: string
  capturedAt: Date
  apiKey: string
  sessionFingerprint: string
  sessionSource: PromptSessionSource
}

export interface PromptAuditListInput {
  range: PromptAuditRange
  statuses: PromptRiskStatus[]
  userId: number | null
  groupId: number | null
  search: string
  startAt: Date | null
  endAt: Date | null
  page: number
  pageSize: number
}

interface PromptRow {
  id: string
  prompt_record_id: string | number | null
  request_id: string
  user_id: string | number | null
  user_email: string
  api_key_id: string | number | null
  api_key_name: string
  group_id: string | number | null
  group_name: string
  model: string
  preview: string
  prompt_text?: string
  prompt_hash: string
  char_count: string | number
  redacted: boolean
  truncated: boolean
  risk_status: PromptRiskStatus
  risk_category: string
  risk_score: string | number | null
  moderation_action: string
  matched_keyword: string
  auto_banned: boolean
  full_content_available: boolean
  review_required: boolean
  capture_kind: PromptCaptureKind
  session_fingerprint: string
  session_source: PromptSessionSource
  media_count: string | number
  occurrence_count: string | number
  user_status: PromptAuditUserStatus | null
  captured_at: string | Date
  expires_at: string | Date
  total_count?: string | number
  hydrated_preview?: string | null
  hydrated_media_count?: string | number | null
  hydrated_user_status?: PromptAuditUserStatus | null
}

interface PromptMediaRow {
  id: string | number
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  byte_size: string | number
  sha256: string
  relative_path: string
}

interface DeletedMediaRow {
  relative_path: string
  byte_size: string | number
}

export interface PromptAuditMediaFile {
  path: string
  mimeType: PromptMediaRow['mime_type']
  byteSize: number
  fileName: string
}

interface TotalsRow {
  records: string | number
  reviewed: string | number
  not_required: string | number
  pending: string | number
  clear: string | number
  flagged: string | number
  error: string | number
  users: string | number
}

interface AggregateRow extends TotalsRow {
  bucket: string | Date | null
  aggregate_level: string | number
  pending: string | number
  clear: string | number
  flagged: string | number
  error: string | number
  not_required: string | number
}

const RANGE_INTERVAL: Record<PromptAuditRange, string> = {
  day: '1 day',
  week: '7 days',
  month: '30 days',
}

function numeric(value: string | number | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function moderationRequestMatch(promptAlias: string, logAlias: string): string {
  return `(${logAlias}.request_id <> '' AND CASE
    WHEN ${promptAlias}.endpoint = '/v1/responses#websocket'
      THEN SPLIT_PART(${promptAlias}.request_id, '.ws.', 1)
    ELSE ${promptAlias}.request_id
  END = ${logAlias}.request_id)`
}

function summary(row: PromptRow): PromptAuditRecordSummary {
  return {
    id: row.id,
    requestId: row.request_id,
    userId: numeric(row.user_id),
    userEmail: row.user_email,
    apiKeyId: numeric(row.api_key_id),
    apiKeyName: row.api_key_name,
    groupId: numeric(row.group_id),
    groupName: row.group_name,
    model: row.model,
    preview: row.hydrated_preview ?? row.preview,
    promptHash: row.prompt_hash,
    charCount: Number(row.char_count),
    redacted: row.redacted,
    truncated: row.truncated,
    riskStatus: row.risk_status,
    riskCategory: row.risk_category,
    riskScore: numeric(row.risk_score),
    moderationAction: row.moderation_action,
    matchedKeyword: row.matched_keyword,
    autoBanned: row.auto_banned,
    fullContentAvailable: row.full_content_available,
    reviewRequired: row.review_required,
    captureKind: row.capture_kind,
    sessionFingerprint: row.session_fingerprint,
    sessionSource: row.session_source,
    mediaCount: Number(row.hydrated_media_count ?? row.media_count),
    occurrenceCount: Number(row.occurrence_count),
    userStatus: row.hydrated_user_status ?? row.user_status,
    capturedAt: iso(row.captured_at),
    expiresAt: iso(row.expires_at),
  }
}

export function recordsCte(
  normalRetentionDays: number,
  riskRetentionDays: number,
  sourceTimeFilters: string[] = [],
  includeDetails = true,
): string {
  const retentionDeadline = `l.created_at + make_interval(days => CASE WHEN l.flagged THEN ${riskRetentionDays} ELSE ${normalRetentionDays} END)`
  const reviewedTimeWhere = sourceTimeFilters
    .map((filter) => filter.replaceAll('records.captured_at', 'l.created_at').replaceAll('records.', 'l.'))
    .join('\n      AND ')
  const capturedTimeWhere = sourceTimeFilters
    .map((filter) => filter.replaceAll('records.captured_at', 'p.captured_at').replaceAll('records.', 'p.'))
    .join('\n      AND ')
  const reviewedPreview = includeDetails
    ? `COALESCE(NULLIF(LEFT(p.prompt_text, 240), ''), l.input_excerpt, '')`
    : `COALESCE(l.input_excerpt, '')`
  const capturedPreview = includeDetails ? `LEFT(p.prompt_text, 240)` : `''::TEXT`
  const reviewedPromptText = includeDetails ? `COALESCE(p.prompt_text, l.input_excerpt, '')` : `''::TEXT`
  const capturedPromptText = includeDetails ? `p.prompt_text` : `''::TEXT`
  const mediaCount = includeDetails ? `COALESCE(media.media_count, 0)` : `0::INTEGER`
  const reviewedUserStatus = includeDetails ? `sub2api_ops.resolve_user_status(l.user_id)` : `NULL::VARCHAR`
  const capturedUserStatus = includeDetails ? `sub2api_ops.resolve_user_status(p.user_id)` : `NULL::VARCHAR`
  const reviewedMediaJoin = includeDetails ? `
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INTEGER AS media_count
      FROM sub2api_ops.prompt_media item
      WHERE item.prompt_record_id = p.id
    ) media ON TRUE` : ''
  const capturedMediaJoin = includeDetails ? `
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INTEGER AS media_count
      FROM sub2api_ops.prompt_media item
      WHERE item.prompt_record_id = p.id
    ) media ON TRUE` : ''
  return `
  WITH records AS (
    SELECT
      'reviewed:' || l.id::text AS id,
      l.id AS source_sort_id,
      p.id AS prompt_record_id,
      l.request_id,
      l.user_id,
      COALESCE(l.user_email, '') AS user_email,
      l.api_key_id,
      COALESCE(l.api_key_name, '') AS api_key_name,
      l.group_id,
      COALESCE(l.group_name, '') AS group_name,
      COALESCE(NULLIF(l.model, ''), p.model, '未知模型') AS model,
      ${reviewedPreview} AS preview,
      ${reviewedPromptText} AS prompt_text,
      COALESCE(p.prompt_hash, '') AS prompt_hash,
      COALESCE(NULLIF(p.prompt_hash, ''), MD5(COALESCE(l.input_excerpt, ''))) AS content_identity,
      COALESCE(p.char_count, CHAR_LENGTH(COALESCE(l.input_excerpt, ''))) AS char_count,
      COALESCE(p.redacted, TRUE) AS redacted,
      CASE WHEN p.id IS NULL THEN CHAR_LENGTH(COALESCE(l.input_excerpt, '')) = 240 ELSE p.truncated END AS truncated,
      CASE
        WHEN l.flagged THEN 'flagged'
        WHEN COALESCE(l.error, '') <> '' THEN 'error'
        WHEN COALESCE(p.review_required, l.endpoint <> '/v1/alpha/search') = FALSE THEN 'not_required'
        ELSE 'clear'
      END AS risk_status,
      COALESCE(l.highest_category, '') AS risk_category,
      l.highest_score AS risk_score,
      COALESCE(l.action, '') AS moderation_action,
      COALESCE(l.matched_keyword, '') AS matched_keyword,
      COALESCE(l.auto_banned, FALSE) AS auto_banned,
      (p.id IS NOT NULL OR CHAR_LENGTH(COALESCE(l.input_excerpt, '')) <> 240) AS full_content_available,
      COALESCE(p.review_required, l.endpoint <> '/v1/alpha/search') AS review_required,
      COALESCE(p.capture_kind, CASE WHEN l.endpoint = '/v1/alpha/search' THEN 'tool' ELSE 'user' END) AS capture_kind,
      COALESCE(p.session_fingerprint, '') AS session_fingerprint,
      COALESCE(p.session_source, '') AS session_source,
      ${mediaCount} AS media_count,
      ${reviewedUserStatus} AS user_status,
      l.created_at AS captured_at,
      ${retentionDeadline} AS expires_at
    FROM public.content_moderation_logs l
    CROSS JOIN sub2api_ops.prompt_audit_control control
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM sub2api_ops.prompt_records candidate
      WHERE ${moderationRequestMatch('candidate', 'l')}
        AND candidate.captured_at BETWEEN l.created_at - INTERVAL '10 minutes' AND l.created_at + INTERVAL '2 minutes'
        AND candidate.captured_at >= control.purge_before
        AND candidate.expires_at > NOW()
      ORDER BY ABS(EXTRACT(EPOCH FROM (candidate.captured_at - l.created_at))), candidate.id DESC
      LIMIT 1
    ) p ON TRUE
    ${reviewedMediaJoin}
    WHERE ${retentionDeadline} > NOW()
      AND l.created_at >= control.purge_before
      ${reviewedTimeWhere ? `AND ${reviewedTimeWhere}` : ''}

    UNION ALL

    SELECT
      'captured:' || p.id::text AS id,
      p.id AS source_sort_id,
      p.id AS prompt_record_id,
      p.request_id,
      p.user_id,
      p.user_email,
      p.api_key_id,
      p.api_key_name,
      p.group_id,
      p.group_name,
      COALESCE(NULLIF(p.model, ''), '未知模型') AS model,
      ${capturedPreview} AS preview,
      ${capturedPromptText} AS prompt_text,
      p.prompt_hash,
      COALESCE(NULLIF(p.prompt_hash, ''), MD5(COALESCE(p.prompt_text, ''))) AS content_identity,
      p.char_count,
      p.redacted,
      p.truncated,
      CASE WHEN p.review_required THEN 'pending' ELSE 'not_required' END AS risk_status,
      '' AS risk_category,
      NULL::DECIMAL AS risk_score,
      '' AS moderation_action,
      '' AS matched_keyword,
      FALSE AS auto_banned,
      TRUE AS full_content_available,
      p.review_required,
      p.capture_kind,
      p.session_fingerprint,
      p.session_source,
      ${mediaCount} AS media_count,
      ${capturedUserStatus} AS user_status,
      p.captured_at,
      p.expires_at
    FROM sub2api_ops.prompt_records p
    CROSS JOIN sub2api_ops.prompt_audit_control control
    ${capturedMediaJoin}
    WHERE p.expires_at > NOW()
      AND p.captured_at >= control.purge_before
      ${capturedTimeWhere ? `AND ${capturedTimeWhere}` : ''}
      AND NOT EXISTS (
        SELECT 1
        FROM public.content_moderation_logs l
        WHERE ${moderationRequestMatch('p', 'l')}
          AND l.created_at BETWEEN p.captured_at - INTERVAL '2 minutes' AND p.captured_at + INTERVAL '10 minutes'
      )
  )
`
}

export function dedupedRecordsCte(): string {
  const identity = `
    COALESCE(source.user_id, 0), COALESCE(source.api_key_id, 0), COALESCE(source.group_id, 0),
    source.capture_kind, source.model, source.content_identity`
  return `
  , record_keys AS (
    SELECT
      source.id,
      source.source_sort_id,
      source.user_id,
      source.api_key_id,
      source.group_id,
      source.capture_kind,
      source.model,
      source.risk_status,
      source.review_required,
      source.captured_at,
      source.content_identity
    FROM filtered_records source
  ), records_with_previous AS (
    SELECT
      source.*,
      LAG(source.captured_at) OVER (
        PARTITION BY ${identity}
        ORDER BY source.captured_at, source.source_sort_id
      ) AS previous_same_at
    FROM record_keys source
  ), records_grouped AS (
    SELECT
      source.*,
      SUM(CASE
        WHEN source.previous_same_at IS NOT NULL
          AND source.captured_at - source.previous_same_at <= INTERVAL '5 minutes'
          THEN 0
        ELSE 1
      END) OVER (
        PARTITION BY ${identity}
        ORDER BY source.captured_at, source.source_sort_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS duplicate_group
    FROM records_with_previous source
  ), records_ranked AS (
    SELECT
      source.*,
      COUNT(*) OVER (
        PARTITION BY ${identity}, source.duplicate_group
      )::INTEGER AS occurrence_count,
      ROW_NUMBER() OVER (
        PARTITION BY ${identity}, source.duplicate_group
        ORDER BY
          (source.risk_status = 'flagged') DESC,
          (source.risk_status = 'error') DESC,
          source.captured_at DESC,
          source.source_sort_id DESC
      ) AS duplicate_rank
    FROM records_grouped source
  ), deduped_record_keys AS (
    SELECT ranked.*
    FROM records_ranked ranked
    WHERE ranked.duplicate_rank = 1
  )`
}

function timeFilters(input: PromptAuditListInput, values: unknown[]): string[] {
  const filters: string[] = []
  if (input.startAt) {
    values.push(input.startAt.toISOString())
    filters.push(`records.captured_at >= $${values.length}::timestamptz`)
  }
  if (input.endAt) {
    values.push(input.endAt.toISOString())
    filters.push(`records.captured_at <= $${values.length}::timestamptz`)
  }
  if (!input.startAt && !input.endAt) {
    values.push(RANGE_INTERVAL[input.range])
    filters.push(`records.captured_at >= NOW() - $${values.length}::interval`)
  }
  return filters
}

function timelineGranularity(input: PromptAuditListInput): 'hour' | 'day' {
  if (!input.startAt || !input.endAt) return input.range === 'day' ? 'hour' : 'day'
  return input.endAt.getTime() - input.startAt.getTime() <= 48 * 60 * 60 * 1_000 ? 'hour' : 'day'
}

export interface PromptAuditListQuery {
  sql: string
  values: unknown[]
}

export function buildPromptAuditListQueries(
  input: PromptAuditListInput,
  normalRetentionDays: number,
  riskRetentionDays: number,
): [PromptAuditListQuery, PromptAuditListQuery] {
  const itemValues: unknown[] = []
  const itemSourceFilters = timeFilters(input, itemValues)
  const itemFilters = ['TRUE']
  if (input.statuses.length === 0) {
    itemFilters.push('FALSE')
  } else if (input.statuses.length < 5) {
    itemValues.push(input.statuses)
    itemFilters.push(`records.risk_status = ANY($${itemValues.length}::text[])`)
  }
  if (input.userId !== null) {
    itemValues.push(input.userId)
    itemSourceFilters.push(`records.user_id = $${itemValues.length}`)
  }
  if (input.groupId !== null) {
    itemValues.push(input.groupId)
    itemSourceFilters.push(`records.group_id = $${itemValues.length}`)
  }
  if (input.search) {
    itemValues.push(`%${input.search}%`)
    itemFilters.push(`(
      records.user_email ILIKE $${itemValues.length}
      OR records.api_key_name ILIKE $${itemValues.length}
      OR records.group_name ILIKE $${itemValues.length}
      OR records.model ILIKE $${itemValues.length}
      OR records.prompt_text ILIKE $${itemValues.length}
      OR records.matched_keyword ILIKE $${itemValues.length}
    )`)
  }
  const pageValues = [...itemValues, input.pageSize, (input.page - 1) * input.pageSize]
  const itemRecords = recordsCte(normalRetentionDays, riskRetentionDays, itemSourceFilters, input.search.length > 0)
  const filteredItems = `, filtered_records AS NOT MATERIALIZED (SELECT * FROM records WHERE ${itemFilters.join(' AND ')})${dedupedRecordsCte()}`
  const items: PromptAuditListQuery = {
    sql: `
      ${itemRecords}
      ${filteredItems}
      , paged_record_keys AS (
        SELECT deduped_record_keys.*, COUNT(*) OVER() AS total_count
        FROM deduped_record_keys
        ORDER BY deduped_record_keys.captured_at DESC, deduped_record_keys.source_sort_id DESC
        LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}
      ), paged_records AS (
        SELECT source.*, page.occurrence_count, page.total_count
        FROM paged_record_keys page
        JOIN filtered_records source ON source.id = page.id
      )
      SELECT
        paged_records.*,
        COALESCE(NULLIF(LEFT(detail.prompt_text, 240), ''), paged_records.preview, '') AS hydrated_preview,
        COALESCE(media.media_count, 0) AS hydrated_media_count,
        sub2api_ops.resolve_user_status(paged_records.user_id) AS hydrated_user_status
      FROM paged_records
      LEFT JOIN sub2api_ops.prompt_records detail ON detail.id = paged_records.prompt_record_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INTEGER AS media_count
        FROM sub2api_ops.prompt_media item
        WHERE item.prompt_record_id = paged_records.prompt_record_id
      ) media ON TRUE
      ORDER BY paged_records.captured_at DESC, paged_records.source_sort_id DESC
    `,
    values: pageValues,
  }

  const aggregateValues: unknown[] = []
  const aggregateTimeFilters = timeFilters(input, aggregateValues)
  aggregateValues.push(timelineGranularity(input))
  const granularityParameter = `$${aggregateValues.length}`
  const bucket = `DATE_TRUNC(${granularityParameter}, deduped_record_keys.captured_at)`
  const aggregateRecords = recordsCte(normalRetentionDays, riskRetentionDays, aggregateTimeFilters, false)
  const filteredAggregates = `, filtered_records AS NOT MATERIALIZED (SELECT * FROM records)${dedupedRecordsCte()}`
  const aggregates: PromptAuditListQuery = {
    sql: `
      ${aggregateRecords}
      ${filteredAggregates}
      SELECT
        ${bucket} AS bucket,
        GROUPING(${bucket}) AS aggregate_level,
        COUNT(*) AS records,
        COUNT(*) FILTER (WHERE deduped_record_keys.review_required = TRUE) AS reviewed,
        COUNT(*) FILTER (WHERE deduped_record_keys.review_required = FALSE) AS not_required,
        COUNT(*) FILTER (WHERE deduped_record_keys.risk_status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE deduped_record_keys.risk_status = 'clear') AS clear,
        COUNT(*) FILTER (WHERE deduped_record_keys.risk_status = 'flagged') AS flagged,
        COUNT(*) FILTER (WHERE deduped_record_keys.risk_status = 'error') AS error,
        COUNT(DISTINCT deduped_record_keys.user_id) FILTER (WHERE deduped_record_keys.user_id IS NOT NULL) AS users
      FROM deduped_record_keys
      GROUP BY GROUPING SETS ((${bucket}), ())
      ORDER BY aggregate_level DESC, bucket
    `,
    values: aggregateValues,
  }
  return [items, aggregates]
}

export class PromptAuditRepository {
  private readonly pool: Pool
  private readonly mediaStore: PromptMediaStore
  private normalRetentionDays: number
  private riskRetentionDays: number

  constructor(config: PromptAuditDatabaseConfig) {
    const { mediaPath, normalRetentionDays, riskRetentionDays, ...database } = config
    this.pool = new Pool({
      ...database,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: 'sub2api-ops-prompt-audit',
    })
    this.mediaStore = new PromptMediaStore(mediaPath)
    this.normalRetentionDays = normalRetentionDays
    this.riskRetentionDays = riskRetentionDays
  }

  private recordsCte(): string {
    return recordsCte(this.normalRetentionDays, this.riskRetentionDays)
  }

  async verifySchema(): Promise<void> {
    await this.mediaStore.initialize()
    await this.pool.query(`
      SELECT
        l.matched_keyword,
        l.auto_banned,
        sub2api_ops.resolve_user_status(l.user_id),
        p.prompt_text,
        p.prompt_hash,
        p.review_required,
        p.capture_kind,
        p.session_fingerprint,
        p.session_source,
        media.id,
        control.purge_before
      FROM public.content_moderation_logs l
      LEFT JOIN sub2api_ops.prompt_records p ON ${moderationRequestMatch('p', 'l')}
      LEFT JOIN sub2api_ops.prompt_media media ON media.prompt_record_id = p.id
      CROSS JOIN sub2api_ops.prompt_audit_control control
      LIMIT 0
    `)
  }

  async insert(prompt: CapturedPrompt): Promise<void> {
    const client = await this.pool.connect()
    let stored: StoredPromptMedia[] = []
    try {
      await client.query('BEGIN')
      const result = await client.query<{ id: string | number }>(`
        INSERT INTO sub2api_ops.prompt_records (
          request_id, endpoint, user_id, user_email, api_key_id, api_key_name, group_id, group_name,
          model, prompt_text, prompt_hash, char_count, redacted, truncated, review_required, capture_kind,
          session_fingerprint, session_source, risk_status, captured_at, expires_at
        )
        SELECT
          $1, $2, identity.user_id, COALESCE(identity.user_email, ''), identity.api_key_id,
          COALESCE(identity.api_key_name, ''), identity.group_id, COALESCE(identity.group_name, ''),
          $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          CASE WHEN $9::boolean THEN 'pending' ELSE 'not_required' END,
          $13::timestamptz, $13::timestamptz + make_interval(days => $15::integer)
          FROM (SELECT 1) seed
        LEFT JOIN LATERAL sub2api_ops.resolve_api_key($14) identity ON TRUE
        ON CONFLICT (request_id) DO NOTHING
        RETURNING id
      `, [
        prompt.requestId,
        prompt.endpoint,
        prompt.model,
        prompt.promptText,
        prompt.promptHash,
        prompt.charCount,
        prompt.redacted,
        prompt.truncated,
        prompt.reviewRequired,
        prompt.captureKind,
        prompt.sessionFingerprint,
        prompt.sessionSource,
        prompt.capturedAt.toISOString(),
        prompt.apiKey,
        this.normalRetentionDays,
      ])
      const recordId = Number(result.rows[0]?.id)
      if (Number.isSafeInteger(recordId) && recordId > 0 && prompt.media.length > 0) {
        stored = await this.mediaStore.persist(recordId, prompt.capturedAt, prompt.media)
        for (const item of stored) await this.insertMedia(client, recordId, item)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (stored.length > 0) await this.mediaStore.remove(stored.map((item) => item.relativePath)).catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async insertMedia(client: PoolClient, recordId: number, item: StoredPromptMedia): Promise<void> {
    await client.query(`
      INSERT INTO sub2api_ops.prompt_media (
        prompt_record_id, mime_type, byte_size, sha256, relative_path
      ) VALUES ($1, $2, $3, $4, $5)
    `, [recordId, item.mimeType, item.byteSize, item.sha256, item.relativePath])
  }

  async configureRetention(normalRetentionDays: number, riskRetentionDays: number): Promise<void> {
    if (!Number.isInteger(normalRetentionDays) || !Number.isInteger(riskRetentionDays)
      || normalRetentionDays < 1 || riskRetentionDays < normalRetentionDays) {
      throw new Error('Invalid prompt audit retention configuration')
    }
    this.normalRetentionDays = normalRetentionDays
    this.riskRetentionDays = riskRetentionDays
    await this.applyConfiguredRetention()
    await this.cleanup()
  }

  async applyConfiguredRetention(): Promise<void> {
    await this.pool.query(`
      UPDATE sub2api_ops.prompt_records
      SET expires_at = captured_at + make_interval(days => CASE WHEN risk_status = 'flagged' THEN $2::integer ELSE $1::integer END)
    `, [this.normalRetentionDays, this.riskRetentionDays])
  }

  async enrich(limit = 500): Promise<number> {
    const result = await this.pool.query(`
      WITH matched AS (
        SELECT
          p.id,
          m.user_id,
          m.user_email,
          m.api_key_id,
          m.api_key_name,
          m.group_id,
          m.group_name,
          COALESCE(NULLIF(m.model, ''), p.model) AS model,
          m.flagged,
          m.highest_category,
          m.highest_score,
          m.action,
          m.matched_keyword,
          m.auto_banned,
          m.error
        FROM sub2api_ops.prompt_records p
        CROSS JOIN sub2api_ops.prompt_audit_control control
        JOIN LATERAL (
          SELECT l.*
          FROM public.content_moderation_logs l
          WHERE ${moderationRequestMatch('p', 'l')}
            AND l.created_at BETWEEN p.captured_at - INTERVAL '2 minutes' AND p.captured_at + INTERVAL '10 minutes'
          ORDER BY ABS(EXTRACT(EPOCH FROM (l.created_at - p.captured_at))), l.id DESC
          LIMIT 1
        ) m ON TRUE
        WHERE p.review_required = TRUE
          AND p.enriched_at IS NULL
          AND p.expires_at > NOW()
          AND p.captured_at >= control.purge_before
        ORDER BY p.captured_at
        LIMIT $1
      )
      UPDATE sub2api_ops.prompt_records p
      SET
        user_id = matched.user_id,
        user_email = matched.user_email,
        api_key_id = matched.api_key_id,
        api_key_name = matched.api_key_name,
        group_id = matched.group_id,
        group_name = matched.group_name,
        model = matched.model,
        risk_status = CASE
          WHEN matched.flagged THEN 'flagged'
          WHEN COALESCE(matched.error, '') <> '' THEN 'error'
          ELSE 'clear'
        END,
        risk_category = COALESCE(matched.highest_category, ''),
        risk_score = matched.highest_score,
        moderation_action = COALESCE(matched.action, ''),
        moderation_error = COALESCE(matched.error, ''),
        matched_keyword = COALESCE(matched.matched_keyword, ''),
        auto_banned = COALESCE(matched.auto_banned, FALSE),
        enriched_at = NOW(),
        expires_at = p.captured_at + make_interval(days => CASE WHEN matched.flagged THEN $2::integer ELSE $3::integer END)
      FROM matched
      WHERE p.id = matched.id
    `, [limit, this.riskRetentionDays, this.normalRetentionDays])
    return result.rowCount ?? 0
  }

  async cleanup(): Promise<number> {
    return (await this.deleteRecords('records.expires_at < NOW()', [])).deletedRecords
  }

  async purge(before: Date): Promise<PromptAuditPurgeResponse> {
    if (!Number.isFinite(before.getTime())) throw new Error('Invalid purge date')
    const result = await this.deleteRecords('records.captured_at < $1::timestamptz', [before.toISOString()], before)
    return { before: before.toISOString(), ...result }
  }

  private async deleteRecords(
    condition: string,
    values: unknown[],
    purgeBefore?: Date,
  ): Promise<Omit<PromptAuditPurgeResponse, 'before'>> {
    const client = await this.pool.connect()
    let mediaRows: DeletedMediaRow[] = []
    let deletedRecords = 0
    try {
      await client.query('BEGIN')
      mediaRows = (await client.query<DeletedMediaRow>(`
        SELECT media.relative_path, media.byte_size
        FROM sub2api_ops.prompt_media media
        JOIN sub2api_ops.prompt_records records ON records.id = media.prompt_record_id
        WHERE ${condition}
        FOR UPDATE OF records, media
      `, values)).rows
      // Remove files before committing the row deletion.  If a filesystem
      // operation fails, the transaction is rolled back and a later cleanup
      // pass can retry the same record instead of leaving an untracked file.
      await this.mediaStore.remove(mediaRows.map((item) => item.relative_path))
      const deleted = await client.query(`DELETE FROM sub2api_ops.prompt_records records WHERE ${condition}`, values)
      deletedRecords = deleted.rowCount ?? 0
      if (purgeBefore) {
        await client.query(`
          UPDATE sub2api_ops.prompt_audit_control
          SET purge_before = GREATEST(purge_before, $1::timestamptz), updated_at = NOW()
          WHERE singleton = TRUE
        `, [purgeBefore.toISOString()])
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    return {
      deletedRecords,
      deletedImages: mediaRows.length,
      freedImageBytes: mediaRows.reduce((total, item) => total + Number(item.byte_size), 0),
    }
  }

  async list(input: PromptAuditListInput): Promise<PromptAuditListResponse> {
    const [itemsQuery, aggregateQuery] = buildPromptAuditListQueries(
      input,
      this.normalRetentionDays,
      this.riskRetentionDays,
    )
    const [itemsResult, aggregateResult] = await Promise.all([
      this.pool.query<PromptRow>(itemsQuery.sql, itemsQuery.values),
      this.pool.query<AggregateRow>(aggregateQuery.sql, aggregateQuery.values),
    ])
    const totals = aggregateResult.rows.find((row) => Number(row.aggregate_level) === 1) ?? {
      records: 0,
      reviewed: 0,
      not_required: 0,
      pending: 0,
      clear: 0,
      flagged: 0,
      error: 0,
      users: 0,
    }
    return {
      generatedAt: new Date().toISOString(),
      range: input.range,
      page: input.page,
      pageSize: input.pageSize,
      total: Number(itemsResult.rows[0]?.total_count ?? 0),
      totals: {
        records: Number(totals.records),
        reviewed: Number(totals.reviewed),
        notRequired: Number(totals.not_required),
        pending: Number(totals.pending),
        clear: Number(totals.clear),
        flagged: Number(totals.flagged),
        error: Number(totals.error),
        users: Number(totals.users),
      },
      timeline: aggregateResult.rows.filter((row) => Number(row.aggregate_level) === 0 && row.bucket !== null).map((row) => ({
        bucket: iso(row.bucket!),
        pending: Number(row.pending),
        clear: Number(row.clear),
        flagged: Number(row.flagged),
        error: Number(row.error),
        notRequired: Number(row.not_required),
      })),
      items: itemsResult.rows.map(summary),
    }
  }

  async detail(id: string): Promise<PromptAuditRecordDetail | null> {
    const result = await this.pool.query<PromptRow>(`
      ${this.recordsCte()}
      SELECT records.*, 1::INTEGER AS occurrence_count
      FROM records
      WHERE records.id = $1
    `, [id])
    const row = result.rows[0]
    if (!row) return null
    const media = row.prompt_record_id === null ? [] : (await this.pool.query<PromptMediaRow>(`
      SELECT id, mime_type, byte_size, sha256, relative_path
      FROM sub2api_ops.prompt_media
      WHERE prompt_record_id = $1
      ORDER BY id
    `, [row.prompt_record_id])).rows.map((item) => ({
      id: Number(item.id),
      mimeType: item.mime_type,
      byteSize: Number(item.byte_size),
      sha256: item.sha256,
      fileName: this.mediaStore.fileName(item.relative_path),
    }))
    return { ...summary(row), promptText: row.prompt_text ?? '', media }
  }

  async session(fingerprint: string): Promise<PromptAuditSessionResponse | null> {
    const result = await this.pool.query<PromptRow>(`
      ${this.recordsCte()}
      SELECT records.*, 1::INTEGER AS occurrence_count
      FROM records
      WHERE records.session_fingerprint = $1
      ORDER BY records.captured_at, records.source_sort_id
    `, [fingerprint])
    if (result.rows.length === 0) return null
    const items = result.rows.map(summary)
    const startedAt = items[0]!.capturedAt
    const endedAt = items.at(-1)!.capturedAt
    const modelCounts = new Map<string, number>()
    for (const item of items) modelCounts.set(item.model, (modelCounts.get(item.model) ?? 0) + 1)
    return {
      fingerprint,
      startedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      totals: {
        records: items.length,
        reviewed: items.filter((item) => item.reviewRequired).length,
        notRequired: items.filter((item) => !item.reviewRequired).length,
        pending: items.filter((item) => item.riskStatus === 'pending').length,
        flagged: items.filter((item) => item.riskStatus === 'flagged').length,
        errors: items.filter((item) => item.riskStatus === 'error').length,
      },
      models: [...modelCounts].map(([model, records]) => ({ model, records })).sort((a, b) => b.records - a.records),
      items,
    }
  }

  async mediaFile(id: number): Promise<PromptAuditMediaFile | null> {
    const result = await this.pool.query<PromptMediaRow>(`
      SELECT media.id, media.mime_type, media.byte_size, media.sha256, media.relative_path
      FROM sub2api_ops.prompt_media media
      JOIN sub2api_ops.prompt_records record ON record.id = media.prompt_record_id
      CROSS JOIN sub2api_ops.prompt_audit_control control
      WHERE media.id = $1
        AND record.expires_at > NOW()
        AND record.captured_at >= control.purge_before
    `, [id])
    const row = result.rows[0]
    if (!row) return null
    const path = await this.mediaStore.readablePath(row.relative_path)
    return path ? {
      path,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      fileName: this.mediaStore.fileName(row.relative_path),
    } : null
  }

  async storage(): Promise<PromptAuditStorageResponse> {
    const [database, images] = await Promise.all([
      this.pool.query<{
        records: string | number
        database_bytes: string | number
        purge_before: string | Date
      }>(`
        SELECT
          (SELECT COUNT(*) FROM sub2api_ops.prompt_records) AS records,
          pg_total_relation_size('sub2api_ops.prompt_records'::regclass)
            + pg_total_relation_size('sub2api_ops.prompt_media'::regclass)
            + pg_total_relation_size('sub2api_ops.prompt_audit_control'::regclass) AS database_bytes,
          control.purge_before
        FROM sub2api_ops.prompt_audit_control control
        WHERE control.singleton = TRUE
      `),
      this.mediaStore.usage(),
    ])
    const row = database.rows[0]
    const databaseBytes = Number(row?.database_bytes ?? 0)
    return {
      generatedAt: new Date().toISOString(),
      purgeBefore: row ? iso(row.purge_before) : new Date(0).toISOString(),
      logs: {
        records: Number(row?.records ?? 0),
        databaseBytes,
      },
      images,
      totalBytes: databaseBytes + images.bytes,
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
