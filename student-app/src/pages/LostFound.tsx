// Lost & Found tab (wireframe §4.3): Lost/Found sub-tabs, search,
// photo cards, floating "+" button, live WS prepend.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { ws } from '../lib/ws'
import { relTime } from '../lib/time'
import type { LostFoundItem } from '../lib/types'
import { Chip, EmptyState, PageLoader, SubTabs } from '../components/ui'
import { MotionItem, MotionList } from '../components/motion'
import { motion } from 'framer-motion'
import { PlusIcon } from '../components/Icons'

export function LostFoundPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'lost' | 'found'>('lost')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<LostFoundItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const debounceRef = useRef<number | null>(null)
  const requestSeq = useRef(0)

  const fetchItems = (type: 'lost' | 'found', q: string) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ type })
    if (q.trim()) qs.set('q', q.trim())
    api<{ items: LostFoundItem[] }>(`/lostfound?${qs.toString()}`)
      .then((data) => {
        if (seq === requestSeq.current) setItems(data.items)
      })
      .catch((err) => {
        if (seq === requestSeq.current) {
          setError(err instanceof Error ? err.message : 'Failed to load items')
        }
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }

  // Refetch on tab change immediately, on query change debounced.
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(
      () => fetchItems(tab, query),
      query ? 300 : 0,
    )
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    }
  }, [tab, query])

  // Live prepend for new posts matching the current sub-tab.
  useEffect(() => {
    return ws.on('lostfound.new', (env) => {
      const item = env.payload as LostFoundItem
      if (!item || !item.id || item.type !== tab) return
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [item, ...prev]))
      setFreshIds((prev) => new Set(prev).add(item.id))
      window.setTimeout(() => {
        setFreshIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      }, 1000)
    })
  }, [tab])

  return (
    <div className="px-4 py-4">
      <h2 className="mb-3 text-lg font-bold text-ink">Lost &amp; Found</h2>
      <SubTabs
        tabs={[
          { value: 'lost', label: 'Lost' },
          { value: 'found', label: 'Found' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${tab} items…`}
        aria-label="Search items"
        className="mt-3 min-h-11 w-full rounded-xl border border-white/15 bg-soft px-4 text-[15px] text-ink placeholder:text-muted focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/15"
      />

      {error && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState
          icon={tab === 'lost' ? '🧦' : '🧢'}
          title={tab === 'lost' ? 'No lost items reported' : 'Nothing found yet'}
          subtitle="Lost something? Tap the + button to post it — someone may have picked it up."
        />
      ) : (
        <MotionList className="mt-3 space-y-3">
          {items.map((item) => (
            <MotionItem key={item.id} className={freshIds.has(item.id) ? 'animate-slide-fade' : ''}>
              <button
                type="button"
                onClick={() => navigate(`/lostfound/${item.id}`, { state: { item } })}
                className="flex w-full items-stretch gap-3 rounded-2xl glass p-3 text-left active:bg-white/5"
              >
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-xl bg-soft object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-soft text-2xl">
                    <span aria-hidden="true">{item.type === 'lost' ? '🔍' : '🎒'}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-ink">{item.title}</h3>
                    {item.status === 'resolved' ? (
                      <Chip color="green">✓ Resolved</Chip>
                    ) : (
                      <Chip color={item.type === 'lost' ? 'amber' : 'blue'}>
                        {item.type === 'lost' ? 'Lost' : 'Found'}
                      </Chip>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">📍 {item.location}</p>
                  <p className="mt-1 text-xs text-muted">{relTime(item.created_at)}</p>
                </div>
              </button>
            </MotionItem>
          ))}
        </MotionList>
      )}

      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.15 }}
        className="fixed bottom-20 z-30 left-[min(100vw,calc(50vw+240px))] lg:left-auto lg:right-8 lg:bottom-8"
      >
        <Link
          to="/lostfound/new"
          aria-label="Post a lost or found item"
          className="flex h-14 w-14 -translate-x-[calc(100%+16px)] items-center justify-center rounded-full bg-primary text-black shadow-lg shadow-black/50 lg:translate-x-0"
        >
          <PlusIcon className="h-7 w-7" />
        </Link>
      </motion.div>
    </div>
  )
}
