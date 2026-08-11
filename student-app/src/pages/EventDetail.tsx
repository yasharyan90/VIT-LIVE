// Deep-link target for a single event (/events/:id) — shared from toasts,
// club pages and pushes.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { formatEventTime } from '../lib/time'
import { useToast } from '../lib/toast'
import type { AppEvent } from '../lib/types'
import { EmptyState, PageLoader } from '../components/ui'
import { spring } from '../components/motion'
import { BackIcon } from '../components/Icons'

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [event, setEvent] = useState<AppEvent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    api<{ event: AppEvent }>(`/events/${id}`)
      .then((data) => {
        if (!cancelled) setEvent(data.event)
      })
      .catch(() => {
        if (!cancelled) setEvent(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const toggleRsvp = async () => {
    if (!event) return
    const going = !event.my_rsvp
    setEvent({ ...event, my_rsvp: going, rsvp_count: Math.max(0, event.rsvp_count + (going ? 1 : -1)) })
    try {
      const data = await api<{ rsvp_count: number; my_rsvp: boolean }>(`/events/${event.id}/rsvp`, {
        body: { going },
      })
      setEvent((prev) => (prev ? { ...prev, rsvp_count: data.rsvp_count, my_rsvp: data.my_rsvp } : prev))
    } catch (err) {
      setEvent(event)
      toast(err instanceof Error ? err.message : 'RSVP failed', { kind: 'error' })
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2 px-4 py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-6 w-6" />
        </button>
        <h2 className="text-lg font-bold text-ink">Event</h2>
      </div>

      {!event ? (
        <EmptyState icon="🤷" title="Event not found" subtitle="It may have been removed." />
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          {event.banner_url && (
            <img src={event.banner_url} alt="" className="max-h-64 w-full bg-soft object-cover" />
          )}
          <div className="space-y-3 px-4 pt-4">
            <h3 className="text-xl font-bold text-ink">{event.title}</h3>
            <div className="rounded-xl border border-white/10 bg-soft p-3 text-sm text-ink/80">
              <p className="font-medium text-primary-light">🗓 {formatEventTime(event.start_time)}</p>
              <p className="mt-1">📍 {event.venue}</p>
              {event.club_name && <p className="mt-1">🏷 {event.club_name}</p>}
            </div>
            {event.description && (
              <p className="text-[15px] leading-relaxed text-ink/85">{event.description}</p>
            )}
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-sm text-muted">{event.rsvp_count} going</span>
              <motion.button
                type="button"
                onClick={() => void toggleRsvp()}
                aria-pressed={event.my_rsvp}
                whileTap={{ scale: 0.95 }}
                transition={spring}
                className={`min-h-11 rounded-xl px-5 text-sm font-semibold transition-colors ${
                  event.my_rsvp
                    ? 'border border-success/40 bg-success/10 text-success'
                    : 'bg-primary text-black shadow-sm'
                }`}
              >
                {event.my_rsvp ? "✓ I'm going" : 'RSVP'}
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
