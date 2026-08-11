// Full-screen red takeover (wireframe §4.2). Rendered above everything;
// dismissible only via the acknowledge button. Red is reserved for this.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { ws } from '../lib/ws'
import { formatClock } from '../lib/time'
import type { EmergencyAlert } from '../lib/types'

const LS_ACKED = 'vit_acked_alerts'

function getAckedIds(): string[] {
  try {
    const raw = localStorage.getItem(LS_ACKED)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function addAckedId(id: string) {
  const ids = getAckedIds().filter((x) => x !== id)
  ids.push(id)
  localStorage.setItem(LS_ACKED, JSON.stringify(ids.slice(-25)))
}

export function EmergencyOverlay() {
  const [alert, setAlert] = useState<EmergencyAlert | null>(null)
  const [acking, setAcking] = useState(false)

  // (b) on app load, check for an active alert
  useEffect(() => {
    let cancelled = false
    api<{ alert: EmergencyAlert | null }>('/emergency-alerts/active')
      .then((data) => {
        if (!cancelled && data.alert && !getAckedIds().includes(data.alert.id)) {
          setAlert(data.alert)
        }
      })
      .catch(() => {
        // non-fatal; WS will still deliver live alerts
      })
    return () => {
      cancelled = true
    }
  }, [])

  // (a) live WS alerts
  useEffect(() => {
    return ws.on('emergency.alert', (env) => {
      const a = env.payload as EmergencyAlert
      if (a && a.id && !getAckedIds().includes(a.id)) setAlert(a)
    })
  }, [])

  // Haptic feedback on show
  useEffect(() => {
    if (alert && 'vibrate' in navigator) {
      try {
        navigator.vibrate([300, 100, 300, 100, 300])
      } catch {
        // unsupported
      }
    }
  }, [alert])

  if (!alert) return null

  const acknowledge = async () => {
    setAcking(true)
    // Belt and braces: WS ack frame + REST ack
    ws.send({ type: 'ack', payload: { kind: 'emergency', ref_id: alert.id } })
    try {
      await api<{ delivered_count: number }>(`/emergency-alerts/${alert.id}/ack`, {
        method: 'POST',
      })
    } catch {
      // WS ack already sent; don't trap the user on this screen
    }
    addAckedId(alert.id)
    setAlert(null)
    setAcking(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-emergency px-8 text-center text-white"
      role="alert"
      aria-live="assertive"
      aria-label="Emergency alert"
    >
      <motion.span
        initial={{ scale: 0.5 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 15 }}
        className="text-7xl"
        aria-hidden="true"
      >
        ⚠️
      </motion.span>
      <h1 className="text-3xl font-extrabold tracking-wide">EMERGENCY ALERT</h1>
      <p className="max-w-sm text-lg font-medium leading-relaxed">{alert.message}</p>
      <div className="text-sm text-white/90">
        <p>Issued by: {alert.triggered_by_name}</p>
        <p>{formatClock(alert.created_at)}</p>
      </div>
      <button
        type="button"
        onClick={acknowledge}
        disabled={acking}
        className="mt-4 min-h-14 w-full max-w-sm rounded-2xl bg-white px-6 text-lg font-bold text-emergency shadow-xl active:scale-[0.98] disabled:opacity-70"
      >
        {acking ? 'Sending…' : "I'm Safe — Acknowledge"}
      </button>
    </motion.div>
  )
}
