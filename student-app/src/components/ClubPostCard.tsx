// One post in the club social feed: club identity, kind tag, text/image,
// live likes and an expandable comment section.

import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ws } from '../lib/ws'
import { relTime } from '../lib/time'
import type { ClubPost, ClubPostComment } from '../lib/types'
import { Chip } from './ui'
import { spring } from './motion'

function CommentsSection({ postId }: { postId: string }) {
  const { user } = useAuth()
  const [comments, setComments] = useState<ClubPostComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<{ items: ClubPostComment[] }>(`/club-posts/${postId}/comments`)
      .then((data) => {
        if (!cancelled) setComments(data.items)
      })
      .catch(() => {
        if (!cancelled) setComments([])
      })
    return () => {
      cancelled = true
    }
  }, [postId])

  // Live comments from other people while the section is open.
  useEffect(() => {
    return ws.on('clubpost.comment', (env) => {
      const upd = env.payload as { post_id: string; comment?: ClubPostComment }
      if (upd.post_id !== postId || !upd.comment) return
      const incoming = upd.comment
      setComments((prev) =>
        prev === null || prev.some((c) => c.id === incoming.id) ? prev : [...prev, incoming],
      )
    })
  }, [postId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const data = await api<{ comment: ClubPostComment }>(`/club-posts/${postId}/comments`, {
        body: { body },
      })
      setComments((prev) =>
        prev === null || prev.some((c) => c.id === data.comment.id) ? prev : [...prev, data.comment],
      )
      setDraft('')
    } catch {
      // toast-less: the input keeps the draft for retry
    } finally {
      setBusy(false)
    }
  }

  const remove = async (comment: ClubPostComment) => {
    try {
      await api(`/club-posts/${postId}/comments/${comment.id}`, { method: 'DELETE' })
      setComments((prev) => (prev ? prev.filter((c) => c.id !== comment.id) : prev))
    } catch {
      // stays if delete failed
    }
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="mt-3 space-y-2.5 border-t border-white/10 pt-3">
        {comments === null ? (
          <p className="text-sm text-muted">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted">No comments yet — start the conversation.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5">
              {c.avatar_url ? (
                <img src={c.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full border border-white/15 object-cover" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-ink"
                >
                  {c.user_name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-bold text-ink">{c.user_name}</span>
                  <span className="shrink-0 text-[10px] text-muted">{relTime(c.created_at)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink/85">{c.body}</p>
              </div>
              {c.user_id === user?.id && (
                <button
                  type="button"
                  onClick={() => void remove(c)}
                  aria-label="Delete comment"
                  className="shrink-0 px-1 text-xs text-muted active:text-emergency"
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}

        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="min-h-10 flex-1 rounded-xl border border-white/15 bg-soft px-3 text-sm text-ink placeholder:text-muted focus:border-white/40 focus:outline-none"
          />
          <motion.button
            type="submit"
            disabled={!draft.trim() || busy}
            whileTap={{ scale: 0.9 }}
            transition={spring}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm text-black disabled:opacity-40"
            aria-label="Post comment"
          >
            ➤
          </motion.button>
        </form>
      </div>
    </motion.div>
  )
}

const KIND_META: Record<ClubPost['kind'], { label: string; icon: string; color: 'blue' | 'amber' | 'gray' }> = {
  announcement: { label: 'Announcement', icon: '📣', color: 'blue' },
  banner: { label: 'Banner reveal', icon: '🎬', color: 'amber' },
  news: { label: 'News', icon: '📰', color: 'gray' },
}

export function ClubPostCard({
  post,
  onChange,
  linkClub = true,
}: {
  post: ClubPost
  onChange: (p: ClubPost) => void
  linkClub?: boolean
}) {
  const [showComments, setShowComments] = useState(false)
  const [commentCount, setCommentCount] = useState(post.comment_count ?? 0)

  useEffect(() => {
    setCommentCount(post.comment_count ?? 0)
  }, [post.comment_count])

  // Live comment tally even when the section is closed.
  useEffect(() => {
    return ws.on('clubpost.comment', (env) => {
      const upd = env.payload as { post_id: string; comment_count: number }
      if (upd.post_id === post.id) setCommentCount(upd.comment_count)
    })
  }, [post.id])

  const like = async () => {
    // Optimistic; the response and the WS echo reconcile the count.
    onChange({
      ...post,
      my_like: !post.my_like,
      like_count: Math.max(0, post.like_count + (post.my_like ? -1 : 1)),
    })
    try {
      const data = await api<{ like_count: number; my_like: boolean }>(
        `/club-posts/${post.id}/like`,
        { method: 'POST' },
      )
      onChange({ ...post, like_count: data.like_count, my_like: data.my_like })
    } catch {
      onChange(post) // revert
    }
  }

  const meta = KIND_META[post.kind]
  const avatar = (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-ink"
    >
      {post.club_name.slice(0, 1).toUpperCase()}
    </span>
  )

  return (
    <article className="rounded-2xl glass p-4">
      <header className="flex items-center gap-3">
        {linkClub ? <Link to={`/clubs/${post.club_id}`}>{avatar}</Link> : avatar}
        <div className="min-w-0 flex-1">
          {linkClub ? (
            <Link to={`/clubs/${post.club_id}`} className="block truncate font-semibold text-ink">
              {post.club_name}
            </Link>
          ) : (
            <p className="truncate font-semibold text-ink">{post.club_name}</p>
          )}
          <p className="text-xs text-muted">{relTime(post.created_at)}</p>
        </div>
        <Chip color={meta.color}>
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
        </Chip>
      </header>

      {post.body && (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink/90">{post.body}</p>
      )}
      {post.image_url && (
        <img
          src={post.image_url}
          alt=""
          className="mt-3 max-h-96 w-full rounded-xl border border-white/10 bg-black object-cover"
          loading="lazy"
        />
      )}

      <footer className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            onClick={() => void like()}
            aria-pressed={post.my_like}
            aria-label="Like this post"
            whileTap={{ scale: 0.85 }}
            transition={spring}
            className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors ${
              post.my_like
                ? 'border-primary/60 bg-white/10 text-ink'
                : 'border-white/15 text-muted active:bg-white/5'
            }`}
          >
            <span aria-hidden="true">{post.my_like ? '❤️' : '🤍'}</span>
            {post.like_count > 0 && <span>{post.like_count}</span>}
          </motion.button>
          <motion.button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            aria-expanded={showComments}
            aria-label="Comments"
            whileTap={{ scale: 0.85 }}
            transition={spring}
            className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors ${
              showComments
                ? 'border-primary/60 bg-white/10 text-ink'
                : 'border-white/15 text-muted active:bg-white/5'
            }`}
          >
            <span aria-hidden="true">💬</span>
            {commentCount > 0 && <span>{commentCount}</span>}
          </motion.button>
        </div>
        {post.author_name && <span className="text-xs text-muted">by {post.author_name}</span>}
      </footer>

      <AnimatePresence initial={false}>
        {showComments && <CommentsSection postId={post.id} />}
      </AnimatePresence>
    </article>
  )
}
