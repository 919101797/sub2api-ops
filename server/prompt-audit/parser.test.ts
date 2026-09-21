import { describe, expect, it } from 'vitest'

import { extractLatestPrompt, extractPromptMedia, extractPromptSessionIdentity, MAX_PROMPT_CHARACTERS, parsePrompt, parseWebSocketPrompt, redactPrompt } from './parser.js'

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0j8AAAAASUVORK5CYII='

describe('extractLatestPrompt', () => {
  it('记录 Responses 字符串 input', () => {
    expect(extractLatestPrompt({ model: 'gpt-5', input: '保留\n换行' })).toEqual({
      model: 'gpt-5',
      prompt: '保留\n换行',
      reviewRequired: true,
      captureKind: 'user',
    })
  })

  it('只取 input 最后一项的 role=user 消息', () => {
    expect(extractLatestPrompt({
      model: 'gpt-5.2-codex',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: '第一轮' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: '模型输出' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第二轮 A' }, { type: 'input_text', text: '第二轮 B' }] },
      ],
    })).toEqual({
      model: 'gpt-5.2-codex',
      prompt: '第二轮 A\n第二轮 B',
      reviewRequired: true,
      captureKind: 'user',
    })
  })

  it('工具调用保留工具名和参数并标记无需审核', () => {
    expect(extractLatestPrompt({ input: [
      { role: 'user', content: [{ type: 'input_text', text: '运行测试' }] },
      { type: 'function_call', name: 'run_tests', arguments: '{"suite":"unit"}' },
    ] })).toEqual({
      model: '',
      prompt: '工具：run_tests\n参数：\n{"suite":"unit"}',
      reviewRequired: false,
      captureKind: 'function_call',
    })
  })

  it('工具结果保留实际输出并标记无需审核', () => {
    expect(extractLatestPrompt({ input: [
      { role: 'user', content: [{ type: 'input_text', text: '运行测试' }] },
      { type: 'function_call_output', output: 'all passed' },
    ] })).toEqual({
      model: '',
      prompt: '工具结果：\nall passed',
      reviewRequired: false,
      captureKind: 'function_call_output',
    })
  })

  it('最后一项是 assistant 时只记录助手续跑内容', () => {
    expect(extractLatestPrompt({ input: [
      { role: 'user', content: [{ type: 'input_text', text: '问题' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: '回答' }] },
    ] })).toEqual({ model: '', prompt: '回答', reviewRequired: false, captureKind: 'assistant' })
  })

  it('支持 Responses 中没有 role 的顶层 input_text', () => {
    expect(extractLatestPrompt({ model: 'gpt-5', input: [
      { type: 'input_text', text: '直接输入' },
    ] })).toEqual({ model: 'gpt-5', prompt: '直接输入', reviewRequired: true, captureKind: 'user' })
  })

  it('支持单个 Responses input 对象', () => {
    expect(extractLatestPrompt({ input: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '单对象' }],
    } })).toEqual({ model: '', prompt: '单对象', reviewRequired: true, captureKind: 'user' })
  })

  it('跳过 sub2api 内容审核同样忽略的 system-reminder', () => {
    expect(extractLatestPrompt({ input: [{
      role: 'user',
      content: [{ type: 'input_text', text: '<system-reminder>内部上下文</system-reminder>' }],
    }] })).toBeNull()
  })

  it('不保存隐藏推理或图片 Base64', () => {
    expect(extractLatestPrompt({ input: [{
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '隐藏思考' },
        { type: 'output_text', text: `结果 data:image/png;base64,${'a'.repeat(600)}` },
      ],
    }] })).toEqual({
      model: '',
      prompt: '结果 [图片或二进制内容已省略]',
      reviewRequired: false,
      captureKind: 'assistant',
    })
  })
})

describe('extractPromptSessionIdentity', () => {
  it('从 prompt_cache_key 提取稳定会话标识', () => {
    expect(extractPromptSessionIdentity({ prompt_cache_key: ' task-session-42 ' })).toEqual({
      value: 'task-session-42',
      source: 'body_prompt_cache',
    })
  })

  it('忽略空值和过长值', () => {
    expect(extractPromptSessionIdentity({ prompt_cache_key: ' ' })).toBeNull()
    expect(extractPromptSessionIdentity({ prompt_cache_key: 'x'.repeat(513) })).toBeNull()
  })
})

describe('parseWebSocketPrompt', () => {
  it('captures a direct Responses WebSocket turn', () => {
    expect(parseWebSocketPrompt({ type: 'response.create', model: 'gpt-5.6', input: '完整 WS 输入' })).toMatchObject({
      model: 'gpt-5.6',
      promptText: '完整 WS 输入',
      reviewRequired: true,
    })
  })

  it('captures a nested response envelope', () => {
    expect(parseWebSocketPrompt({ type: 'response.create', response: { model: 'gpt-5.6', input: '嵌套 WS 输入' } })).toMatchObject({
      model: 'gpt-5.6',
      promptText: '嵌套 WS 输入',
    })
  })

  it('ignores server events and protocol noise', () => {
    expect(parseWebSocketPrompt({ type: 'response.done', response: { output: [] } })).toBeNull()
  })
})

describe('prompt privacy and limits', () => {
  it('脱敏常见密钥、Token 和密码', () => {
    const value = 'Authorization: Bearer abcdefghijklmnop api_key=sk-abcdefghijklmnop password=hunter2'
    const result = redactPrompt(value)
    expect(result.redacted).toBe(true)
    expect(result.text).not.toContain('abcdefghijklmnop')
    expect(result.text).not.toContain('hunter2')
  })

  it('对超大提示词显式标记截断', () => {
    const parsed = parsePrompt({ input: 'a'.repeat(MAX_PROMPT_CHARACTERS + 1) })
    expect(parsed?.truncated).toBe(true)
    expect(parsed?.charCount).toBe(MAX_PROMPT_CHARACTERS + 1)
    expect(parsed?.promptText).toHaveLength(MAX_PROMPT_CHARACTERS)
    expect(parsed?.reviewRequired).toBe(true)
    expect(parsed?.captureKind).toBe('user')
  })

  it('从最后一项用户输入提取内嵌图片并去重', () => {
    const body = { model: 'gpt-5', input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: '检查这张图' },
        { type: 'input_image', image_url: `data:image/png;base64,${onePixelPng}` },
        { type: 'input_image', image_url: `data:image/png;base64,${onePixelPng}` },
      ],
    }] }
    const media = extractPromptMedia(body)
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({ mimeType: 'image/png', extension: 'png' })
    expect(media[0]?.byteSize).toBeGreaterThan(0)
    const parsed = parsePrompt(body)
    expect(parsed?.promptText).toContain('检查这张图')
    expect(parsed?.promptText).toContain('附件图片：1 张')
    expect(parsed?.media).toHaveLength(1)
  })

  it('图片输入没有文本时仍生成可审计记录', () => {
    const parsed = parsePrompt({ input: [{
      role: 'user',
      content: [{ type: 'input_image', image_url: `data:image/png;base64,${onePixelPng}` }],
    }] })
    expect(parsed).toMatchObject({ reviewRequired: true, captureKind: 'user' })
    expect(parsed?.promptText).toContain('附件图片：1 张')
  })

  it('拒绝声明类型与文件头不一致的图片', () => {
    expect(extractPromptMedia({ input: [{
      role: 'user',
      content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${onePixelPng}` }],
    }] })).toEqual([])
  })
})
