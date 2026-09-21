import { describe, expect, it } from 'vitest'

import { buildPromptAuditListQueries, moderationRequestMatch, recordsCte } from './repository.js'

describe('prompt audit record correlation and retention', () => {
  it('uses the shared request id to attach the captured full input', () => {
    const sql = recordsCte(30, 60)

    expect(sql).toContain('ELSE candidate.request_id')
    expect(sql).toContain('END = l.request_id')
    expect(sql).not.toContain('LEFT(candidate.prompt_text, 240) = COALESCE(l.input_excerpt')
  })

  it('correlates every WS turn through its connection request id', () => {
    expect(moderationRequestMatch('prompt', 'log')).toContain("prompt.endpoint = '/v1/responses#websocket'")
    expect(moderationRequestMatch('prompt', 'log')).toContain("SPLIT_PART(prompt.request_id, '.ws.', 1)")
    expect(moderationRequestMatch('prompt', 'log')).toContain('END = log.request_id')
  })

  it('calculates every deadline from the message creation time', () => {
    const sql = recordsCte(30, 60)

    expect(sql).toContain('l.created_at + make_interval(days => CASE WHEN l.flagged THEN 60 ELSE 30 END)')
    expect(sql).not.toContain('NOW() + make_interval')
  })

  it('场景-006-08：在来源表内应用时间条件并把四类结果合并为两条查询', () => {
    const input = {
      range: 'day' as const,
      statuses: ['clear' as const],
      userId: null,
      groupId: 14,
      search: '',
      startAt: null,
      endAt: null,
      page: 1,
      pageSize: 30,
    }

    const queries = buildPromptAuditListQueries(input, 5, 30)

    expect(queries).toHaveLength(2)
    expect(queries[0]?.sql).toContain('l.created_at >= NOW() - $1::interval')
    expect(queries[0]?.sql).toContain('p.captured_at >= NOW() - $1::interval')
    expect(queries[0]?.sql).toContain('l.group_id = $3')
    expect(queries[0]?.sql).toContain('p.group_id = $3')
    expect(queries[0]?.sql).toContain('COUNT(*) OVER() AS total_count')
    expect(queries[1]?.sql).toContain('GROUP BY GROUPING SETS')
    expect(queries[1]?.sql).toContain('GROUPING(DATE_TRUNC')
    expect(queries[0]?.sql).toContain('source.content_identity')
    expect(queries[0]?.sql).toContain("SPLIT_PART(candidate.request_id, '.ws.', 1)")
  })

  it('场景-006-09：30 天列表先用窄字段去重分页，再补齐当前页详情', () => {
    const [items, aggregates] = buildPromptAuditListQueries({
      range: 'month',
      statuses: ['pending', 'flagged', 'clear', 'not_required', 'error'],
      userId: null,
      groupId: 14,
      search: '',
      startAt: null,
      endAt: null,
      page: 1,
      pageSize: 20,
    }, 5, 30)

    expect(items.sql).toContain('filtered_records AS NOT MATERIALIZED')
    expect(items.sql).toContain('paged_record_keys AS')
    expect(items.sql).toContain('JOIN filtered_records source ON source.id = page.id')
    expect(items.sql).toContain('LEFT JOIN sub2api_ops.prompt_records detail ON detail.id = paged_records.prompt_record_id')
    expect(items.sql.match(/resolve_user_status/g)).toHaveLength(1)
    expect(items.sql.indexOf('resolve_user_status')).toBeGreaterThan(items.sql.indexOf('paged_record_keys AS'))
    expect(aggregates.sql).toContain('FROM deduped_record_keys')
    expect(aggregates.sql).not.toContain('resolve_user_status')
    expect(aggregates.sql).not.toContain('prompt_media')
  })
})
