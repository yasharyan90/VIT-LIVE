import { useEffect } from 'react'
import { getAccessToken } from './api'
import type { WSEnvelope } from '../types'

type Listener = (msg: WSEnvelope) => void

/**
 * Singleton WebSocket client with auto-reconnect + exponential backoff.
 * Connects to /ws?token=<access_token> through the Vite proxy.
 */
class WSClient {
  private socket: WebSocket | null = null
  private listeners = new Set<Listener>()
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldRun = false

  start() {
    if (this.shouldRun) return
    this.shouldRun = true
    this.connect()
  }

  stop() {
    this.shouldRun = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempt = 0
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close()
      this.socket = null
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  send(frame: { type: string; topic?: string; payload?: unknown }) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame))
    }
  }

  private connect() {
    if (!this.shouldRun) return
    const token = getAccessToken()
    if (!token) {
      this.scheduleReconnect()
      return
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`
    try {
      this.socket = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.socket.onopen = () => {
      this.reconnectAttempt = 0
    }

    this.socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WSEnvelope
        if (msg && typeof msg.type === 'string') {
          this.listeners.forEach((fn) => fn(msg))
        }
      } catch {
        // ignore malformed frames
      }
    }

    this.socket.onclose = () => {
      this.socket = null
      this.scheduleReconnect()
    }

    this.socket.onerror = () => {
      // onclose will follow and handle the reconnect
    }
  }

  private scheduleReconnect() {
    if (!this.shouldRun || this.reconnectTimer) return
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

export const wsClient = new WSClient()

/** Subscribe a handler to all incoming WS envelopes for the component's lifetime. */
export function useWS(handler: Listener) {
  useEffect(() => wsClient.subscribe(handler), [handler])
}
