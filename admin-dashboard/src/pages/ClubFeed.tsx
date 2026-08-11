// Club social feed management: the club account posts announcements, banner
// reveals and news that followers see instantly in the student app.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import type { Club, ClubPost } from '../types'
import { Card, EmptyState, PageTitle, Spinner, inputCls, labelCls, primaryBtnCls, timeAgo } from '../components/ui'

const KIND_META: Record<ClubPost['kind'], { label: string; icon: string; cls: string }> = {
  announcement: { label: 'Announcement', icon: '📣', cls: 'border-white/20 bg-white/10 text-neutral-900' },
  banner: { label: 'Banner reveal', icon: '🎬', cls: 'border-warning/40 bg-warning/10 text-warning' },
  news: { label: 'News', icon: '📰', cls: 'border-white/15 bg-white/5 text-neutral-500' },
}

export default function ClubFeed() {
  const { user } = useAuth()
  const { toast } = useToast()
  const isSuperAdmin = user?.role === 'super_admin'

  const [clubs, setClubs] = useState<Club[]>([])
  const [clubId, setClubId] = useState('') // super admin's selection
  const [clubName, setClubName] = useState('')
  const [posts, setPosts] = useState<ClubPost[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [kind, setKind] = useState<ClubPost['kind']>('announcement')
  const [body, setBody] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [posting, setPosting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    api<{ items: Club[] }>('/clubs')
      .then((data) => {
        setClubs(data.items)
        if (data.items.length > 0) setClubId((prev) => prev || data.items[0].id)
      })
      .catch(() => toast('Failed to load clubs', 'error'))
  }, [isSuperAdmin, toast])

  const load = useCallback(() => {
    if (isSuperAdmin && !clubId) return
    setPosts(null)
    setListError(null)
    api<{ club: { id: string; name: string }; items: ClubPost[] }>(
      `/admin/club-posts${isSuperAdmin ? `?club_id=${clubId}` : ''}`,
    )
      .then((data) => {
        setClubName(data.club.name)
        setPosts(data.items)
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load posts'))
  }, [isSuperAdmin, clubId])

  useEffect(load, [load])

  const publish = async (e: FormEvent) => {
    e.preventDefault()
    if ((!body.trim() && !image) || posting) return
    setPosting(true)
    try {
      const fd = new FormData()
      fd.append('kind', kind)
      fd.append('body', body.trim())
      if (isSuperAdmin) fd.append('club_id', clubId)
      if (image) fd.append('image', image)
      const data = await api<{ post: ClubPost }>('/admin/club-posts', { method: 'POST', formData: fd })
      setPosts((prev) => [data.post, ...(prev ?? [])])
      setBody('')
      setImage(null)
      if (fileRef.current) fileRef.current.value = ''
      toast('Posted — followers see it live', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to post', 'error')
    } finally {
      setPosting(false)
    }
  }

  const remove = async (post: ClubPost) => {
    if (!window.confirm('Delete this post from the club feed?')) return
    setDeletingId(post.id)
    try {
      await api<{ message: string }>(`/admin/club-posts/${post.id}`, { method: 'DELETE' })
      setPosts((prev) => (prev ? prev.filter((p) => p.id !== post.id) : prev))
      toast('Post deleted', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <PageTitle sub="Public updates for your followers — announcements, banner reveals, news">
        Club Feed{clubName ? ` — ${clubName}` : ''}
      </PageTitle>

      {isSuperAdmin && (
        <div className="mb-6 max-w-64">
          <label htmlFor="cf-club" className={labelCls}>
            Posting as club
          </label>
          <select id="cf-club" value={clubId} onChange={(e) => setClubId(e.target.value)} className={inputCls}>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Composer */}
      <Card className="p-6 mb-8">
        <form onSubmit={publish} className="space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
            {(Object.keys(KIND_META) as ClubPost['kind'][]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  kind === k ? 'border-primary bg-primary text-black' : 'border-white/15 text-neutral-500 hover:bg-white/5'
                }`}
              >
                {KIND_META[k].icon} {KIND_META[k].label}
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`${inputCls} min-h-24 resize-y`}
            placeholder={
              kind === 'banner'
                ? 'Say a few words about the reveal — attach the banner below 🎬'
                : "What's new with the club?"
            }
            maxLength={2000}
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
              aria-label="Attach image"
              className="block text-sm text-neutral-500 file:mr-3 file:rounded-lg file:border file:border-white/15 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-neutral-900"
            />
            <button type="submit" disabled={(!body.trim() && !image) || posting} className={primaryBtnCls}>
              {posting ? 'Posting…' : 'Post to feed →'}
            </button>
          </div>
        </form>
      </Card>

      {/* Timeline */}
      {posts === null && !listError && <Spinner label="Loading posts…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load posts: {listError}</Card>}
      {posts !== null && posts.length === 0 && (
        <Card>
          <EmptyState icon="🎭" title="No posts yet" hint="Your first update will reach every follower instantly." />
        </Card>
      )}
      <div className="space-y-3 max-w-2xl">
        <AnimatePresence initial={false}>
          {posts?.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              <Card className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${KIND_META[p.kind].cls}`}>
                    {KIND_META[p.kind].icon} {KIND_META[p.kind].label}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    disabled={deletingId === p.id}
                    aria-label="Delete post"
                    className="shrink-0 rounded px-1.5 text-neutral-500 hover:text-emergency disabled:opacity-50 transition-colors"
                  >
                    ✕
                  </button>
                </div>
                {p.body && <p className="mt-2 whitespace-pre-wrap text-[15px] text-neutral-900">{p.body}</p>}
                {p.image_url && (
                  <img src={p.image_url} alt="" className="mt-3 max-h-72 rounded-lg border border-white/10 object-cover" loading="lazy" />
                )}
                <p className="mt-3 text-xs text-neutral-500">
                  {p.author_name} · {timeAgo(p.created_at)} · ❤️ {p.like_count}
                </p>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
