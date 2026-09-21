// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Sub2ApiClient } from './sub2api-client.js'

afterEach(() => vi.unstubAllGlobals())

describe('Sub2ApiClient.batchSetUserLimits', () => {
  it('atomically writes concurrency and RPM for at most 500 users per native Sub2API batch request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'ok', data: { affected: 500 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'ok', data: { affected: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new Sub2ApiClient('http://sub2api.test/api/v1', 'admin-key', 1_000)

    await expect(client.batchSetUserLimits(
      Array.from({ length: 501 }, (_, index) => index + 1),
      { concurrency: 3, rpmLimit: 30 },
    )).resolves.toBe(501)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0]!
    const second = fetchMock.mock.calls[1]!
    expect(String(first[0])).toBe('http://sub2api.test/api/v1/admin/users/batch-limits')
    expect(JSON.parse(String(first[1]?.body))).toMatchObject({ all: false, concurrency: 3, rpm_limit: 30 })
    expect(JSON.parse(String(first[1]?.body)).user_ids).toHaveLength(500)
    expect(JSON.parse(String(second[1]?.body)).user_ids).toEqual([501])
  })
})
