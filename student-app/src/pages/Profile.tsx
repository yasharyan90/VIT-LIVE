// Profile tab: identity card, My Clubs (follow/unfollow), local
// notification preferences, logout.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { ws } from '../lib/ws'
import { getNotifPrefs, setNotifPrefs, type NotifPrefs } from '../lib/prefs'
import type { Club } from '../lib/types'
import { PageLoader, EmptyState } from '../components/ui'
import { MotionItem, MotionList } from '../components/motion'

const ROLE_LABEL: Record<string, string> = {
  student: 'Student',
  club_admin: 'Club Admin',
  dept_admin: 'Dept Admin',
  super_admin: 'Super Admin',
  moderator: 'Moderator',
}

export function ProfilePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [clubs, setClubs] = useState<Club[]>([])
  const [clubsLoading, setClubsLoading] = useState(true)
  const [busyClubs, setBusyClubs] = useState<Set<string>>(new Set())
  const [prefs, setPrefs] = useState<NotifPrefs>(getNotifPrefs)

  useEffect(() => {
    let cancelled = false
    api<{ items: Club[] }>('/clubs')
      .then((data) => {
        if (!cancelled) setClubs(data.items)
      })
      .catch(() => {
        if (!cancelled) toast('Could not load clubs', { kind: 'error' })
      })
      .finally(() => {
        if (!cancelled) setClubsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  if (!user) return null

  const toggleFollow = async (club: Club) => {
    if (busyClubs.has(club.id)) return
    setBusyClubs((prev) => new Set(prev).add(club.id))
    const action = club.is_following ? 'unfollow' : 'follow'
    // Optimistic
    setClubs((prev) =>
      prev.map((c) =>
        c.id === club.id
          ? {
              ...c,
              is_following: !club.is_following,
              member_count: Math.max(0, c.member_count + (club.is_following ? -1 : 1)),
            }
          : c,
      ),
    )
    try {
      const data = await api<{ club: Club }>(`/clubs/${club.id}/${action}`, { method: 'POST' })
      setClubs((prev) => prev.map((c) => (c.id === club.id ? data.club : c)))
      // Keep the live socket's topic subscriptions in sync.
      ws.send({
        type: action === 'follow' ? 'subscribe' : 'unsubscribe',
        topic: `club:${club.id}`,
      })
    } catch (err) {
      setClubs((prev) => prev.map((c) => (c.id === club.id ? club : c)))
      toast(err instanceof Error ? err.message : `Could not ${action} club`, { kind: 'error' })
    } finally {
      setBusyClubs((prev) => {
        const next = new Set(prev)
        next.delete(club.id)
        return next
      })
    }
  }

  const updatePref = (key: keyof NotifPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setNotifPrefs(next)
  }

  const initials = user.full_name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="px-4 py-4 pb-8">
      <h2 className="mb-3 text-lg font-bold text-ink">Profile</h2>

      <section className="rounded-2xl border border-white/10 bg-soft/60 p-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-lg font-bold text-black"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-ink">{user.full_name}</p>
            <p className="truncate text-sm text-muted">{user.college_email}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[12px] font-semibold text-ink">
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
          {user.department_code && (
            <span className="text-muted">
              {user.department_name ?? user.department_code} · Year {user.year_of_study}
            </span>
          )}
        </div>
      </section>

      <section className="mt-5" aria-label="My clubs">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">My Clubs</h3>
        {clubsLoading ? (
          <PageLoader />
        ) : clubs.length === 0 ? (
          <EmptyState icon="🎭" title="No clubs yet" subtitle="Clubs will appear here once created." />
        ) : (
          <MotionList className="space-y-2">
            {clubs.map((club) => (
              <MotionItem
                key={club.id}
                className={`flex items-center gap-3 rounded-2xl border p-3 ${
                  club.is_following ? 'border-white/25 bg-white/5' : 'border-white/10 bg-soft/60'
                }`}
              >
                <Link to={`/clubs/${club.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{club.name}</p>
                  <p className="truncate text-sm text-muted">
                    {club.member_count} member{club.member_count === 1 ? '' : 's'}
                    {club.description ? ` · ${club.description}` : ''}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => void toggleFollow(club)}
                  disabled={busyClubs.has(club.id)}
                  aria-pressed={club.is_following}
                  className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60 ${
                    club.is_following
                      ? 'border border-white/15 bg-transparent text-ink'
                      : 'bg-primary text-black shadow-sm active:scale-[0.98]'
                  }`}
                >
                  {club.is_following ? 'Following ✓' : 'Follow'}
                </button>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </section>

      <section className="mt-5" aria-label="Notification preferences">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Notifications
        </h3>
        <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-soft/60">
          {(
            [
              ['announcements', 'Announcements'],
              ['events', 'Event updates'],
              ['polls', 'New polls'],
              ['lostfound', 'Lost & Found matches'],
            ] as [keyof NotifPrefs, string][]
          ).map(([key, label]) => (
            <label key={key} className="flex min-h-12 cursor-pointer items-center justify-between px-4 py-2">
              <span className="text-[15px] font-medium text-ink">{label}</span>
              <span className="relative inline-flex">
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={() => updatePref(key)}
                  className="peer sr-only"
                />
                <span className="h-7 w-12 rounded-full bg-white/15 transition-colors peer-checked:bg-success" />
                <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Emergency alerts always come through — they cannot be turned off.
        </p>
      </section>

      <button
        type="button"
        onClick={() => {
          logout()
          navigate('/login', { replace: true })
        }}
        className="mt-8 min-h-12 w-full rounded-xl border border-white/15 font-semibold text-ink active:bg-soft"
      >
        Log out
      </button>
    </div>
  )
}
