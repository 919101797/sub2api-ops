import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { PROMPT_CAPTURE_CONTENT_TYPE, PROMPT_WS_CAPTURE_CONTENT_TYPE, registerPromptCaptureRoute } from './routes.js'

function headers(secret = 'capture-secret') {
  return {
    'content-type': PROMPT_CAPTURE_CONTENT_TYPE,
    'x-ops-capture-secret': secret,
    'x-request-id': 'nginx-request-id-1',
  }
}

const tenMiB = () => 10 * 1024 * 1024

describe('prompt capture route', () => {
  it('在持久化之前立即返回 202', async () => {
    const enqueue = vi.fn(() => true)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue, store: vi.fn() } })
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture',
      headers: headers(),
      payload: JSON.stringify({ model: 'gpt-5', input: '请审计这条输入' }),
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ accepted: true })
    expect(enqueue).toHaveBeenCalledOnce()
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }))
    await app.close()
  })

  it('对非法 JSON 安全忽略并返回 202', async () => {
    const enqueue = vi.fn(() => true)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue, store: vi.fn() } })
    const response = await app.inject({ method: 'POST', url: '/internal/prompts/capture', headers: headers(), payload: '{invalid' })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ accepted: false })
    expect(enqueue).not.toHaveBeenCalled()
    await app.close()
  })

  it('采集 Agent 工具续跑并标记无需审核', async () => {
    const enqueue = vi.fn(() => true)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue, store: vi.fn() } })
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture',
      headers: headers(),
      payload: JSON.stringify({
        model: 'gpt-5',
        input: [
          { role: 'user', content: [{ type: 'input_text', text: '运行测试' }] },
          { type: 'function_call_output', output: 'all passed' },
        ],
      }),
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ accepted: true })
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      promptText: '工具结果：\nall passed',
      reviewRequired: false,
      captureKind: 'function_call_output',
    }))
    await app.close()
  })

  it('把用户输入中的内嵌图片交给持久化队列', async () => {
    const enqueue = vi.fn(() => true)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue, store: vi.fn() } })
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0j8AAAAASUVORK5CYII='
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture',
      headers: headers(),
      payload: JSON.stringify({ input: [{ role: 'user', content: [
        { type: 'input_text', text: '图片审计' },
        { type: 'input_image', image_url: `data:image/png;base64,${png}` },
      ] }] }),
    })
    expect(response.statusCode).toBe(202)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      reviewRequired: true,
      media: [expect.objectContaining({ mimeType: 'image/png' })],
    }))
    await app.close()
  })

  it('使用显式会话头优先生成不可逆指纹', async () => {
    const enqueue = vi.fn(() => true)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue, store: vi.fn() } })
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture',
      headers: {
        ...headers(),
        'x-original-session-id': 'explicit-session',
        'x-original-conversation-id': 'conversation-fallback',
      },
      payload: JSON.stringify({ model: 'gpt-5', prompt_cache_key: 'body-fallback', input: '检查会话' }),
    })
    expect(response.statusCode).toBe(202)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionFingerprint: createHash('sha256').update('explicit-session').digest('hex'),
      sessionSource: 'header_session',
    }))
    await app.close()
  })

  it('没有会话头时使用 prompt_cache_key', async () => {
    const enqueue = vi.fn(() => true)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue, store: vi.fn() } })
    await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture',
      headers: headers(),
      payload: JSON.stringify({ model: 'gpt-5', prompt_cache_key: 'task-42', input: '执行目标任务' }),
    })
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionFingerprint: createHash('sha256').update('task-42').digest('hex'),
      sessionSource: 'body_prompt_cache',
    }))
    await app.close()
  })

  it('不向未授权请求暴露内部采集端点', async () => {
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue: vi.fn(() => true), store: vi.fn() } })
    const response = await app.inject({ method: 'POST', url: '/internal/prompts/capture', headers: headers('wrong-secret'), payload: '{}' })
    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('durably stores a WebSocket response.create turn before acknowledging it', async () => {
    const store = vi.fn(async () => undefined)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue: vi.fn(() => true), store } })
    const capturedAt = new Date().toISOString()
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture/ws',
      headers: {
        'content-type': PROMPT_WS_CAPTURE_CONTENT_TYPE,
        'x-ops-capture-secret': 'capture-secret',
        'x-request-id': 'nginx-request-id-1.ws.2',
        'x-ws-connection-id': 'nginx-request-id-1',
        'x-ws-message-sequence': '2',
        'x-captured-at': capturedAt,
        'x-original-uri': '/v1/responses#websocket',
      },
      payload: JSON.stringify({ type: 'response.create', model: 'gpt-5.6', input: '需要完整保存的 WS 输入' }),
    })
    expect(response.statusCode).toBe(201)
    expect(store).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'nginx-request-id-1.ws.2',
      promptText: '需要完整保存的 WS 输入',
      endpoint: '/v1/responses#websocket',
      capturedAt: new Date(capturedAt),
    }))
    await app.close()
  })

  it('acknowledges non-input WS protocol events without creating records', async () => {
    const store = vi.fn(async () => undefined)
    const app = Fastify()
    registerPromptCaptureRoute(app, { captureSecret: 'capture-secret', maxRequestBodyBytes: tenMiB, service: { enqueue: vi.fn(() => true), store } })
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture/ws',
      headers: {
        'content-type': PROMPT_WS_CAPTURE_CONTENT_TYPE,
        'x-ops-capture-secret': 'capture-secret',
        'x-request-id': 'nginx-request-id-1.ws.3',
        'x-ws-connection-id': 'nginx-request-id-1',
        'x-ws-message-sequence': '3',
        'x-captured-at': new Date().toISOString(),
      },
      payload: JSON.stringify({ type: 'response.done' }),
    })
    expect(response.statusCode).toBe(204)
    expect(store).not.toHaveBeenCalled()
    await app.close()
  })

  it('在读取正文前跳过超过动态配置上限的 HTTP 审计', async () => {
    const enqueue = vi.fn(() => true)
    let maxBytes = 32
    const app = Fastify()
    registerPromptCaptureRoute(app, {
      captureSecret: 'capture-secret',
      maxRequestBodyBytes: () => maxBytes,
      service: { enqueue, store: vi.fn() },
    })
    const payload = JSON.stringify({ model: 'gpt-5', input: '超过当前上限的审计正文' })

    const skipped = await app.inject({ method: 'POST', url: '/internal/prompts/capture', headers: headers(), payload })
    expect(skipped.statusCode).toBe(204)
    expect(enqueue).not.toHaveBeenCalled()

    maxBytes = Buffer.byteLength(payload)
    const accepted = await app.inject({ method: 'POST', url: '/internal/prompts/capture', headers: headers(), payload })
    expect(accepted.statusCode).toBe(202)
    expect(enqueue).toHaveBeenCalledOnce()
    await app.close()
  })

  it('跳过超过动态配置上限的 WebSocket 审计消息', async () => {
    const store = vi.fn(async () => undefined)
    const app = Fastify()
    registerPromptCaptureRoute(app, {
      captureSecret: 'capture-secret',
      maxRequestBodyBytes: () => 32,
      service: { enqueue: vi.fn(() => true), store },
    })
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture/ws',
      headers: {
        'content-type': PROMPT_WS_CAPTURE_CONTENT_TYPE,
        'x-ops-capture-secret': 'capture-secret',
        'x-request-id': 'nginx-request-id-1.ws.4',
        'x-ws-connection-id': 'nginx-request-id-1',
        'x-ws-message-sequence': '4',
        'x-captured-at': new Date().toISOString(),
      },
      payload: JSON.stringify({ type: 'response.create', input: '超过当前上限的 WebSocket 审计正文' }),
    })
    expect(response.statusCode).toBe(204)
    expect(store).not.toHaveBeenCalled()
    await app.close()
  })

  it('在正文大小未知时不读取流并跳过审计', async () => {
    const enqueue = vi.fn(() => true)
    const app = Fastify()
    registerPromptCaptureRoute(app, {
      captureSecret: 'capture-secret',
      maxRequestBodyBytes: tenMiB,
      service: { enqueue, store: vi.fn() },
    })
    const response = await app.inject({
      method: 'POST',
      url: '/internal/prompts/capture',
      headers: headers(),
      payload: Readable.from([JSON.stringify({ input: '没有 Content-Length' })]),
    })
    expect(response.statusCode).toBe(204)
    expect(enqueue).not.toHaveBeenCalled()
    await app.close()
  })
})
