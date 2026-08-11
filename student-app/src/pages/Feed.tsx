// Home feed (wireframe §4.1): chronological announcement cards, cursor
// pagination via `before`, live WS prepend with slide-down + fade.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { bumpLastSeen, ws } from '../lib/ws'
import { relTime } from '../lib/time'
import type { Announcement, ClubPost, MessMenu } from '../lib/types'
import { EmptyState, PageLoader, PriorityBadge, Spinner, SubTabs } from '../components/ui'
import { ClubPostCard } from '../components/ClubPostCard'
import { MotionItem, MotionList, spring } from '../components/motion'
import { RefreshIcon } from '../components/Icons'

/* ---------- Club social feed (posts from clubs you follow) ---------- */

function ClubsFeed() {
  const [posts, setPosts] = useState<ClubPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<{ items: ClubPost[] }>('/feed/clubs')
      .then((data) => {
        if (!cancelled) setPosts(data.items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load club feed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Live: new posts from followed clubs, like tallies, deletions.
  useEffect(() => {
    const offs = [
      ws.on('clubpost.new', (env) => {
        const p = env.payload as ClubPost
        if (!p || !p.id) return
        setPosts((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev]))
      }),
      ws.on('clubpost.like', (env) => {
        const upd = env.payload as { id: string; like_count: number }
        setPosts((prev) => prev.map((p) => (p.id === upd.id ? { ...p, like_count: upd.like_count } : p)))
      }),
      ws.on('clubpost.deleted', (env) => {
        const upd = env.payload as { id: string }
        setPosts((prev) => prev.filter((p) => p.id !== upd.id))
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const updatePost = (p: ClubPost) =>
    setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)))

  if (loading) return <PageLoader />
  if (error) {
    return (
      <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning" role="alert">
        {error}
      </p>
    )
  }
  if (posts.length === 0) {
    return (
      <div>
        <EmptyState
          icon="🎭"
          title="Your clubs' updates live here"
          subtitle="Follow clubs to see their announcements, banner reveals and news the moment they drop."
        />
        <Link
          to="/profile"
          className="mx-auto flex min-h-11 w-fit items-center rounded-xl bg-primary px-5 text-sm font-semibold text-black shadow-sm"
        >
          Find clubs to follow
        </Link>
      </div>
    )
  }
  return (
    <MotionList className="mt-3 space-y-3">
      {posts.map((p) => (
        <MotionItem key={p.id}>
          <ClubPostCard post={p} onChange={updatePost} />
        </MotionItem>
      ))}
    </MotionList>
  )
}

const MEAL_ICONS: Record<MessMenu['meal'], string> = {
  breakfast: '☕', lunch: '🍛', snacks: '🍪', dinner: '🍽',
}

function MessMenuCard() {
  const [meals, setMeals] = useState<MessMenu[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<{ meals: MessMenu[] }>('/mess-menu')
      .then((data) => {
        if (!cancelled) setMeals(data.meals.filter((m) => m.items.trim() !== ''))
      })
      .catch(() => {
        // mess menu is best-effort decoration; feed works without it
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (meals.length === 0) return null
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="mb-3 rounded-2xl border border-white/10 bg-soft/60"
      aria-label="Today's mess menu"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between px-4 text-left"
      >
        <span className="text-sm font-semibold text-ink">🍽 Today's mess menu</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="text-muted" aria-hidden="true">
          ▾
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <dl className="space-y-2 px-4 pb-4">
              {meals.map((m) => (
                <div key={m.meal} className="flex gap-3 text-sm">
                  <dt className="w-24 shrink-0 font-semibold capitalize text-ink/80">
                    <span aria-hidden="true">{MEAL_ICONS[m.meal]}</span> {m.meal}
                  </dt>
                  <dd className="min-w-0 flex-1 text-muted">{m.items}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

const PAGE_SIZE = 20

export function FeedPage() {
  const [tab, setTab] = useState<'campus' | 'clubs'>('campus')
  const [items, setItems] = useState<Announcement[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [, setTick] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Re-render every 30s so relative timestamps stay honest.
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<{ items: Announcement[]; has_more: boolean }>(
        `/announcements?limit=${PAGE_SIZE}`,
      )
      if (!mounted.current) return
      setItems(data.items)
      setHasMore(data.has_more)
      const newest = data.items[0]
      if (newest) bumpLastSeen(newest.created_at)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Failed to load feed')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = async () => {
    const oldest = items[items.length - 1]
    if (!oldest) return
    setLoadingMore(true)
    try {
      const data = await api<{ items: Announcement[]; has_more: boolean }>(
        `/announcements?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.created_at)}`,
      )
      if (!mounted.current) return
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id))
        return [...prev, ...data.items.filter((i) => !seen.has(i.id))]
      })
      setHasMore(data.has_more)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Failed to load more')
    } finally {
      if (mounted.current) setLoadingMore(false)
    }
  }

  // Live reaction tallies from other users.
  useEffect(() => {
    return ws.on('announcement.reaction', (env) => {
      const upd = env.payload as { id: string; reaction_count: number }
      if (!upd || !upd.id) return
      setItems((prev) =>
        prev.map((a) => (a.id === upd.id ? { ...a, reaction_count: upd.reaction_count } : a)),
      )
    })
  }, [])

  const toggleReaction = async (a: Announcement) => {
    // Optimistic flip; server response and the WS echo reconcile the count.
    setItems((prev) =>
      prev.map((x) =>
        x.id === a.id
          ? {
              ...x,
              my_reaction: !a.my_reaction,
              reaction_count: Math.max(0, (a.reaction_count ?? 0) + (a.my_reaction ? -1 : 1)),
            }
          : x,
      ),
    )
    try {
      const data = await api<{ reaction_count: number; my_reaction: boolean }>(
        `/announcements/${a.id}/react`,
        { method: 'POST' },
      )
      setItems((prev) =>
        prev.map((x) =>
          x.id === a.id ? { ...x, reaction_count: data.reaction_count, my_reaction: data.my_reaction } : x,
        ),
      )
    } catch {
      setItems((prev) =>
        prev.map((x) =>
          x.id === a.id ? { ...x, my_reaction: a.my_reaction, reaction_count: a.reaction_count } : x,
        ),
      )
    }
  }

  // Live prepend (covers both WS pushes and reconciled items from the shell).
  useEffect(() => {
    return ws.on('announcement.new', (env) => {
      const a = env.payload as Announcement
      if (!a || !a.id) return
      setItems((prev) => (prev.some((i) => i.id === a.id) ? prev : [a, ...prev]))
      setFreshIds((prev) => new Set(prev).add(a.id))
      window.setTimeout(() => {
        if (mounted.current) {
          setFreshIds((prev) => {
            const next = new Set(prev)
            next.delete(a.id)
            return next
          })
        }
      }, 1000)
    })
  }, [])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-3">
        <SubTabs
          tabs={[
            { value: 'campus', label: 'Campus' },
            { value: 'clubs', label: 'My Clubs' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'clubs' ? (
        <ClubsFeed />
      ) : (
        <>
      <MessMenuCard />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">Campus Feed</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh feed"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-soft disabled:opacity-50"
        >
          <RefreshIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning" role="alert">
          {error}
        </p>
      )}

      {loading && items.length === 0 ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📭"
          title="Nothing here yet"
          subtitle="Announcements from your college will show up here the moment they're published."
        />
      ) : (
        <MotionList className="space-y-3">
          {items.map((a) => {
            const isExpanded = expanded.has(a.id)
            return (
              <MotionItem
                key={a.id}
                className={`rounded-2xl border border-white/10 bg-soft/60 p-4 ${
                  freshIds.has(a.id) ? 'animate-slide-fade' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpand(a.id)}
                  className="w-full text-left"
                  aria-expanded={isExpanded}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <PriorityBadge priority={a.priority} />
                    <span className="ml-auto shrink-0 text-xs text-muted">
                      {relTime(a.created_at)}
                    </span>
                  </div>
                  <h3 className="text-[17px] font-semibold leading-snug text-ink">{a.title}</h3>
                  {a.image_url && (
                    <img
                      src={a.image_url}
                      alt=""
                      className="mt-2 max-h-64 w-full rounded-xl border border-white/10 bg-black object-cover"
                    />
                  )}
                  <p
                    className={`mt-1 text-[15px] leading-relaxed text-ink/80 ${
                      isExpanded ? '' : 'line-clamp-2'
                    }`}
                  >
                    {a.body}
                  </p>
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-muted">{a.author_name}</p>
                  <motion.button
                    type="button"
                    onClick={() => void toggleReaction(a)}
                    aria-pressed={a.my_reaction ?? false}
                    aria-label="Like this announcement"
                    whileTap={{ scale: 0.85 }}
                    transition={spring}
                    className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors ${
                      a.my_reaction
                        ? 'border-primary/60 bg-white/10 text-ink'
                        : 'border-white/15 text-muted active:bg-white/5'
                    }`}
                  >
                    <span aria-hidden="true">{a.my_reaction ? '👍' : '👍🏻'}</span>
                    {(a.reaction_count ?? 0) > 0 && <span>{a.reaction_count}</span>}
                  </motion.button>
                </div>
              </MotionItem>
            )
          })}
        </MotionList>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-white/10 bg-soft/60 font-semibold text-primary-light active:bg-soft"
        >
          {loadingMore ? <Spinner className="h-5 w-5" /> : 'Load more'}
        </button>
      )}
        </>
      )}
    </div>
  )
}
