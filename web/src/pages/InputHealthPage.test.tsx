import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PromptAuditListResponse } from '@shared/contracts'
import { api } from '@/lib/api'
import { InputHealthPage } from './InputHealthPage'

vi.mock('@/lib/api', () => ({
  api: {
    prompts: vi.fn(),
    promptFilterOptions: vi.fn(),
    unbanPromptUser: vi.fn(),
  },
}))

const response: PromptAuditListResponse = {
  generatedAt: '2026-08-31T00:00:00.000Z',
  range: 'day',
  page: 1,
  pageSize: 30,
  total: 0,
  totals: { records: 0, reviewed: 0, notRequired: 0, pending: 0, clear: 0, flagged: 0, error: 0, users: 0 },
  timeline: [],
  items: [],
}

describe('InputHealthPage filters', () => {
  beforeEach(() => {
    vi.mocked(api.prompts).mockResolvedValue(response)
    vi.mocked(api.promptFilterOptions).mockResolvedValue({ users: [], groups: [{ id: 14, name: '审核分组' }] })
  })

  it('场景-006-07：修改筛选草稿后只在点击查询时请求', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><InputHealthPage retention={{ maxRequestBodyMiB: 10, normalRetentionDays: 5, riskRetentionDays: 30 }} /></QueryClientProvider>)
    await waitFor(() => expect(api.prompts).toHaveBeenCalledTimes(1))

    fireEvent.mouseDown(screen.getByLabelText('按分组过滤'))
    fireEvent.click(await screen.findByText('#14 · 审核分组'))
    await Promise.resolve()
    expect(api.prompts).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '查询审计记录' }))
    await waitFor(() => expect(api.prompts).toHaveBeenCalledTimes(2))
    expect(api.prompts).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 14 }))
  })
})
