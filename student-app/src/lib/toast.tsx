import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

export interface ToastOptions {
  /** 'error' renders a dark toast with a warning tint; default is neutral dark */
  kind?: 'info' | 'error' | 'success'
  actionLabel?: string
  actionTo?: string
  durationMs?: number
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
}

interface ToastContextValue {
  toast: (message: string, opts?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const navigate = useNavigate()

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = nextId.current++
      setToasts((prev) => [...prev.slice(-2), { id, message, ...opts }])
      window.setTimeout(() => dismiss(id), opts.durationMs ?? 4500)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-40 mx-auto flex w-full max-w-[480px] flex-col items-center gap-2 px-4 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:mx-0 lg:w-96 lg:items-end lg:px-0"
        aria-live="polite"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className={`pointer-events-auto flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-sm text-ink shadow-lg backdrop-blur-xl ${
                t.kind === 'success'
                  ? 'border-success/40 bg-success/15'
                  : t.kind === 'error'
                    ? 'border-warning/40 bg-[#181818]/95'
                    : 'border-white/10 bg-[#181818]/95'
              }`}
              role="status"
            >
              {t.kind === 'error' && <span aria-hidden="true">⚠</span>}
              <span className="min-w-0 flex-1">{t.message}</span>
              {t.actionLabel && t.actionTo && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg px-2 py-2 font-semibold text-primary active:opacity-70"
                  onClick={() => {
                    dismiss(t.id)
                    navigate(t.actionTo!)
                  }}
                >
                  {t.actionLabel}
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss"
                className="shrink-0 px-1 py-2 text-white/50 active:text-white"
                onClick={() => dismiss(t.id)}
              >
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (message: string, opts?: ToastOptions) => void {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx.toast
}
