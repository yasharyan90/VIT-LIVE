// A ticket with its QR code — shown on the event page after purchase.
// The QR encodes the ticket's opaque secret; the club account scans it at
// the door. White card on purpose: QR codes need a light background.

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import QRCode from 'qrcode'
import type { Ticket } from '../lib/types'
import { formatEventTime } from '../lib/time'

export function TicketCard({ ticket }: { ticket: Ticket }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, ticket.code, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {
      // canvas stays blank; the short code below still works for manual entry
    })
  }, [ticket.code])

  const checkedIn = ticket.status === 'checked_in'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className="overflow-hidden rounded-2xl bg-white text-black shadow-xl shadow-black/40"
    >
      <div className="flex items-center justify-between bg-black px-4 py-2.5 text-white">
        <span className="text-sm font-bold tracking-tight">
          VIT<span className="text-white/50"> Live</span> · Ticket
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
            checkedIn ? 'bg-white/15 text-white/70' : 'bg-success/20 text-success'
          }`}
        >
          {checkedIn ? 'Checked in ✓' : 'Valid'}
        </span>
      </div>

      <div className="flex flex-col items-center px-4 py-5">
        <canvas
          ref={canvasRef}
          className={checkedIn ? 'opacity-30 grayscale' : ''}
          aria-label="Ticket QR code — show this at the entrance"
        />
        <p className="mt-2 font-mono text-sm font-bold tracking-[0.25em] text-black/60">
          {ticket.code.slice(0, 8).toUpperCase()}
        </p>
      </div>

      <div className="border-t border-dashed border-black/20 px-5 py-4">
        <p className="text-[15px] font-bold leading-snug">{ticket.event_title}</p>
        <p className="mt-0.5 text-sm text-black/60">
          🗓 {formatEventTime(ticket.start_time)} · 📍 {ticket.venue}
        </p>
        <p className="mt-1 text-sm text-black/60">
          🎟 {ticket.attendee_name} · ₹{(ticket.amount_cents / 100).toLocaleString('en-IN')}
        </p>
        {checkedIn && ticket.checked_in_at && (
          <p className="mt-1 text-xs text-black/40">
            Entered at {new Date(ticket.checked_in_at).toLocaleTimeString()}
          </p>
        )}
      </div>
    </motion.div>
  )
}
