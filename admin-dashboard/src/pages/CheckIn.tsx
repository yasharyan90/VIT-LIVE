// Door check-in: club accounts (and super/dept admins) scan student ticket
// QRs to grant entry. Camera scanning uses the native BarcodeDetector where
// available (Chrome/Edge/Android); the code under every QR works everywhere.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api, ApiError } from '../lib/api'
import type { Ticket } from '../types'
import { Card, PageTitle, formatDateTime, inputCls, primaryBtnCls } from '../components/ui'

interface ScanResult {
  key: number
  ok: boolean
  message: string
  ticket?: Ticket
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => {
      detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
    }
  }
}

export default function CheckIn() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ScanResult[]>([])
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const keyRef = useRef(0)

  const canScan = typeof window !== 'undefined' && !!window.BarcodeDetector

  const checkIn = useCallback(async (rawCode: string) => {
    const trimmed = rawCode.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const data = await api<{ ticket: Ticket }>('/admin/tickets/checkin', {
        method: 'POST',
        body: { code: trimmed },
      })
      setResults((prev) => [
        { key: ++keyRef.current, ok: true, message: 'Entry granted', ticket: data.ticket },
        ...prev.slice(0, 14),
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Check-in failed'
      const ticket = err instanceof ApiError && (err as ApiError & { body?: { ticket?: Ticket } }).body?.ticket
      setResults((prev) => [
        { key: ++keyRef.current, ok: false, message, ticket: ticket || undefined },
        ...prev.slice(0, 14),
      ])
    } finally {
      setBusy(false)
    }
  }, [])

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    void checkIn(code)
    setCode('')
  }

  // Camera scan loop (BarcodeDetector).
  useEffect(() => {
    if (!cameraOn) return
    let raf = 0
    let cancelled = false
    const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
        const tick = async () => {
          if (cancelled) return
          const video = videoRef.current
          if (detector && video && video.readyState >= 2) {
            try {
              const codes = await detector.detect(video)
              const value = codes[0]?.rawValue
              // Debounce: don't re-fire the same QR within 4 seconds.
              if (value && (value !== lastScanRef.current.code || Date.now() - lastScanRef.current.at > 4000)) {
                lastScanRef.current = { code: value, at: Date.now() }
                void checkIn(value)
              }
            } catch {
              // detector hiccup — keep scanning
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => setCameraError('Camera unavailable — allow camera access or type the code below.'))

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [cameraOn, checkIn])

  return (
    <div>
      <PageTitle sub="Scan a ticket QR (or type its code) to grant entry">Check-in</PageTitle>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-neutral-900">Camera scanner</h2>
              <button
                type="button"
                onClick={() => {
                  setCameraError(null)
                  setCameraOn((v) => !v)
                }}
                className={primaryBtnCls}
                disabled={!canScan && !cameraOn}
              >
                {cameraOn ? 'Stop camera' : 'Start camera'}
              </button>
            </div>
            {!canScan && (
              <p className="mt-3 text-sm text-neutral-500">
                This browser can't scan QR codes natively (try Chrome). Manual entry below works everywhere.
              </p>
            )}
            {cameraError && <p className="mt-3 text-sm text-warning">{cameraError}</p>}
            {cameraOn && (
              <div className="relative mt-4 overflow-hidden rounded-xl border border-white/10 bg-black">
                <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="h-44 w-44 rounded-2xl border-2 border-white/70" aria-hidden />
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-neutral-900 mb-3">Manual entry</h2>
            <form onSubmit={submitManual} className="flex gap-3">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${inputCls} font-mono`}
                placeholder="Ticket code (full, or from under the QR)"
                aria-label="Ticket code"
              />
              <button type="submit" disabled={!code.trim() || busy} className={primaryBtnCls}>
                {busy ? 'Checking…' : 'Check in'}
              </button>
            </form>
            <p className="mt-2 text-xs text-neutral-500">
              Club accounts can only check in tickets for their own club's events.
            </p>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-3">Scans</h2>
          {results.length === 0 && <p className="text-sm text-neutral-500">Scan results appear here.</p>}
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {results.map((r) => (
                <motion.div
                  key={r.key}
                  layout
                  initial={{ opacity: 0, y: -10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className={`rounded-xl border p-4 ${
                    r.ok ? 'border-success/40 bg-success/10' : 'border-emergency/40 bg-emergency/10'
                  }`}
                  role="status"
                >
                  <p className={`text-sm font-bold ${r.ok ? 'text-success' : 'text-emergency'}`}>
                    {r.ok ? '✓ ' : '✕ '}
                    {r.message}
                  </p>
                  {r.ticket && (
                    <div className="mt-1 text-sm text-neutral-900">
                      <p className="font-semibold">{r.ticket.attendee_name}</p>
                      <p className="text-neutral-500">
                        {r.ticket.event_title}
                        {r.ticket.checked_in_at ? ` · entered ${formatDateTime(r.ticket.checked_in_at)}` : ''}
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Card>
      </div>
    </div>
  )
}
