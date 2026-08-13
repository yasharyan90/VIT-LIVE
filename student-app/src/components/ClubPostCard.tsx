// One post in the club social feed: club identity, kind tag, text/image,
// live like button. Used by the Clubs feed tab and each club's page.

import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { relTime } from '../lib/time'
import type { ClubPost } from '../lib/types'
import { Chip } from './ui'
import { spring } from './motion'

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
        {post.author_name && <span className="text-xs text-muted">by {post.author_name}</span>}
      </footer>
    </article>
  )
}
