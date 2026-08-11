import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { spring } from './motion'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block h-6 w-6 animate-spin rounded-full border-[2.5px] border-white/15 border-t-primary ${className ?? ''}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: string
  title: string
  subtitle?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="flex flex-col items-center gap-2 px-8 py-16 text-center"
    >
      <span className="text-4xl grayscale" aria-hidden="true">
        {icon}
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
    </motion.div>
  )
}

export function PriorityBadge({ priority }: { priority: 'normal' | 'high' }) {
  if (priority === 'high') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-bold tracking-wide text-warning">
        <span aria-hidden="true">▲</span> HIGH
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-bold tracking-wide text-ink/80">
      NOTICE
    </span>
  )
}

export function Chip({
  color,
  children,
}: {
  color: 'green' | 'blue' | 'gray' | 'amber'
  children: ReactNode
}) {
  const styles = {
    green: 'border-success/40 bg-success/10 text-success',
    blue: 'border-white/20 bg-white/10 text-ink',
    gray: 'border-white/10 bg-soft text-muted',
    amber: 'border-warning/40 bg-warning/10 text-warning',
  }[color]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles}`}>
      {children}
    </span>
  )
}

export function SubTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { value: T; label: string }[]
  active: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-xl bg-soft p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={active === t.value}
          onClick={() => onChange(t.value)}
          className={`relative min-h-11 flex-1 rounded-lg text-sm font-semibold transition-colors ${
            active === t.value ? 'text-ink' : 'text-muted'
          }`}
        >
          {active === t.value && (
            <motion.span
              layoutId="subtab-thumb"
              transition={spring}
              className="absolute inset-0 rounded-lg bg-white/10 shadow-sm"
              aria-hidden="true"
            />
          )}
          <span className="relative">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <motion.p
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning"
      role="alert"
    >
      {message}
    </motion.p>
  )
}
