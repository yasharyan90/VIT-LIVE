import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { relTime } from '../lib/time'
import type { LostFoundItem } from '../lib/types'
import { Chip, PageLoader, EmptyState } from '../components/ui'
import { BackIcon } from '../components/Icons'

export function LostFoundDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const passed = (location.state as { item?: LostFoundItem } | null)?.item
  const [item, setItem] = useState<LostFoundItem | null>(
    passed && passed.id === id ? passed : null,
  )
  const [loading, setLoading] = useState(!item)
  const [resolving, setResolving] = useState(false)
  const [reported, setReported] = useState(false)

  // No single-item endpoint in the contract — fall back to fetching the list
  // and locating the item (covers deep links / refreshes).
  useEffect(() => {
    if (item || !id) return
    let cancelled = false
    api<{ items: LostFoundItem[] }>('/lostfound')
      .then((data) => {
        if (!cancelled) setItem(data.items.find((i) => i.id === id) ?? null)
      })
      .catch(() => {
        if (!cancelled) setItem(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item, id])

  const report = async () => {
    if (!item || reported) return
    try {
      await api<{ message: string }>(`/lostfound/${item.id}/report`, { method: 'POST', body: {} })
      setReported(true)
      toast('Reported — a moderator will take a look.', { kind: 'success' })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not report', { kind: 'error' })
    }
  }

  const markResolved = async () => {
    if (!item) return
    setResolving(true)
    try {
      const data = await api<{ item: LostFoundItem }>(`/lostfound/${item.id}/resolve`, {
        method: 'PATCH',
      })
      setItem(data.item)
      toast('Marked as resolved. Nice!', { kind: 'success' })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not mark resolved', { kind: 'error' })
    } finally {
      setResolving(false)
    }
  }

  if (loading) return <PageLoader />

  if (!item) {
    return (
      <div className="px-4 py-4">
        <button
          type="button"
          onClick={() => navigate('/lostfound')}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-6 w-6" />
        </button>
        <EmptyState icon="🤷" title="Item not found" subtitle="It may have been removed." />
      </div>
    )
  }

  const isPoster = user?.id === item.posted_by
  const mailSubject = encodeURIComponent(`VIT Live — about your ${item.type} item: ${item.title}`)

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2 px-4 py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-6 w-6" />
        </button>
        <h2 className="text-lg font-bold text-ink">Item details</h2>
      </div>

      {item.image_url ? (
        <img src={item.image_url} alt={item.title} className="max-h-80 w-full bg-soft object-contain" />
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-soft text-5xl">
          <span aria-hidden="true">{item.type === 'lost' ? '🔍' : '🎒'}</span>
        </div>
      )}

      <div className="space-y-4 px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-bold text-ink">{item.title}</h3>
          {item.status === 'resolved' ? (
            <Chip color="green">✓ Resolved</Chip>
          ) : (
            <Chip color={item.type === 'lost' ? 'amber' : 'blue'}>
              {item.type === 'lost' ? 'Lost' : 'Found'}
            </Chip>
          )}
        </div>

        <p className="text-[15px] leading-relaxed text-ink/85">{item.description}</p>

        <div className="rounded-xl border border-white/10 bg-soft p-3 text-sm text-ink/80">
          <p>
            📍 <span className="font-medium">{item.location}</span>
          </p>
          <p className="mt-1">
            🕐 Posted {relTime(item.created_at)} by{' '}
            <span className="font-medium">{item.poster_name}</span>
          </p>
        </div>

        {item.status === 'open' && !isPoster && (
          <a
            href={`mailto:${item.poster_email}?subject=${mailSubject}`}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary font-semibold text-black shadow-sm active:scale-[0.99]"
          >
            ✉️ Contact via email
          </a>
        )}

        {item.status === 'open' && isPoster && (
          <button
            type="button"
            onClick={() => void markResolved()}
            disabled={resolving}
            className="min-h-12 w-full rounded-xl bg-success font-semibold text-black shadow-sm active:scale-[0.99] disabled:opacity-60"
          >
            {resolving ? 'Updating…' : '✓ Mark Resolved'}
          </button>
        )}

        {!isPoster && (
          <button
            type="button"
            onClick={() => void report()}
            disabled={reported}
            className="min-h-11 w-full text-center text-sm font-semibold text-muted active:text-ink disabled:opacity-60"
          >
            {reported ? 'Reported ✓' : '⚑ Report this post'}
          </button>
        )}
      </div>
    </div>
  )
}
