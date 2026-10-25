import type { IncomingHttpHeaders } from 'node:http'
import type { RequestLimitsStatus } from '../../shared/request-limits.js'
import { MIB, RequestLimitError, limitForUser, type RequestLimitsStore } from './policy.js'

export interface RequestIdentity extends RequestLimitsStatus { userId: number; maxBytes: number }
export class LargeRequestGate {
  active = 0
  acquire(maximum: number): () => void {
    if (this.active >= maximum) throw new RequestLimitError('大请求通道繁忙，请稍后重试', 429, 'large_request_busy')
    this.active++
    let released = false
    return () => { if (!released) { released = true; this.active-- } }
  }
}
export class RequestGuard {
  readonly gate = new LargeRequestGate()
  constructor(readonly store: Pick<RequestLimitsStore, 'read'>, private readonly resolveUser: (key: string) => Promise<number | null>) {}
  async authorize(headers: IncomingHttpHeaders, requestUrl = '/'): Promise<RequestIdentity> {
    const authorization = headers.authorization
    const direct = headers['x-api-key'] ?? headers['x-goog-api-key']
    const key = authorization?.replace(/^Bearer\s+/i, '').trim() || (typeof direct === 'string' ? direct.trim() : '') || new URL(requestUrl, 'http://gateway.invalid').searchParams.get('key') || ''
    if (!key || key.length > 256) throw new RequestLimitError('API Key 无效', 401, 'invalid_api_key')
    let status: RequestLimitsStatus, userId: number | null
    try { [status, userId] = await Promise.all([this.store.read(), this.resolveUser(key)]) }
    catch { throw new RequestLimitError('请求限制或用户身份服务暂时不可用', 503, 'request_policy_unavailable') }
    if (userId === null) throw new RequestLimitError('API Key 无效或用户已停用', 401, 'invalid_api_key')
    return { ...status, userId, maxBytes: limitForUser(status.policy, userId) * MIB }
  }
}
