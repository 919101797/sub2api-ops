import WebSocket from 'ws'

const requiredEnvironment = ['WS_TEST_API_KEY', 'WS_TEST_MODEL', 'WS_TEST_URL']
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`Missing ${name}`)
}

const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const markers = [`WS_AUDIT_VERIFY_${suffix}_A`, `WS_AUDIT_VERIFY_${suffix}_B`]
const prompts = markers.map((marker, index) => (
  `${marker} 这是第${index + 1}轮 WebSocket 审计验收输入，请仅回复 OK。` + '完整证据保留验证内容。'.repeat(32)
))
const ws = new WebSocket(process.env.WS_TEST_URL, {
  headers: { Authorization: `Bearer ${process.env.WS_TEST_API_KEY}` },
  handshakeTimeout: 15_000,
})
const terminalTypes = new Set(['response.completed', 'response.done'])
let responseId = null
let round = 0
let finished = false

const timeout = setTimeout(() => finish('timeout'), 90_000)

function sendRound() {
  const payload = {
    type: 'response.create',
    model: process.env.WS_TEST_MODEL,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompts[round] }] }],
    stream: true,
  }
  if (responseId) payload.previous_response_id = responseId
  ws.send(JSON.stringify(payload))
}

function finish(result) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  console.log('ws_opened=true')
  console.log(`model=${process.env.WS_TEST_MODEL}`)
  console.log(`marker1=${markers[0]}`)
  console.log(`marker2=${markers[1]}`)
  console.log(`input_chars=${prompts.map((value) => [...value].length).join(',')}`)
  console.log(`result=${result}`)
  ws.close()
  setTimeout(() => process.exit(result === 'two_rounds_completed' ? 0 : 2), 100)
}

ws.on('open', sendRound)
ws.on('message', (raw) => {
  let event
  try {
    event = JSON.parse(raw.toString())
  } catch {
    return
  }
  if (event?.response?.id) responseId = event.response.id
  if (event?.type === 'error' || event?.type === 'response.failed') {
    const code = event?.error?.code || event?.response?.error?.code || 'unknown'
    const message = String(event?.error?.message || event?.response?.error?.message || '')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 160)
    finish(`upstream_error:${code}:${message}`)
    return
  }
  if (!terminalTypes.has(event?.type)) return
  if (round === 0) {
    round = 1
    sendRound()
  } else {
    finish('two_rounds_completed')
  }
})
ws.on('unexpected-response', (_request, response) => finish(`handshake_status:${response.statusCode}`))
ws.on('error', (error) => finish(`client_error:${error.code || error.name}`))
ws.on('close', (code) => {
  if (!finished) finish(`closed:${code}`)
})
