// Authenticated app shell: header, bottom tab bar, WS lifecycle,
// reconciliation on reconnect (App Flow §8), global toasts, emergency overlay.

import { useEffect, useState } from 'react'
import { NavLink, useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { bumpLastSeen, getLastSeen, ws } from '../lib/ws'
import { getNotifPrefs } from '../lib/prefs'
import { registerPush } from '../lib/pwa'
import { useToast } from '../lib/toast'
import type { Announcement, AppEvent, ClubPost, LostFoundItem, Poll } from '../lib/types'
import { EmergencyOverlay } from './EmergencyOverlay'
import { spring } from './motion'
import { CalendarIcon, ChartIcon, HomeIcon, SearchTagIcon, UserIcon } from './Icons'

const TABS = [
  { to: '/', label: 'Feed', icon: HomeIcon, end: true },
  { to: '/lostfound', label: 'Lost & Found', icon: SearchTagIcon, end: false },
  { to: '/events', label: 'Events', icon: CalendarIcon, end: false },
  { to: '/polls', label: 'Polls', icon: ChartIcon, end: false },
  { to: '/profile', label: 'Profile', icon: UserIcon, end: false },
]

// Pages under the same tab (e.g. /lostfound/new) share a transition key so
// the tab indicator and page transition only fire on tab-level changes.
function tabKey(pathname: string): string {
  const root = TABS.find((t) => !t.end && pathname.startsWith(t.to))
  return root ? root.to : pathname
}

export function Shell() {
  const toast = useToast()
  const location = useLocation()
  const outlet = useOutlet()
  const [connected, setConnected] = useState(ws.connected)

  // WS lifecycle — single connection for the whole session.
  useEffect(() => {
    ws.start()
    const offStatus = ws.onStatus(setConnected)
    return () => {
      offStatus()
      ws.stop()
    }
  }, [])

  // Background push: once logged in, register this device (no-op unless
  // Firebase env vars are configured at build time).
  useEffect(() => {
    void registerPush()
  }, [])

  // Reconciliation: on every (re)connect fetch announcements missed while offline.
  useEffect(() => {
    return ws.onOpen(() => {
      const since = getLastSeen()
      if (!since) {
        bumpLastSeen(new Date().toISOString())
        return
      }
      api<{ items: Announcement[]; has_more: boolean }>(
        `/announcements?since=${encodeURIComponent(since)}`,
      )
        .then((data) => {
          // Inject oldest-first so the feed ends up newest-on-top.
          const items = [...data.items].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          )
          for (const item of items) {
            ws.dispatch({
              type: 'announcement.new',
              topic: 'college:global',
              payload: item,
              ts: item.created_at,
              id: item.id,
            })
          }
          bumpLastSeen(new Date().toISOString())
        })
        .catch(() => {
          // will retry on next reconnect
        })
    })
  }, [])

  // Global toasts for new polls / events (linking to their tabs).
  useEffect(() => {
    const offs = [
      ws.on('poll.new', (env) => {
        if (!getNotifPrefs().polls) return
        const poll = env.payload as Poll
        toast(`New poll: ${poll.question}`, { actionLabel: 'Vote', actionTo: `/polls/${poll.id}` })
      }),
      ws.on('event.new', (env) => {
        if (!getNotifPrefs().events) return
        const event = env.payload as AppEvent
        toast(`New event: ${event.title}`, { actionLabel: 'View', actionTo: `/events/${event.id}` })
      }),
      ws.on('event.reminder', (env) => {
        if (!getNotifPrefs().events) return
        const event = env.payload as AppEvent
        toast(`Starting soon: ${event.title}`, { actionLabel: 'View', actionTo: `/events/${event.id}` })
      }),
      // A club you follow posted to its feed.
      ws.on('clubpost.new', (env) => {
        if (!getNotifPrefs().announcements) return
        const post = env.payload as ClubPost
        toast(`${post.club_name} posted an update`, {
          actionLabel: 'View',
          actionTo: `/clubs/${post.club_id}`,
        })
      }),
      // Someone posted an item that may match yours (opposite lost/found type).
      ws.on('lostfound.match', (env) => {
        if (!getNotifPrefs().lostfound) return
        const item = env.payload as LostFoundItem
        toast(`Possible match: "${item.title}" was just posted`, {
          actionLabel: 'View',
          actionTo: `/lostfound/${item.id}`,
        })
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [toast])

  const liveDot = (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      {connected && (
        <motion.span
          className="absolute inline-flex h-full w-full rounded-full bg-success"
          animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${
          connected ? 'bg-success' : 'bg-white/25'
        }`}
      />
    </span>
  )

  return (
    <div className="min-h-dvh bg-black">
      {/* Desktop sidebar (≥1024px) — phones keep the app-like bottom tabs */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/10 bg-black lg:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <h1 className="text-xl font-bold tracking-tight text-ink">
            VIT<span className="text-muted"> Live</span>
          </h1>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-widest text-muted">Campus</p>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-3" aria-label="Main navigation">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'text-ink' : 'text-muted hover:bg-white/5 hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="sidenav-indicator"
                      transition={spring}
                      className="absolute inset-0 rounded-lg bg-white/10"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="relative h-5 w-5" />
                  <span className="relative">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div
          className="flex items-center gap-2 border-t border-white/10 px-5 py-4 text-xs text-muted"
          title={connected ? 'Live updates connected' : 'Reconnecting…'}
        >
          {liveDot}
          {connected ? 'Live' : 'Offline'}
        </div>
      </aside>

      {/* Content column: phone-shaped on mobile, full-width beside the sidebar on desktop */}
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col border-x border-white/5 bg-surface lg:ml-60 lg:w-auto lg:max-w-none lg:border-x-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/70 px-4 py-3 text-ink backdrop-blur-xl lg:hidden">
          <h1 className="text-xl font-bold tracking-tight">
            VIT<span className="text-muted"> Live</span>
          </h1>
          <span
            className="flex items-center gap-1.5 text-xs text-muted"
            title={connected ? 'Live updates connected' : 'Reconnecting…'}
          >
            {liveDot}
            {connected ? 'Live' : 'Offline'}
          </span>
        </header>

        <main className="flex-1 overflow-x-clip pb-24 lg:pb-10">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={tabKey(location.pathname)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="lg:mx-auto lg:w-full lg:max-w-2xl lg:px-4 lg:pt-4"
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[480px] border-t border-white/10 bg-black/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
          aria-label="Main tabs"
        >
          <div className="flex">
            {TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                    isActive ? 'text-primary' : 'text-muted'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="tab-indicator"
                        transition={spring}
                        className="absolute top-0 h-0.5 w-10 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    )}
                    <motion.span whileTap={{ scale: 0.85 }} transition={spring}>
                      <Icon className="h-6 w-6" />
                    </motion.span>
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <EmergencyOverlay />
      </div>
    </div>
  )
}
