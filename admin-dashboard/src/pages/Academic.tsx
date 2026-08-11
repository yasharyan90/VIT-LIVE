// Academic calendar (super admin): a real month calendar. Click any date to
// write events on it — exams, holidays, deadlines — visible to every student.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import type { AcademicEvent } from '../types'
import { Card, PageTitle, Spinner, inputCls, labelCls, primaryBtnCls } from '../components/ui'

const KIND_LABELS: Record<AcademicEvent['kind'], string> = {
  exam: '📝 Exam',
  holiday: '🏖 Holiday',
  deadline: '⏰ Deadline',
  other: '📌 Other',
}

const KIND_CHIP: Record<AcademicEvent['kind'], string> = {
  exam: 'border-warning/40 bg-warning/10 text-warning',
  holiday: 'border-success/40 bg-success/10 text-success',
  deadline: 'border-white/25 bg-white/10 text-neutral-900',
  other: 'border-white/15 bg-white/5 text-neutral-500',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** All cells of the month view: leading/trailing nulls pad to full Mon-first weeks. */
function monthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday-first offset
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function occursOn(e: AcademicEvent, date: string): boolean {
  return e.starts_on <= date && date <= (e.ends_on ?? e.starts_on)
}

export default function Academic() {
  const { toast } = useToast()
  const now = new Date()
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [direction, setDirection] = useState(0)
  const [events, setEvents] = useState<AcademicEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>(ymd(now))

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<AcademicEvent['kind']>('exam')
  const [endsOn, setEndsOn] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const monthStart = ymd(new Date(view.y, view.m, 1))
  const monthEnd = ymd(new Date(view.y, view.m + 1, 0))

  const load = useCallback(() => {
    setLoading(true)
    api<{ items: AcademicEvent[] }>(`/academic-events?from=${monthStart}&to=${monthEnd}`)
      .then((data) => setEvents(data.items))
      .catch((err) => toast(err instanceof Error ? err.message : 'Failed to load calendar', 'error'))
      .finally(() => setLoading(false))
  }, [monthStart, monthEnd, toast])

  useEffect(load, [load])

  const cells = useMemo(() => monthCells(view.y, view.m), [view])
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

  const goToday = () => {
    const t = new Date()
    setDirection(0)
    setView({ y: t.getFullYear(), m: t.getMonth() })
    setSelected(ymd(t))
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || saving) return
    if (endsOn && endsOn < selected) {
      toast('End date is before the selected start date', 'error')
      return
    }
    setSaving(true)
    try {
      const data = await api<{ event: AcademicEvent }>('/admin/academic-events', {
        method: 'POST',
        body: {
          title: title.trim(),
          kind,
          starts_on: selected,
          ...(endsOn ? { ends_on: endsOn } : {}),
        },
      })
      setEvents((prev) => [...prev, data.event].sort((a, b) => a.starts_on.localeCompare(b.starts_on)))
      setTitle('')
      setEndsOn('')
      toast(`Added to ${selected}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to add', 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (ev: AcademicEvent) => {
    if (!window.confirm(`Delete "${ev.title}"?`)) return
    setDeletingId(ev.id)
    try {
      await api<{ message: string }>(`/admin/academic-events/${ev.id}`, { method: 'DELETE' })
      setEvents((prev) => prev.filter((i) => i.id !== ev.id))
      toast('Deleted', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <PageTitle sub="Click a date, write the event — every student sees it under Events → Academic">
        Academic Calendar
      </PageTitle>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-4 items-start">
        {/* ---- Month grid ---- */}
        <Card className="p-5 overflow-hidden">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[17px] font-semibold text-neutral-900">{monthTitle}</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToday}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-white/5 transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => shift(-1)}
                aria-label="Previous month"
                className="h-8 w-8 rounded-lg border border-white/15 text-neutral-900 hover:bg-white/5 transition-colors"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => shift(1)}
                aria-label="Next month"
                className="h-8 w-8 rounded-lg border border-white/15 text-neutral-900 hover:bg-white/5 transition-colors"
              >
                ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-2">
                {d}
              </div>
            ))}
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${view.y}-${view.m}`}
              initial={{ opacity: 0, x: direction * 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -32 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="grid grid-cols-7 gap-px rounded-xl bg-white/10 overflow-hidden border border-white/10"
            >
              {cells.map((date, i) => {
                if (!date) return <div key={`pad-${i}`} className="min-h-24 bg-surface/60" />
                const dstr = ymd(date)
                const dayEvents = events.filter((e) => occursOn(e, dstr))
                const isSelected = dstr === selected
                const isToday = dstr === todayStr
                return (
                  <button
                    type="button"
                    key={dstr}
                    onClick={() => setSelected(dstr)}
                    className={`min-h-24 bg-surface p-1.5 text-left align-top transition-colors hover:bg-white/5 ${
                      isSelected ? 'bg-white/10 hover:bg-white/10' : ''
                    }`}
                    aria-label={`${dstr}, ${dayEvents.length} event(s)`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        isToday ? 'bg-primary text-black' : isSelected ? 'text-neutral-900' : 'text-neutral-500'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 3).map((e) => (
                        <div
                          key={e.id}
                          className={`truncate rounded border px-1 py-0.5 text-[10px] font-semibold leading-tight ${KIND_CHIP[e.kind]}`}
                          title={e.title}
                        >
                          {e.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] font-semibold text-neutral-500">+{dayEvents.length - 3} more</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </motion.div>
          </AnimatePresence>
          {loading && <Spinner label="Loading…" />}
        </Card>

        {/* ---- Selected-day panel ---- */}
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-neutral-900">
            {new Date(selected + 'T00:00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h2>

          <div className="mt-3 space-y-2">
            {selectedEvents.length === 0 && <p className="text-sm text-neutral-500">Nothing on this day yet.</p>}
            <AnimatePresence initial={false}>
              {selectedEvents.map((ev) => (
                <motion.div
                  key={ev.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_CHIP[ev.kind]}`}
                    >
                      {ev.kind}
                    </span>
                    <p className="mt-1 text-sm font-semibold text-neutral-900">{ev.title}</p>
                    {ev.ends_on && ev.ends_on !== ev.starts_on && (
                      <p className="text-xs text-neutral-500">
                        {ev.starts_on} → {ev.ends_on}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(ev)}
                    disabled={deletingId === ev.id}
                    aria-label={`Delete ${ev.title}`}
                    className="shrink-0 rounded px-1.5 py-0.5 text-neutral-500 hover:text-emergency disabled:opacity-50 transition-colors"
                  >
                    ✕
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <form onSubmit={create} className="mt-5 space-y-3 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Add on this date</p>
            <div>
              <label htmlFor="ac-title" className={labelCls}>
                Event
              </label>
              <input
                id="ac-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputCls}
                placeholder="e.g. CAT-1 Examinations"
                maxLength={200}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="ac-kind" className={labelCls}>
                  Kind
                </label>
                <select
                  id="ac-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AcademicEvent['kind'])}
                  className={inputCls}
                >
                  {(Object.keys(KIND_LABELS) as AcademicEvent['kind'][]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor="ac-end" className={labelCls}>
                  Until (optional)
                </label>
                <input
                  id="ac-end"
                  type="date"
                  min={selected}
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <button type="submit" disabled={!title.trim() || saving} className={`${primaryBtnCls} w-full`}>
              {saving ? 'Adding…' : `Add to ${selected}`}
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}
