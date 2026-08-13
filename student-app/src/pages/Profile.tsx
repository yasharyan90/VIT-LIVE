// Profile tab: identity card, My Clubs (follow/unfollow), local
// notification preferences, logout.

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { ws } from '../lib/ws'
import { getNotifPrefs, setNotifPrefs, type NotifPrefs } from '../lib/prefs'
import type { Club, User } from '../lib/types'
import { PageLoader, EmptyState, Spinner } from '../components/ui'
import { MotionItem, MotionList, spring } from '../components/motion'

const inputCls =
  'min-h-12 w-full rounded-xl border border-white/15 bg-soft px-4 text-[15px] text-ink placeholder:text-muted focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/15'
const labelCls = 'mb-1.5 block text-sm font-semibold text-ink'

/* ---------- Inline profile editor (glass sheet inside the identity card) ---------- */

function EditProfileForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { refreshUser } = useAuth()
  const toast = useToast()
  const [fullName, setFullName] = useState(user.full_name)
  const [bio, setBio] = useState(user.bio)
  const [phone, setPhone] = useState(user.phone)
  const [residence, setResidence] = useState<'hosteller' | 'day_scholar' | ''>(user.residence_type ?? '')
  const [block, setBlock] = useState(user.hostel_block)
  const [room, setRoom] = useState(user.room_number)
  const [avatar, setAvatar] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!avatar) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(avatar)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [avatar])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!fullName.trim() || saving) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('full_name', fullName.trim())
      fd.append('bio', bio.trim())
      fd.append('phone', phone.trim())
      if (residence) fd.append('residence_type', residence)
      if (residence === 'hosteller') {
        fd.append('hostel_block', block.trim())
        fd.append('room_number', room.trim())
      }
      if (avatar) fd.append('avatar', avatar)
      await api<{ user: User }>('/me', { method: 'PATCH', form: fd })
      await refreshUser()
      toast('Profile updated ✨', { kind: 'success' })
      onDone()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save profile', { kind: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const shownAvatar = preview ?? user.avatar_url

  return (
    <motion.form
      onSubmit={save}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
        {/* Avatar picker */}
        <div className="flex items-center gap-4">
          <label className="group relative cursor-pointer" aria-label="Change profile picture">
            {shownAvatar ? (
              <img
                src={shownAvatar}
                alt=""
                className="h-20 w-20 rounded-full border border-white/20 object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-3xl">
                🙂
              </span>
            )}
            <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm text-black shadow-lg">
              📷
            </span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => setAvatar(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs text-muted">
            Tap the photo to change it.
            <br />
            JPG/PNG/WebP, up to 5 MB.
          </p>
        </div>

        <div>
          <label htmlFor="pf-name" className={labelCls}>
            Full name
          </label>
          <input
            id="pf-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={80}
            required
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="pf-bio" className={labelCls}>
            Bio <span className="font-normal text-muted">({280 - bio.length} left)</span>
          </label>
          <textarea
            id="pf-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 280))}
            rows={3}
            placeholder="A line about you — interests, what you're building, favourite club…"
            className={`${inputCls} py-3`}
          />
        </div>

        <div>
          <label htmlFor="pf-phone" className={labelCls}>
            Phone <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="pf-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
            placeholder="+91 …"
            className={inputCls}
          />
        </div>

        {/* Residence */}
        <div>
          <span className={labelCls}>I stay</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Residence type">
            {(
              [
                ['hosteller', '🏠 Hostel'],
                ['day_scholar', '🚌 Day Scholar'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={residence === value}
                onClick={() => setResidence((prev) => (prev === value ? '' : value))}
                className={`min-h-11 flex-1 rounded-xl border text-sm font-semibold transition-colors ${
                  residence === value
                    ? 'border-primary/70 bg-white/10 text-ink'
                    : 'border-white/15 text-muted active:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {residence === 'hosteller' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex gap-3 overflow-hidden"
            >
              <div className="flex-1">
                <label htmlFor="pf-block" className={labelCls}>
                  Hostel block
                </label>
                <input
                  id="pf-block"
                  value={block}
                  onChange={(e) => setBlock(e.target.value)}
                  maxLength={40}
                  placeholder="e.g. Block A"
                  className={inputCls}
                />
              </div>
              <div className="w-32">
                <label htmlFor="pf-room" className={labelCls}>
                  Room
                </label>
                <input
                  id="pf-room"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  maxLength={20}
                  placeholder="214"
                  className={inputCls}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          type="submit"
          disabled={!fullName.trim() || saving}
          whileTap={{ scale: 0.98 }}
          transition={spring}
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary font-semibold text-black shadow-sm disabled:opacity-60"
        >
          {saving ? <Spinner className="h-5 w-5 border-black/25 border-t-black" /> : 'Save profile'}
        </motion.button>
      </div>
    </motion.form>
  )
}

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
  const [editing, setEditing] = useState(false)

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

      <section className="rounded-2xl glass p-4">
        <div className="flex items-center gap-4">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full border border-white/20 object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-black"
            >
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-ink">{user.full_name}</p>
            <p className="truncate text-sm text-muted">{user.college_email}</p>
          </div>
          <motion.button
            type="button"
            onClick={() => setEditing((v) => !v)}
            whileTap={{ scale: 0.95 }}
            transition={spring}
            aria-expanded={editing}
            className={`min-h-10 shrink-0 rounded-xl border px-3.5 text-sm font-semibold transition-colors ${
              editing ? 'border-primary/60 bg-white/10 text-ink' : 'border-white/15 text-muted'
            }`}
          >
            {editing ? 'Close' : '✏️ Edit'}
          </motion.button>
        </div>

        {user.bio && <p className="mt-3 text-sm leading-relaxed text-ink/80">{user.bio}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[12px] font-semibold text-ink">
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
          {user.residence_type === 'hosteller' && (
            <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[12px] font-semibold text-success">
              🏠 {user.hostel_block || 'Hosteller'}
              {user.room_number ? ` · ${user.room_number}` : ''}
            </span>
          )}
          {user.residence_type === 'day_scholar' && (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[12px] font-semibold text-warning">
              🚌 Day Scholar
            </span>
          )}
          {user.department_code && (
            <span className="text-muted">
              {user.department_name ?? user.department_code} · Year {user.year_of_study}
            </span>
          )}
        </div>
        {user.phone && <p className="mt-2 text-sm text-muted">📞 {user.phone}</p>}

        <AnimatePresence initial={false}>
          {editing && <EditProfileForm user={user} onDone={() => setEditing(false)} />}
        </AnimatePresence>
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
                  club.is_following ? 'border-white/25 bg-white/10' : 'border-white/10 bg-white/5'
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
        <div className="divide-y divide-white/10 rounded-2xl glass">
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
