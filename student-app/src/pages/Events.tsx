// Events tab: Upcoming / My RSVPs sub-tabs, optimistic RSVP toggle,
// live prepend on `event.new`.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { ws } from '../lib/ws'
import { formatEventTime } from '../lib/time'
import { formatPrice } from '../lib/payments'
import { useToast } from '../lib/toast'
import type { AcademicEvent, AppEvent } from '../lib/types'
import { Chip, EmptyState, PageLoader, SubTabs } from '../components/ui'
import { MotionItem, MotionList, spring } from '../components/motion'
import { AnimatePresence, motion } from 'framer-motion'

const KIND_META: Record<AcademicEvent['kind'], { icon: string; color: 'amber' | 'green' | 'blue' | 'gray'; dot: string }> = {
  exam: { icon: '📝', color: 'amber', dot: 'bg-warning' },
  holiday: { icon: '🏖', color: 'green', dot: 'bg-success' },
  deadline: { icon: '⏰', color: 'blue', dot: 'bg-primary' },
  other: { icon: '📌', color: 'gray', dot: 'bg-muted' },
}

function formatDateRange(startsOn: string, endsOn: string | null): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return endsOn && endsOn !== startsOn ? `${fmt(startsOn)} – ${fmt(endsOn)}` : fmt(startsOn)
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Month cells, Monday-first, padded with nulls to whole weeks. */
function monthCells(year: number, month: number): (Date | null)[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function occursOn(e: AcademicEvent, date: string): boolean {
  return e.starts_on <= date && date <= (e.ends_on ?? e.starts_on)
}

function AcademicCalendar() {
  const now = new Date()
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [direction, setDirection] = useState(0)
  const [events, setEvents] = useState<AcademicEvent[]>([])
  const [selected, setSelected] = useState(ymd(now))
  const [loading, setLoading] = useState(true)

  const from = ymd(new Date(view.y, view.m, 1))
  const to = ymd(new Date(view.y, view.m + 1, 0))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<{ items: AcademicEvent[] }>(`/academic-events?from=${from}&to=${to}`)
      .then((data) => {
        if (!cancelled) setEvents(data.items)
      })
      .catch(() => {
        // non-fatal
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const cells = monthCells(view.y, view.m)
  const todayStr = ymd(new Date())
  const selectedEvents = events.filter((e) => occursOn(e, selected))
  const monthTitle = new Date(view.y, view.m, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const shift = (delta: number) => {
    setDirection(delta)
    setView(({ y, m }) => {
      const d = new Date(y, m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  return (
    <div className="mt-3">
      <div className="rounded-2xl border border-white/10 bg-soft/60 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-[15px] font-bold text-ink">{monthTitle}</h3>
          <div className="flex gap-1">
            <motion.button
              type="button"
              onClick={() => shift(-1)}
              whileTap={{ scale: 0.9 }}
              transition={spring}
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-white/10"
            >
              ‹
            </motion.button>
            <motion.button
              type="button"
              onClick={() => shift(1)}
              whileTap={{ scale: 0.9 }}
              transition={spring}
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-white/10"
            >
              ›
            </motion.button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wide text-muted">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="pb-1">
              {d}
            </span>
          ))}
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${view.y}-${view.m}`}
            initial={{ opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -28 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="grid grid-cols-7"
          >
            {cells.map((date, i) => {
              if (!date) return <span key={`pad-${i}`} className="h-12" />
              const dstr = ymd(date)
              const dayEvents = events.filter((e) => occursOn(e, dstr))
              const isSelected = dstr === selected
              const isToday = dstr === todayStr
              return (
                <button
                  type="button"
                  key={dstr}
                  onClick={() => setSelected(dstr)}
                  aria-label={`${dstr}, ${dayEvents.length} event(s)`}
                  aria-pressed={isSelected}
                  className="relative flex h-12 flex-col items-center justify-center"
                >
                  {isSelected && (
                    <motion.span
                      layoutId="cal-selected"
                      transition={spring}
                      className="absolute inset-1 rounded-xl bg-white/10"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`relative flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                      isToday ? 'bg-primary text-black' : isSelected ? 'text-ink' : 'text-ink/70'
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  <span className="relative mt-0.5 flex h-1.5 gap-0.5" aria-hidden="true">
                    {dayEvents.slice(0, 3).map((e) => (
                      <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${KIND_META[e.kind].dot}`} />
                    ))}
                  </span>
                </button>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Selected day */}
      <h4 className="mb-2 mt-4 text-sm font-bold uppercase tracking-wide text-muted">
        {new Date(selected + 'T00:00:00').toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </h4>
      {loading ? (
        <PageLoader />
      ) : selectedEvents.length === 0 ? (
        <p className="px-1 text-sm text-muted">Nothing on this day.</p>
      ) : (
        <MotionList className="space-y-2">
          {selectedEvents.map((e) => (
            <MotionItem
              key={e.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-soft/60 p-3"
            >
              <span className="text-xl grayscale" aria-hidden="true">
                {KIND_META[e.kind].icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{e.title}</p>
                <p className="text-sm text-muted">{formatDateRange(e.starts_on, e.ends_on)}</p>
              </div>
              <Chip color={KIND_META[e.kind].color}>{e.kind}</Chip>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </div>
  )
}

export function EventsPage() {
  const toast = useToast()
  const [tab, setTab] = useState<'upcoming' | 'mine' | 'academic'>('upcoming')
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    api<{ items: AppEvent[] }>('/events')
      .then((data) => {
        if (!cancelled) setEvents(data.items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load events')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return ws.on('event.new', (env) => {
      const event = env.payload as AppEvent
      if (!event || !event.id) return
      setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev]))
      setFreshIds((prev) => new Set(prev).add(event.id))
      window.setTimeout(() => {
        setFreshIds((prev) => {
          const next = new Set(prev)
          next.delete(event.id)
          return next
        })
      }, 1000)
    })
  }, [])

  const toggleRsvp = async (event: AppEvent) => {
    const going = !event.my_rsvp
    // Optimistic update
    setEvents((prev) =>
      prev.map((e) =>
        e.id === event.id
          ? { ...e, my_rsvp: going, rsvp_count: Math.max(0, e.rsvp_count + (going ? 1 : -1)) }
          : e,
      ),
    )
    try {
      const data = await api<{ rsvp_count: number; my_rsvp: boolean }>(
        `/events/${event.id}/rsvp`,
        { body: { going } },
      )
      setEvents((prev) =>
        prev.map((e) =>
          e.id === event.id ? { ...e, rsvp_count: data.rsvp_count, my_rsvp: data.my_rsvp } : e,
        ),
      )
    } catch (err) {
      // Revert on failure
      setEvents((prev) =>
        prev.map((e) =>
          e.id === event.id
            ? { ...e, my_rsvp: event.my_rsvp, rsvp_count: event.rsvp_count }
            : e,
        ),
      )
      toast(err instanceof Error ? err.message : 'RSVP failed', { kind: 'error' })
    }
  }

  const visible = tab === 'mine' ? events.filter((e) => e.my_rsvp) : events

  return (
    <div className="px-4 py-4">
      <h2 className="mb-3 text-lg font-bold text-ink">Events</h2>
      <SubTabs
        tabs={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'mine', label: 'My RSVPs' },
          { value: 'academic', label: 'Academic' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'academic' ? (
        <AcademicCalendar />
      ) : (
        <>
      {error && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <PageLoader />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={tab === 'mine' ? '🎟️' : '🎉'}
          title={tab === 'mine' ? "You haven't RSVP'd yet" : 'No upcoming events'}
          subtitle={
            tab === 'mine'
              ? 'Tap RSVP on an event and it will show up here.'
              : 'When clubs and departments schedule events, they will appear here.'
          }
        />
      ) : (
        <MotionList className="mt-3 space-y-3">
          {visible.map((event) => (
            <MotionItem
              key={event.id}
              className={`overflow-hidden rounded-2xl border border-white/10 bg-soft/60 ${
                freshIds.has(event.id) ? 'animate-slide-fade' : ''
              }`}
            >
              {event.banner_url && (
                <img src={event.banner_url} alt="" className="h-36 w-full bg-soft object-cover" />
              )}
              <div className="p-4">
                <Link to={`/events/${event.id}`} className="block">
                  <h3 className="text-[17px] font-semibold text-ink">{event.title}</h3>
                </Link>
                <p className="mt-1 text-sm font-medium text-primary-light">
                  🗓 {formatEventTime(event.start_time)}
                </p>
                <p className="mt-0.5 text-sm text-muted">📍 {event.venue}</p>
                {event.club_name && <p className="mt-0.5 text-sm text-muted">🏷 {event.club_name}</p>}
                {event.description && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink/75">
                    {event.description}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-muted">
                    {event.rsvp_count} going
                  </span>
                  {event.price_cents > 0 ? (
                    <Link
                      to={`/events/${event.id}`}
                      className={`flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold transition-colors ${
                        event.my_ticket_status
                          ? 'border border-success/40 bg-success/10 text-success'
                          : 'bg-primary text-black shadow-sm'
                      }`}
                    >
                      {event.my_ticket_status ? '🎟 View ticket' : `🎟 ${formatPrice(event.price_cents)}`}
                    </Link>
                  ) : (
                    <motion.button
                      type="button"
                      onClick={() => void toggleRsvp(event)}
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
                  )}
                </div>
              </div>
            </MotionItem>
          ))}
        </MotionList>
      )}
        </>
      )}
    </div>
  )
}
