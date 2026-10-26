// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import WebSocket from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { maintainClientHeartbeat } from './heartbeat.js'

afterEach(() => vi.useRealTimers())

function fixture() {
  vi.useFakeTimers()
  const peer = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, isPaused: false, ping: vi.fn() })
  const transport = { bytesRead: 0 }
  const timeout = vi.fn()
  const stop = maintainClientHeartbeat(peer as unknown as WebSocket, transport as Socket, timeout)
  return { peer, transport, timeout, stop }
}

it('场景-007-07：等待超过两分钟持续 Ping/Pong，不提交业务消息', () => {
  const { peer, timeout, stop } = fixture()
  for (let i = 0; i < 6; i++) {
    vi.advanceTimersByTime(25_000)
    expect(peer.ping).toHaveBeenCalledTimes(i + 1)
    peer.emit('pong')
  }
  expect(timeout).not.toHaveBeenCalled()
  stop()
  expect(vi.getTimerCount()).toBe(0)
  expect(peer.listenerCount('pong')).toBe(0)
})

it('场景-007-08：失联 75 秒只触发一次清理并停止定时器', () => {
  const { peer, timeout } = fixture()
  vi.advanceTimersByTime(74_999)
  expect(timeout).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(timeout).toHaveBeenCalledOnce()
  expect(peer.ping).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(100_000)
  expect(timeout).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('场景-007-08：慢速大帧有字节进展和落盘暂停不误杀，关闭即清理', () => {
  const { peer, transport, timeout } = fixture()
  for (let i = 0; i < 6; i++) {
    transport.bytesRead += 100
    vi.advanceTimersByTime(25_000)
  }
  peer.isPaused = true
  vi.advanceTimersByTime(150_000)
  expect(timeout).not.toHaveBeenCalled()
  peer.isPaused = false
  peer.emit('close')
  vi.advanceTimersByTime(100_000)
  expect(timeout).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
