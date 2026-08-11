// Deep-link target for a single poll (/polls/:id).

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { ws } from '../lib/ws'
import type { Poll } from '../lib/types'
import { EmptyState, PageLoader } from '../components/ui'
import { BackIcon } from '../components/Icons'
import { PollCard } from './Polls'

export function PollDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [poll, setPoll] = useState<Poll | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    api<{ poll: Poll }>(`/polls/${id}`)
      .then((data) => {
        if (!cancelled) setPoll(data.poll)
      })
      .catch(() => {
        if (!cancelled) setPoll(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // Live tally updates while the page is open.
  useEffect(() => {
    return ws.on('poll.update', (env) => {
      const update = env.payload as Poll
      if (!update || update.id !== id) return
      setPoll((prev) => (prev ? { ...update, has_voted: prev.has_voted } : prev))
    })
  }, [id])

  if (loading) return <PageLoader />

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-6 w-6" />
        </button>
        <h2 className="text-lg font-bold text-ink">Poll</h2>
      </div>
      {!poll ? (
        <EmptyState icon="🤷" title="Poll not found" subtitle="It may have been closed and removed." />
      ) : (
        <PollCard poll={poll} onChange={setPoll} />
      )}
    </div>
  )
}
