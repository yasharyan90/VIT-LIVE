import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import type { AppEvent, Club } from '../types'
import {
  Card,
  EmptyState,
  PageTitle,
  Spinner,
  formatDateTime,
  inputCls,
  labelCls,
  primaryBtnCls,
} from '../components/ui'

/** Convert a datetime-local input value to RFC3339 with local timezone offset. */
function toRFC3339(local: string): string {
  const d = new Date(local)
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const offH = pad(Math.floor(Math.abs(offsetMin) / 60))
  const offM = pad(Math.abs(offsetMin) % 60)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${offH}:${offM}`
  )
}

export default function Events() {
  const { toast } = useToast()

  const [events, setEvents] = useState<AppEvent[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [clubs, setClubs] = useState<Club[]>([])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [venue, setVenue] = useState('')
  const [startTime, setStartTime] = useState('')
  const [clubId, setClubId] = useState('')
  const [banner, setBanner] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api<{ items: AppEvent[] }>('/admin/events')
      .then((data) => setEvents(data.items))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load events'))
    api<{ items: Club[] }>('/clubs')
      .then((data) => setClubs(data.items))
      .catch(() => {
        /* club select stays empty */
      })
  }, [])

  const formValid = title.trim() && description.trim() && venue.trim() && startTime

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!formValid || creating) return
    setCreating(true)
    try {
      const fd = new FormData()
      fd.append('title', title.trim())
      fd.append('description', description.trim())
      fd.append('venue', venue.trim())
      fd.append('start_time', toRFC3339(startTime))
      if (clubId) fd.append('club_id', clubId)
      if (banner) fd.append('banner', banner)

      const data = await api<{ event: AppEvent }>('/admin/events', { method: 'POST', formData: fd })
      setEvents((prev) => [data.event, ...(prev ?? [])])
      setTitle('')
      setDescription('')
      setVenue('')
      setStartTime('')
      setClubId('')
      setBanner(null)
      if (fileRef.current) fileRef.current.value = ''
      toast('Event created', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create event', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <PageTitle sub="Create campus events and track RSVPs">Events</PageTitle>

      <Card className="p-6 mb-8">
        <h2 className="text-[17px] font-semibold text-neutral-900 mb-4">New Event</h2>
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ev-title" className={labelCls}>
                Title
              </label>
              <input
                id="ev-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputCls}
                placeholder="e.g. Robotics Club Fest"
              />
            </div>
            <div>
              <label htmlFor="ev-venue" className={labelCls}>
                Venue
              </label>
              <input
                id="ev-venue"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className={inputCls}
                placeholder="e.g. Main Auditorium"
              />
            </div>
          </div>
          <div>
            <label htmlFor="ev-desc" className={labelCls}>
              Description
            </label>
            <textarea
              id="ev-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputCls} min-h-24 resize-y`}
              placeholder="What's happening?"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="ev-start" className={labelCls}>
                Starts at
              </label>
              <input
                id="ev-start"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="ev-club" className={labelCls}>
                Club <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <select id="ev-club" value={clubId} onChange={(e) => setClubId(e.target.value)} className={inputCls}>
                <option value="">No club</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ev-banner" className={labelCls}>
                Banner <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="ev-banner"
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => setBanner(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-neutral-500 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-light/15 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary-light/25 file:cursor-pointer"
              />
            </div>
          </div>
          <button type="submit" disabled={!formValid || creating} className={primaryBtnCls}>
            {creating ? 'Creating…' : 'Create Event'}
          </button>
        </form>
      </Card>

      <h2 className="text-[17px] font-semibold text-neutral-900 mb-3">All Events</h2>
      {events === null && !listError && <Spinner label="Loading events…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load events: {listError}</Card>}
      {events !== null && events.length === 0 && (
        <Card>
          <EmptyState icon="🎉" title="No events yet" hint="Create your first event above." />
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {events?.map((ev) => (
          <Card key={ev.id} className="overflow-hidden">
            {ev.banner_url && (
              <img src={ev.banner_url} alt="" className="h-36 w-full object-cover" loading="lazy" />
            )}
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[17px] font-semibold text-neutral-900">{ev.title}</p>
                <span className="shrink-0 inline-flex items-center rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                  {ev.rsvp_count} RSVP{ev.rsvp_count === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-500 line-clamp-2">{ev.description}</p>
              <p className="mt-3 text-sm font-medium text-neutral-900">
                📍 {ev.venue} · {formatDateTime(ev.start_time)}
              </p>
              {ev.club_name && <p className="mt-1 text-xs text-neutral-500">Hosted by {ev.club_name}</p>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
