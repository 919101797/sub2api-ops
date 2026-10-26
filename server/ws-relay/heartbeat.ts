import type { Socket } from 'node:net'
import WebSocket from 'ws'

const INTERVAL_MS = 25_000
const STALE_MS = 75_000

export function maintainClientHeartbeat(client: WebSocket, transport: Socket, onTimeout: () => void): () => void {
  let lastSeen = Date.now()
  let observedBytes = transport.bytesRead
  const pong = () => { lastSeen = Date.now() }
  const stop = () => {
    clearInterval(timer)
    client.off('pong', pong)
    client.off('close', stop)
  }
  const timer = setInterval(() => {
    if (client.readyState !== WebSocket.OPEN) { stop(); return }
    // 大帧还没收完时不会触发 message；落盘背压会暂停读取 Pong。
    if (client.isPaused || transport.bytesRead !== observedBytes) lastSeen = Date.now()
    observedBytes = transport.bytesRead
    if (Date.now() - lastSeen >= STALE_MS) { stop(); onTimeout(); return }
    client.ping()
  }, INTERVAL_MS)
  timer.unref()
  client.on('pong', pong)
  client.once('close', stop)
  return stop
}
