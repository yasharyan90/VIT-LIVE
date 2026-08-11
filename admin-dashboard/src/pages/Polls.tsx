import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import { useWS } from '../lib/ws'
import type { Poll, WSEnvelope } from '../types'
import {
  Card,
  EmptyState,
  PageTitle,
  Spinner,
  formatDateTime,
  inputCls,
  labelCls,
  primaryBtnCls,
  secondaryBtnCls,
} from '../components/ui'

/** datetime-local → RFC3339 with local offset. */
function toRFC3339(local: string): string {
  const d = new Date(local)
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`
  )
}

export default function Polls() {
  const { toast } = useToast()

  const [polls, setPolls] = useState<Poll[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [closesAt, setClosesAt] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api<{ items: Poll[] }>('/admin/polls')
      .then((data) => setPolls(data.items))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load polls'))
  }, [])

  // Live tallies from WS: poll.update carries the full poll with fresh counts
  const onWS = useCallback((msg: WSEnvelope) => {
    if (msg.type === 'poll.update') {
      const updated = msg.payload as Poll
      setPolls((prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? { ...p, ...updated, has_voted: p.has_voted } : p)) : prev,
      )
    }
  }, [])
  useWS(onWS)

  const validOptions = options.map((o) => o.trim()).filter(Boolean)
  const formValid = question.trim().length > 0 && validOptions.length >= 2

  const setOption = (i: number, val: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)))
  }

  const removeOption = (i: number) => {
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!formValid || creating) return
    setCreating(true)
    try {
      const data = await api<{ poll: Poll }>('/admin/polls', {
        method: 'POST',
        body: {
          question: question.trim(),
          options: validOptions,
          allow_multiple: allowMultiple,
          ...(closesAt ? { closes_at: toRFC3339(closesAt) } : {}),
        },
      })
      setPolls((prev) => [data.poll, ...(prev ?? [])])
      setQuestion('')
      setOptions(['', ''])
      setAllowMultiple(false)
      setClosesAt('')
      toast('Poll created', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create poll', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <PageTitle sub="Create polls and watch results update live">Polls</PageTitle>

      <Card className="p-6 mb-8">
        <h2 className="text-[17px] font-semibold text-neutral-900 mb-4">New Poll</h2>
        <form onSubmit={create} className="space-y-4">
          <div>
            <label htmlFor="poll-q" className={labelCls}>
              Question
            </label>
            <input
              id="poll-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className={inputCls}
              placeholder="e.g. Should library hours extend to midnight?"
            />
          </div>

          <div>
            <p className={labelCls}>Options</p>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={opt}
                    onChange={(e) => setOption(i, e.target.value)}
                    className={inputCls}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Option ${i + 1}`}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="shrink-0 rounded-lg border border-neutral-900/10 px-3 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                      aria-label={`Remove option ${i + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, ''])}
              className={`${secondaryBtnCls} mt-2`}
            >
              + Add option
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-900 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="accent-[#1E3A8A] h-4 w-4"
              />
              Allow multiple selections
            </label>
            <div>
              <label htmlFor="poll-closes" className={labelCls}>
                Closes at <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="poll-closes"
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <button type="submit" disabled={!formValid || creating} className={primaryBtnCls}>
            {creating ? 'Creating…' : 'Create Poll'}
          </button>
        </form>
      </Card>

      <h2 className="text-[17px] font-semibold text-neutral-900 mb-3">Live Results</h2>
      {polls === null && !listError && <Spinner label="Loading polls…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load polls: {listError}</Card>}
      {polls !== null && polls.length === 0 && (
        <Card>
          <EmptyState icon="📊" title="No polls yet" hint="Create your first poll above." />
        </Card>
      )}
      <div className="space-y-4">
        {polls?.map((poll) => (
          <Card key={poll.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[17px] font-semibold text-neutral-900">{poll.question}</p>
              {poll.is_closed ? (
                <span className="shrink-0 inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-500">
                  Closed
                </span>
              ) : (
                <span className="shrink-0 inline-flex items-center rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                  Live
                </span>
              )}
            </div>
            <div className="mt-4 space-y-3">
              {poll.options.map((opt) => {
                const pct = poll.total_votes > 0 ? Math.round((opt.votes / poll.total_votes) * 100) : 0
                return (
                  <div key={opt.id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-neutral-900">{opt.option_text}</span>
                      <span className="text-neutral-500 tabular-nums">
                        {pct}% · {opt.votes.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary-light transition-all duration-300 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              {poll.total_votes.toLocaleString()} vote{poll.total_votes === 1 ? '' : 's'}
              {poll.allow_multiple && ' · multiple selections allowed'}
              {poll.closes_at && ` · closes ${formatDateTime(poll.closes_at)}`}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
