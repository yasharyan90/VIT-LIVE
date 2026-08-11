// Shared framer-motion vocabulary: one spring, one stagger, used everywhere
// so the whole app moves with a single voice.

import { motion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

export const spring = { type: 'spring', stiffness: 380, damping: 32, mass: 0.7 } as const

export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
}

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: spring },
}

/** Staggered list container — children should be <MotionItem>. */
export function MotionList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.ul className={className} variants={listVariants} initial="hidden" animate="show">
      {children}
    </motion.ul>
  )
}

export function MotionItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.li layout className={className} variants={itemVariants}>
      {children}
    </motion.li>
  )
}
