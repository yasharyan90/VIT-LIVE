// Polls tab (wireframe §4.4): active-unvoted polls first, anonymity trust
// line, animated result bars, live tallies via `poll.update`.

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { api, ApiError } from '../lib/api'
import { ws } from '../lib/ws'
import { closesIn } from '../lib/time'
import { useToast } from '../lib/toast'
import type { Poll } from '../lib/types'
import { Chip, EmptyState, PageLoader, Spinner } from '../components/ui'
import { MotionItem, MotionList, spring } from '../components/motion'

export function PollsPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [justVoted, setJustVoted] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    api<{ items: Poll[] }>('/polls')
      .then((data) => {
        if (!cancelled) setPolls(data.items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load polls')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Live: new polls appear, tallies update for everyone.
  useEffect(() => {
    const offs = [
      ws.on('poll.new', (env) => {
        const poll = env.payload as Poll
        if (!poll || !poll.id) return
        setPolls((prev) => (prev.some((p) => p.id === poll.id) ? prev : [poll, ...prev]))
      }),
      ws.on('poll.update', (env) => {
        const update = env.payload as Poll
        if (!update || !update.id) return
        setPolls((prev) =>
          prev.map((p) =>
            p.id === update.id
              ? // `has_voted` is omitted on poll.update — keep our own.
                { ...update, has_voted: p.has_voted }
              : p,
          ),
        )
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const replacePoll = (poll: Poll) => {
    setPolls((prev) => prev.map((p) => (p.id === poll.id ? poll : p)))
  }

  const { active, done } = useMemo(() => {
    const active: Poll[] = []
    const done: Poll[] = []
    for (const p of polls) {
      if (!p.has_voted && !p.is_closed) active.push(p)
      else done.push(p)
    }
    return { active, done }
  }, [polls])

  return (
    <div className="px-4 py-4">
      <h2 className="mb-3 text-lg font-bold text-ink">Polls</h2>

      {error && (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <PageLoader />
      ) : polls.length === 0 ? (
        <EmptyState
          icon="📊"
          title="No polls right now"
          subtitle="When your college opens a poll, you can vote here — anonymously."
        />
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section aria-label="Polls waiting for your vote">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                Needs your vote
              </h3>
              <MotionList className="space-y-3">
                {active.map((p) => (
                  <MotionItem key={p.id}>
                    <VotingCard poll={p} onVoted={(poll) => {
                      replacePoll(poll)
                      setJustVoted((prev) => new Set(prev).add(poll.id))
                    }} onAlreadyVoted={replacePoll} />
                  </MotionItem>
                ))}
              </MotionList>
            </section>
          )}
          {done.length > 0 && (
            <section aria-label="Poll results">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                Results
              </h3>
              <MotionList className="space-y-3">
                {done.map((p) => (
                  <MotionItem key={p.id}>
                    <ResultsCard poll={p} showThanks={justVoted.has(p.id)} />
                  </MotionItem>
                ))}
              </MotionList>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// Single-poll renderer for the deep-link page: voting UI until you've
// voted (or it closed), results after.
export function PollCard({ poll, onChange }: { poll: Poll; onChange: (p: Poll) => void }) {
  if (!poll.has_voted && !poll.is_closed) {
    return <VotingCard poll={poll} onVoted={onChange} onAlreadyVoted={onChange} />
  }
  return <ResultsCard poll={poll} showThanks={false} />
}

function VotingCard({
  poll,
  onVoted,
  onAlreadyVoted,
}: {
  poll: Poll
  onVoted: (poll: Poll) => void
  onAlreadyVoted: (poll: Poll) => void
}) {
  const toast = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const toggle = (optionId: string) => {
    setSelected((prev) => {
      if (poll.allow_multiple) {
        return prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]
      }
      return prev.includes(optionId) ? [] : [optionId]
    })
  }

  const submit = async () => {
    if (selected.length === 0) return
    setBusy(true)
    try {
      const data = await api<{ poll: Poll }>(`/polls/${poll.id}/vote`, {
        body: { option_ids: selected },
      })
      onVoted({ ...data.poll, has_voted: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already voted elsewhere — refresh this poll and move it to results.
        try {
          const data = await api<{ poll: Poll }>(`/polls/${poll.id}`)
          onAlreadyVoted({ ...data.poll, has_voted: true })
        } catch {
          onAlreadyVoted({ ...poll, has_voted: true })
        }
        toast('You already voted on this poll.')
      } else {
        toast(err instanceof Error ? err.message : 'Vote failed', { kind: 'error' })
        setBusy(false)
      }
    }
  }

  return (
    <div className="rounded-2xl glass p-4">
      <h4 className="text-[17px] font-semibold leading-snug text-ink">📊 {poll.question}</h4>
      <p className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] leading-snug text-ink/70">
        🔒 Your vote is anonymous — admins cannot see who voted what.
      </p>
      <div className="mt-3 space-y-2" role="group" aria-label="Poll options">
        {poll.options.map((opt) => {
          const isSelected = selected.includes(opt.id)
          return (
            <motion.button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              aria-pressed={isSelected}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 text-left text-[15px] font-medium transition-colors ${
                isSelected
                  ? 'border-primary/70 bg-white/10 text-ink'
                  : 'border-white/15 text-ink active:bg-white/5'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] ${
                  poll.allow_multiple ? 'rounded-md' : 'rounded-full'
                } ${isSelected ? 'border-primary bg-primary text-black' : 'border-white/30 text-transparent'}`}
              >
                {isSelected ? '✓' : ''}
              </span>
              {opt.option_text}
            </motion.button>
          )
        })}
      </div>
      {poll.allow_multiple && (
        <p className="mt-2 text-xs text-muted">You can pick more than one option.</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {poll.total_votes} vote{poll.total_votes === 1 ? '' : 's'} so far
          {poll.closes_at ? ` · ${closesIn(poll.closes_at)}` : ''}
        </span>
        <motion.button
          type="button"
          onClick={() => void submit()}
          disabled={busy || selected.length === 0}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          className="min-h-11 rounded-xl bg-primary px-6 text-sm font-semibold text-black shadow-sm disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4 border-black/25 border-t-black" /> : 'Submit'}
        </motion.button>
      </div>
    </div>
  )
}

function ResultsCard({ poll, showThanks }: { poll: Poll; showThanks: boolean }) {
  return (
    <div className="rounded-2xl glass p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[17px] font-semibold leading-snug text-ink">📊 {poll.question}</h4>
        {poll.is_closed ? <Chip color="gray">Closed</Chip> : <Chip color="green">Live</Chip>}
      </div>
      {showThanks && (
        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[13px] font-medium text-success"
        >
          ✓ Thanks, your vote is anonymous.
        </motion.p>
      )}
      <div className="mt-3 space-y-2.5">
        {poll.options.map((opt) => {
          const pct = poll.total_votes > 0 ? Math.round((opt.votes / poll.total_votes) * 100) : 0
          return <VoteBar key={opt.id} label={opt.option_text} pct={pct} votes={opt.votes} />
        })}
      </div>
      <p className="mt-3 text-sm text-muted">
        {poll.total_votes} total vote{poll.total_votes === 1 ? '' : 's'}
      </p>
    </div>
  )
}

function VoteBar({ label, pct, votes }: { label: string; pct: number; votes: number }) {
  // Springs from 0 on mount; live WS tally updates re-animate to the new pct.
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{label}</span>
        <span className="shrink-0 text-muted">
          {pct}% · {votes}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="presentation">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        />
      </div>
    </div>
  )
}
