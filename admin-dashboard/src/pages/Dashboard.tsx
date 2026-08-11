import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AdminStats, Analytics } from '../types'
import { Card, CountUp, PageTitle, Spinner } from '../components/ui'
import { useToast } from '../context/ToastContext'

/* ---------- Analytics charts (single-series, monochrome by design) ---------- */

function HBarRow({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="group flex items-center gap-3 py-1" title={`${label}: ${display}`}>
      <span className="w-44 shrink-0 truncate text-sm text-neutral-900">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-[4px] bg-white/10" role="presentation">
        <div
          className="h-full rounded-r-[4px] bg-primary transition-[width] duration-500 ease-out group-hover:bg-white"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-sm tabular-nums text-neutral-500">{display}</span>
    </div>
  )
}

function SignupsChart({ data }: { data: Analytics['signups_by_day'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const fmt = (day: string) =>
    new Date(day + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return (
    <div>
      <div className="flex h-28 items-end gap-1" role="img" aria-label="Signups per day, last 14 days">
        {data.map((d) => (
          <div key={d.day} className="group flex h-full flex-1 flex-col justify-end" title={`${fmt(d.day)}: ${d.count} signup${d.count === 1 ? '' : 's'}`}>
            <div
              className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-white"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 3 : 1 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-neutral-500">
        <span>{data.length > 0 ? fmt(data[0].day) : ''}</span>
        <span>{data.length > 0 ? fmt(data[data.length - 1].day) : ''}</span>
      </div>
    </div>
  )
}

function AnalyticsSection() {
  const [data, setData] = useState<Analytics | null>(null)

  useEffect(() => {
    let cancelled = false
    api<Analytics>('/admin/analytics')
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        // analytics are additive; the stat tiles above still work
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!data) return null
  const maxReach = Math.max(1, ...data.announcement_reach.map((a) => a.target))
  const maxRsvp = Math.max(1, ...data.popular_events.map((e) => e.rsvp_count))

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-neutral-900">Signups — last 14 days</h2>
        <SignupsChart data={data.signups_by_day} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-neutral-900">Announcement reach (acked / target)</h2>
        {data.announcement_reach.length === 0 ? (
          <p className="text-sm text-neutral-500">No announcements yet.</p>
        ) : (
          data.announcement_reach.map((a) => (
            <HBarRow key={a.id} label={a.title} value={a.delivered} max={maxReach} display={`${a.delivered} / ${a.target}`} />
          ))
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-neutral-900">Poll participation</h2>
        {data.poll_participation.length === 0 ? (
          <p className="text-sm text-neutral-500">No polls yet.</p>
        ) : (
          data.poll_participation.map((p) => (
            <HBarRow
              key={p.id}
              label={p.question}
              value={p.voters}
              max={Math.max(1, p.eligible)}
              display={`${p.eligible > 0 ? Math.round((p.voters / p.eligible) * 100) : 0}%`}
            />
          ))
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-neutral-900">Most popular events (RSVPs)</h2>
        {data.popular_events.length === 0 ? (
          <p className="text-sm text-neutral-500">No events yet.</p>
        ) : (
          data.popular_events.map((e) => (
            <HBarRow key={e.id} label={e.title} value={e.rsvp_count} max={maxRsvp} display={String(e.rsvp_count)} />
          ))
        )}
      </Card>
    </div>
  )
}

const STAT_DEFS: { key: keyof AdminStats; label: string; icon: string }[] = [
  { key: 'total_users', label: 'Total Users', icon: '👥' },
  { key: 'verified_users', label: 'Verified Users', icon: '✅' },
  { key: 'online_now', label: 'Online Now', icon: '🟢' },
  { key: 'announcements_today', label: 'Announcements Today', icon: '📣' },
  { key: 'active_polls', label: 'Active Polls', icon: '📊' },
  { key: 'open_lostfound', label: 'Open Lost & Found', icon: '🧳' },
  { key: 'upcoming_events', label: 'Upcoming Events', icon: '🎉' },
]

export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    let shownError = false

    const load = async () => {
      try {
        const data = await api<AdminStats>('/admin/stats')
        if (!cancelled) {
          setStats(data)
          setError(null)
          shownError = false
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load stats'
          setError(msg)
          if (!shownError) {
            toast(msg, 'error')
            shownError = true
          }
        }
      }
    }

    load()
    const timer = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [toast])

  return (
    <div>
      <PageTitle sub="Campus overview — refreshes every 15 seconds">Dashboard</PageTitle>

      {!stats && !error && <Spinner label="Loading stats…" />}
      {!stats && error && (
        <Card className="p-6 text-sm text-neutral-500">Could not load stats: {error}</Card>
      )}

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {STAT_DEFS.map((def) => (
            <Card key={def.key} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-500">{def.label}</p>
                  <p className="mt-2 text-3xl font-bold text-neutral-900">
                    <CountUp value={stats[def.key]} />
                  </p>
                </div>
                <span className="text-xl" aria-hidden>
                  {def.icon}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AnalyticsSection />
    </div>
  )
}
