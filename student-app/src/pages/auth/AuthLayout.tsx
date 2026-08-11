import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col border-x border-white/5 bg-black lg:justify-center lg:border-x-0 lg:py-10">
      <div className="flex flex-col items-center gap-1 px-6 pb-10 pt-16 text-ink lg:pt-0">
        <motion.span
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="text-4xl grayscale"
          aria-hidden="true"
        >
          🎓
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="text-3xl font-extrabold tracking-tight"
        >
          VIT<span className="text-muted"> Live</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.18 }}
          className="text-sm text-muted"
        >
          Your campus, in real time
        </motion.p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.1 }}
        className="flex-1 rounded-t-3xl border-t border-white/10 bg-surface px-6 pb-10 pt-8 lg:flex-none lg:rounded-3xl lg:border lg:shadow-2xl lg:shadow-black/40"
      >
        {children}
      </motion.div>
    </div>
  )
}

export const inputClass =
  'min-h-12 w-full rounded-xl border border-white/15 bg-soft px-4 text-[15px] text-ink placeholder:text-muted focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/15'

export const primaryBtnClass =
  'min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-black shadow-sm transition active:scale-[0.98] disabled:opacity-60'

export const labelClass = 'mb-1.5 block text-sm font-semibold text-ink'
