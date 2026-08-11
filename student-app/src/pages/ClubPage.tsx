// Club detail page (/clubs/:id): profile, follow toggle, the club's
// announcements and upcoming events.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { ws } from '../lib/ws'
import { relTime, formatEventTime } from '../lib/time'
import { useToast } from '../lib/toast'
import type { Announcement, AppEvent, Club } from '../lib/types'
import { EmptyState, PageLoader } from '../components/ui'
import { MotionItem, MotionList, spring } from '../components/motion'
import { BackIcon } from '../components/Icons'

export function ClubPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [club, setClub] = useState<Club | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    api<{ club: Club; announcements: Announcement[]; events: AppEvent[] }>(`/clubs/${id}`)
      .then((data) => {
        if (cancelled) return
        setClub(data.club)
        setAnnouncements(data.announcements)
        setEvents(data.events)
      })
      .catch(() => {
        if (!cancelled) setClub(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const toggleFollow = async () => {
    if (!club || busy) return
    setBusy(true)
    const action = club.is_following ? 'unfollow' : 'follow'
    try {
      const data = await api<{ club: Club }>(`/clubs/${club.id}/${action}`, { method: 'POST' })
      setClub(data.club)
      ws.send({ type: action === 'follow' ? 'subscribe' : 'unsubscribe', topic: `club:${club.id}` })
    } catch (err) {
      toast(err instanceof Error ? err.message : `Could not ${action}`, { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="px-4 py-4 pb-8">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-6 w-6" />
        </button>
        <h2 className="text-lg font-bold text-ink">Club</h2>
      </div>

      {!club ? (
        <EmptyState icon="🤷" title="Club not found" />
      ) : (
        <>
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="rounded-2xl border border-white/10 bg-soft/60 p-4"
          >
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl"
              >
                🎭
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-bold text-ink">{club.name}</h3>
                <p className="text-sm text-muted">
                  {club.member_count} member{club.member_count === 1 ? '' : 's'}
                </p>
              </div>
              <motion.button
                type="button"
                onClick={() => void toggleFollow()}
                disabled={busy}
                aria-pressed={club.is_following}
                whileTap={{ scale: 0.95 }}
                transition={spring}
                className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60 ${
                  club.is_following
                    ? 'border border-white/15 text-ink'
                    : 'bg-primary text-black shadow-sm'
                }`}
              >
                {club.is_following ? 'Following ✓' : 'Follow'}
              </motion.button>
            </div>
            {club.description && <p className="mt-3 text-sm leading-relaxed text-ink/75">{club.description}</p>}
          </motion.section>

          <section className="mt-5" aria-label="Upcoming club events">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Upcoming events</h3>
            {events.length === 0 ? (
              <p className="px-1 text-sm text-muted">No upcoming events from this club.</p>
            ) : (
              <MotionList className="space-y-2">
                {events.map((e) => (
                  <MotionItem key={e.id}>
                    <Link
                      to={`/events/${e.id}`}
                      className="block rounded-2xl border border-white/10 bg-soft/60 p-3 active:bg-white/5"
                    >
                      <p className="font-semibold text-ink">{e.title}</p>
                      <p className="mt-0.5 text-sm text-primary-light">🗓 {formatEventTime(e.start_time)}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        📍 {e.venue} · {e.rsvp_count} going
                      </p>
                    </Link>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </section>

          <section className="mt-5" aria-label="Club announcements">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Announcements</h3>
            {announcements.length === 0 ? (
              <p className="px-1 text-sm text-muted">Nothing posted by this club yet.</p>
            ) : (
              <MotionList className="space-y-2">
                {announcements.map((a) => (
                  <MotionItem key={a.id} className="rounded-2xl border border-white/10 bg-soft/60 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="font-semibold text-ink">{a.title}</h4>
                      <span className="shrink-0 text-xs text-muted">{relTime(a.created_at)}</span>
                    </div>
                    {a.image_url && (
                      <img
                        src={a.image_url}
                        alt=""
                        className="mt-2 max-h-56 w-full rounded-xl border border-white/10 bg-black object-cover"
                      />
                    )}
                    <p className="mt-1 text-sm leading-relaxed text-ink/80">{a.body}</p>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </section>
        </>
      )}
    </div>
  )
}
