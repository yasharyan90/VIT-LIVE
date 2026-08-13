import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

/* ---------- Priority / status badges ---------- */

export function PriorityBadge({ priority }: { priority: 'normal' | 'high' | 'emergency' }) {
  if (priority === 'emergency') {
    return (
      <span className="inline-flex items-center rounded-full bg-emergency px-2.5 py-0.5 text-xs font-semibold text-white uppercase tracking-wide">
        Emergency
      </span>
    )
  }
  if (priority === 'high') {
    return (
      <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 text-warning px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide">
        High
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 text-neutral-900 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide">
      Normal
    </span>
  )
}

const ROLE_STYLES: Record<string, string> = {
  super_admin: 'bg-primary text-black',
  dept_admin: 'border border-white/20 bg-white/10 text-neutral-900',
  club_admin: 'border border-white/20 bg-white/10 text-neutral-900',
  moderator: 'border border-warning/40 bg-warning/10 text-warning',
  student: 'bg-neutral-100 text-neutral-500',
}

export function RoleBadge({ role }: { role: string }) {
  const style = ROLE_STYLES[role] ?? 'bg-neutral-100 text-neutral-500'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>
      {role.replace('_', ' ')}
    </span>
  )
}

/* ---------- Loading / empty states ---------- */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-neutral-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-500/30 border-t-primary" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function EmptyState({ icon = '📭', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <span className="text-4xl" aria-hidden>
        {icon}
      </span>
      <p className="font-semibold text-neutral-900">{title}</p>
      {hint && <p className="text-sm text-neutral-500">{hint}</p>}
    </div>
  )
}

/* ---------- Cards / page chrome ---------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className={`glass rounded-xl ${className}`}
    >
      {children}
    </motion.div>
  )
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[22px] font-bold text-neutral-900">{children}</h1>
      {sub && <p className="mt-1 text-sm text-neutral-500">{sub}</p>}
    </div>
  )
}

/* ---------- Animated counter (Live Counter component from design doc) ---------- */

export function CountUp({ value, duration = 600 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number>()

  useEffect(() => {
    const from = fromRef.current
    if (from === value) return
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const current = Math.round(from + (value - from) * eased)
      setDisplay(current)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = value
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      fromRef.current = value
    }
  }, [value, duration])

  return <span>{display.toLocaleString()}</span>
}

/* ---------- Form primitives ---------- */

export const inputCls =
  'w-full rounded-lg border border-white/15 bg-neutral-100 px-3 py-2 text-[15px] text-neutral-900 placeholder:text-neutral-500/60 focus:outline-none focus:ring-2 focus:ring-white/15 focus:border-white/40'

export const labelCls = 'block text-sm font-semibold text-neutral-900 mb-1.5'

export const primaryBtnCls =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black hover:bg-white active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition'

export const secondaryBtnCls =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-transparent px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

/* ---------- Helpers ---------- */

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return iso
  const sec = Math.floor((Date.now() - d) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} day${day > 1 ? 's' : ''} ago`
  return formatDateTime(iso)
}
