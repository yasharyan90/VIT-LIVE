import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import { useWS } from '../lib/ws'
import type { DeliveryUpdate, EmergencyAlert, WSEnvelope } from '../types'
import { CountUp, EmptyState, Spinner, formatDateTime, inputCls, labelCls } from '../components/ui'

const MAX_LEN = 160

export default function Emergency() {
  const { toast } = useToast()

  const [alerts, setAlerts] = useState<EmergencyAlert[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [message, setMessage] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    api<{ items: EmergencyAlert[] }>('/admin/emergency-alerts')
      .then((data) => setAlerts(data.items))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load alerts'))
  }, [])

  // Live delivery progress via WebSocket
  const onWS = useCallback((msg: WSEnvelope) => {
    if (msg.type === 'delivery.update') {
      const upd = msg.payload as DeliveryUpdate
      if (upd.kind === 'emergency') {
        setAlerts((prev) =>
          prev
            ? prev.map((a) =>
                a.id === upd.ref_id ? { ...a, delivered_count: upd.delivered, total_target: upd.total } : a,
              )
            : prev,
        )
      }
    }
  }, [])
  useWS(onWS)

  const canSend = message.trim().length > 0 && message.length <= MAX_LEN && confirmText === 'CONFIRM' && !sending

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    setSending(true)
    try {
      const data = await api<{ alert: EmergencyAlert }>('/admin/emergency-alerts', {
        method: 'POST',
        body: { message: message.trim(), confirm: 'CONFIRM' },
      })
      setAlerts((prev) => [data.alert, ...(prev ?? [])])
      setMessage('')
      setConfirmText('')
      toast('Emergency alert sent', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send alert', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      {/* Visually isolated red-themed section — the only place red is used */}
      <div className="rounded-2xl border-2 border-emergency/40 bg-emergency-bg overflow-hidden">
        <div className="bg-emergency px-6 py-4">
          <h1 className="text-[22px] font-bold text-white flex items-center gap-2">
            <span aria-hidden>⚠</span> EMERGENCY ALERTS
          </h1>
          <p className="text-sm text-white/80">Super Admin only — use with extreme care</p>
        </div>

        <form onSubmit={send} className="p-6 space-y-4">
          <div>
            <label htmlFor="em-message" className={labelCls}>
              Message
            </label>
            <textarea
              id="em-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
              className={`${inputCls} min-h-24 resize-y border-emergency/30 focus:ring-emergency/40 focus:border-emergency`}
              placeholder="Keep it short and clear — what happened, what to do."
            />
            <p
              className={`mt-1 text-xs font-medium ${message.length >= MAX_LEN ? 'text-emergency' : 'text-neutral-500'}`}
            >
              {message.length} / {MAX_LEN} characters
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-emergency/40 bg-black/40 px-4 py-3">
            <span className="text-emergency text-lg leading-none mt-0.5" aria-hidden>
              ⚠
            </span>
            <p className="text-sm font-medium text-emergency">
              This will immediately notify all students with a full-screen alert
            </p>
          </div>

          <div className="max-w-xs">
            <label htmlFor="em-confirm" className={labelCls}>
              Type <span className="font-mono font-bold">CONFIRM</span> to proceed
            </label>
            <input
              id="em-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={`${inputCls} border-emergency/30 focus:ring-emergency/40 focus:border-emergency font-mono`}
              placeholder="CONFIRM"
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emergency px-5 py-2.5 text-sm font-bold text-white hover:bg-emergency/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? 'Sending…' : 'Send Emergency Alert'}
          </button>
        </form>

        {/* Past alerts with live delivery */}
        <div className="border-t border-emergency/20 px-6 py-5">
          <h2 className="text-[17px] font-semibold text-neutral-900 mb-3">Past Alerts</h2>
          {alerts === null && !listError && <Spinner label="Loading alerts…" />}
          {listError && <p className="text-sm text-neutral-500 py-4">Could not load alerts: {listError}</p>}
          {alerts !== null && alerts.length === 0 && (
            <EmptyState icon="🕊️" title="No emergency alerts sent" hint="Hopefully it stays that way." />
          )}
          <div className="space-y-4">
            {alerts?.map((a) => {
              const pct = a.total_target > 0 ? Math.min(100, (a.delivered_count / a.total_target) * 100) : 0
              return (
                <div key={a.id} className="rounded-xl bg-black/40 border border-emergency/20 p-4">
                  <p className="text-[15px] font-semibold text-neutral-900">{a.message}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Issued by {a.triggered_by_name} · {formatDateTime(a.created_at)}
                  </p>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs font-medium text-neutral-500 mb-1">
                      <span>Live delivery</span>
                      <span className="text-neutral-900 tabular-nums">
                        <CountUp value={a.delivered_count} /> / {a.total_target.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-black/50 border border-emergency/20 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emergency transition-all duration-500 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
