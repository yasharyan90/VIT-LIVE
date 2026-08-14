// Chat centre: search anyone by email, open conversations, see unread counts.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { ws } from '../lib/ws'
import { relTime } from '../lib/time'
import type { ChatPerson, Conversation } from '../lib/types'
import { EmptyState, PageLoader } from '../components/ui'
import { MotionItem, MotionList } from '../components/motion'

export function Avatar({ url, name, size = 'h-12 w-12' }: { url: string | null; name: string; size?: string }) {
  if (url) {
    return <img src={url} alt="" className={`${size} shrink-0 rounded-full border border-white/20 object-cover`} />
  }
  return (
    <span
      aria-hidden="true"
      className={`${size} flex shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-ink`}
    >
      {name
        .split(/\s+/)
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()}
    </span>
  )
}

export function ChatsPage() {
  const [convos, setConvos] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatPerson[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<number | null>(null)

  const load = () =>
    api<{ items: Conversation[] }>('/chat/conversations')
      .then((data) => setConvos(data.items))
      .catch(() => {
        // list stays as-is
      })

  useEffect(() => {
    void load().finally(() => setLoading(false))
  }, [])

  // New message anywhere → refresh the conversation list.
  useEffect(() => {
    return ws.on('chat.message', () => {
      void load()
    })
  }, [])

  // Search by email (or name), debounced.
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = window.setTimeout(() => {
      api<{ items: ChatPerson[] }>(`/chat/search?q=${encodeURIComponent(query.trim())}`)
        .then((data) => setResults(data.items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    }
  }, [query])

  return (
    <div className="px-4 py-4">
      <h2 className="mb-3 text-lg font-bold text-ink">Chats</h2>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search anyone by email…"
        aria-label="Search people by email"
        className="min-h-11 w-full rounded-xl border border-white/15 bg-soft px-4 text-[15px] text-ink placeholder:text-muted focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/15"
      />

      {/* Search results */}
      <AnimatePresence initial={false}>
        {query.trim().length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="glass mt-2 overflow-hidden rounded-2xl"
          >
            {searching ? (
              <p className="px-4 py-3 text-sm text-muted">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">No one found for “{query.trim()}”.</p>
            ) : (
              results.map((p) => (
                <Link
                  key={p.id}
                  to={`/chats/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-white/5"
                >
                  <Avatar url={p.avatar_url} name={p.full_name} size="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{p.full_name}</p>
                    <p className="truncate text-xs text-muted">{p.college_email}</p>
                  </div>
                  <span className="text-muted" aria-hidden="true">›</span>
                </Link>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conversations */}
      {loading ? (
        <PageLoader />
      ) : convos.length === 0 ? (
        <EmptyState
          icon="💬"
          title="No chats yet"
          subtitle="Search a classmate by their college email to start a conversation."
        />
      ) : (
        <MotionList className="mt-3 space-y-2">
          {convos.map((v) => (
            <MotionItem key={v.partner_id}>
              <Link
                to={`/chats/${v.partner_id}`}
                className="glass flex items-center gap-3 rounded-2xl p-3 active:bg-white/5"
              >
                <Avatar url={v.avatar_url} name={v.full_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-semibold text-ink">
                      {v.full_name}
                      {v.i_blocked && <span className="ml-1.5 text-xs text-muted">🚫 blocked</span>}
                    </p>
                    <span className="shrink-0 text-xs text-muted">{relTime(v.last_at)}</span>
                  </div>
                  <p className={`truncate text-sm ${v.unread > 0 ? 'font-semibold text-ink' : 'text-muted'}`}>
                    {v.last_from_me ? 'You: ' : ''}
                    {v.last_body}
                  </p>
                </div>
                {v.unread > 0 && (
                  <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-black">
                    {v.unread > 99 ? '99+' : v.unread}
                  </span>
                )}
              </Link>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </div>
  )
}
