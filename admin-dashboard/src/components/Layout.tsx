import { useCallback } from 'react'
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useWS } from '../lib/ws'
import { RoleBadge } from './ui'
import type { Announcement, WSEnvelope } from '../types'

interface NavItem {
  to: string
  label: string
  superAdminOnly?: boolean
  roles?: string[] // visible only to these roles (overrides superAdminOnly)
  emergency?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/announcements', label: 'Announcements' },
  { to: '/emergency', label: '⚠ Emergency', superAdminOnly: true, emergency: true },
  { to: '/events', label: 'Events' },
  { to: '/club-feed', label: 'Club Feed', roles: ['club_admin', 'super_admin'] },
  { to: '/checkin', label: 'Check-in', roles: ['club_admin', 'super_admin'] },
  { to: '/academic', label: 'Academic Calendar', superAdminOnly: true },
  { to: '/polls', label: 'Polls' },
  { to: '/lostfound', label: 'Lost & Found' },
  { to: '/mess-menu', label: 'Mess Menu' },
  { to: '/clubs', label: 'Clubs' },
  { to: '/users', label: 'Users', superAdminOnly: true },
  { to: '/audit-log', label: 'Audit Log', superAdminOnly: true },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const outlet = useOutlet()

  const onWS = useCallback(
    (msg: WSEnvelope) => {
      if (msg.type === 'announcement.new') {
        const a = msg.payload as Announcement
        toast(`New announcement: ${a.title}`, 'info')
      }
    },
    [toast],
  )
  useWS(onWS)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isSuperAdmin = user?.role === 'super_admin'

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-60 bg-black border-r border-white/10 text-white flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <div className="text-lg font-bold leading-tight">
            VIT<span className="text-white/50"> Live</span>
          </div>
          <div className="text-xs font-medium uppercase tracking-widest text-white/40">Admin</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_ITEMS.filter((item) =>
            item.roles ? !!user && item.roles.includes(user.role) : !item.superAdminOnly || isSuperAdmin,
          ).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'relative block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  item.emergency
                    ? isActive
                      ? 'text-emergency'
                      : 'text-emergency/70 hover:text-emergency'
                    : isActive
                      ? 'text-white'
                      : 'text-white/55 hover:text-white hover:bg-white/5',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                      className="absolute inset-0 rounded-lg bg-white/10"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs text-white/30 border-t border-white/10">VIT Live Admin v1</div>
      </aside>

      {/* Main column */}
      <div className="flex-1 ml-60 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-10 flex items-center justify-end gap-4 bg-black/60 backdrop-blur-xl border-b border-white/10 px-6 h-14">
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-neutral-900">{user.full_name}</span>
              <RoleBadge role={user.role} />
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            Logout
          </button>
        </header>

        <main className="flex-1 px-6 py-6 max-w-5xl w-full overflow-x-clip">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
