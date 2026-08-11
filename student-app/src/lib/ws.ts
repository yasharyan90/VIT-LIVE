// WebSocket manager: single connection, auto-reconnect with backoff,
// per-type subscribers, reconciliation hooks (App Flow §8).

import { getAccessToken } from './api'

export interface Envelope {
  type: string
  topic: string
  payload: unknown
  ts: string
  id: string
}

export type EnvelopeHandler = (env: Envelope) => void

const LS_LAST_SEEN = 'vit_last_seen'

export function getLastSeen(): string | null {
  return localStorage.getItem(LS_LAST_SEEN)
}

export function bumpLastSeen(ts: string) {
  const cur = getLastSeen()
  if (!cur || new Date(ts).getTime() > new Date(cur).getTime()) {
    localStorage.setItem(LS_LAST_SEEN, ts)
  }
}

class WSManager {
  private socket: WebSocket | null = null
  private handlers = new Map<string, Set<EnvelopeHandler>>()
  private openHandlers = new Set<() => void>()
  private statusHandlers = new Set<(connected: boolean) => void>()
  private attempts = 0
  private timer: number | null = null
  private running = false

  connected = false

  start() {
    if (this.running) return
    this.running = true
    this.attempts = 0
    this.open()
  }

  stop() {
    this.running = false
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    if (this.socket) {
      const s = this.socket
      this.socket = null
      s.onclose = null
      s.close()
    }
    this.setConnected(false)
  }

  private setConnected(v: boolean) {
    if (this.connected !== v) {
      this.connected = v
      this.statusHandlers.forEach((h) => h(v))
    }
  }

  private open() {
    const token = getAccessToken()
    if (!this.running || !token) {
      // No token yet (e.g. refresh in flight) — retry shortly.
      if (this.running) this.scheduleReconnect()
      return
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    let sock: WebSocket
    try {
      sock = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = sock

    sock.onopen = () => {
      this.attempts = 0
      this.setConnected(true)
      this.openHandlers.forEach((h) => h())
    }
    sock.onmessage = (ev) => {
      try {
        const env = JSON.parse(ev.data as string) as Envelope
        if (env && typeof env.type === 'string') this.dispatch(env)
      } catch {
        // ignore malformed frames
      }
    }
    sock.onclose = () => {
      if (this.socket === sock) this.socket = null
      this.setConnected(false)
      if (this.running) this.scheduleReconnect()
    }
    sock.onerror = () => {
      sock.close()
    }
  }

  private scheduleReconnect() {
    if (this.timer !== null) return
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts)
    this.attempts += 1
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.open()
    }, delay)
  }

  /** Dispatch an envelope to subscribers (also used to inject reconciled items). */
  dispatch(env: Envelope) {
    if (env.ts) bumpLastSeen(env.ts)
    if (env.type === 'announcement.new') {
      const id = (env.payload as { id?: string } | null)?.id
      if (id) this.send({ type: 'ack', payload: { kind: 'announcement', ref_id: id } })
    }
    this.handlers.get(env.type)?.forEach((h) => h(env))
  }

  send(frame: { type: string; topic?: string; payload?: unknown }) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame))
    }
  }

  on(type: string, handler: EnvelopeHandler): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler)
    return () => this.openHandlers.delete(handler)
  }

  onStatus(handler: (connected: boolean) => void): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }
}

export const ws = new WSManager()
