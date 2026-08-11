import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import type { LostFoundItem } from '../types'
import { Card, EmptyState, PageTitle, Spinner, formatDateTime } from '../components/ui'

function TypeBadge({ type }: { type: 'lost' | 'found' }) {
  return type === 'lost' ? (
    <span className="inline-flex items-center rounded-full bg-warning/15 text-warning px-2.5 py-0.5 text-xs font-semibold uppercase">
      Lost
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-primary-light/15 text-primary px-2.5 py-0.5 text-xs font-semibold uppercase">
      Found
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'resolved') {
    return (
      <span className="inline-flex items-center rounded-full bg-success/10 text-success px-2.5 py-0.5 text-xs font-semibold">
        Resolved
      </span>
    )
  }
  if (status === 'removed') {
    return (
      <span className="inline-flex items-center rounded-full bg-neutral-100 text-neutral-500 px-2.5 py-0.5 text-xs font-semibold">
        Removed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-primary-light/10 text-primary-light px-2.5 py-0.5 text-xs font-semibold">
      Open
    </span>
  )
}

export default function LostFound() {
  const { toast } = useToast()
  const [items, setItems] = useState<LostFoundItem[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [reportedOnly, setReportedOnly] = useState(false)

  useEffect(() => {
    setItems(null)
    api<{ items: LostFoundItem[] }>(`/admin/lostfound${reportedOnly ? '?reported=true' : ''}`)
      .then((data) => setItems(data.items))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load items'))
  }, [reportedOnly])

  const remove = async (item: LostFoundItem) => {
    if (!window.confirm(`Remove "${item.title}"? This hides the post from students.`)) return
    setRemovingId(item.id)
    try {
      await api<{ message: string }>(`/admin/lostfound/${item.id}`, { method: 'DELETE' })
      setItems((prev) => (prev ? prev.map((i) => (i.id === item.id ? { ...i, status: 'removed' } : i)) : prev))
      toast('Item removed', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove item', 'error')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div>
      <PageTitle sub="Moderate lost & found posts">Lost &amp; Found</PageTitle>

      <label className="mb-4 inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-900">
        <input
          type="checkbox"
          checked={reportedOnly}
          onChange={(e) => setReportedOnly(e.target.checked)}
          className="accent-white"
        />
        Show reported posts only
      </label>

      {items === null && !listError && <Spinner label="Loading items…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load items: {listError}</Card>}
      {items !== null && items.length === 0 && (
        <Card>
          <EmptyState icon="🧳" title="No lost & found posts" hint="Student posts will appear here for moderation." />
        </Card>
      )}

      {items !== null && items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-900/5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Posted by</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const removed = item.status === 'removed'
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-neutral-900/5 last:border-0 ${removed ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            className="h-10 w-10 rounded-lg object-cover bg-neutral-100"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-500">
                            📦
                          </div>
                        )}
                        <div className="min-w-0">
                          <p
                            className={`font-semibold text-neutral-900 truncate max-w-52 ${removed ? 'line-through' : ''}`}
                          >
                            {item.title}
                          </p>
                          <p className="text-xs text-neutral-500 truncate max-w-52">{item.location}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={item.type} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-neutral-900">{item.poster_name}</p>
                      <p className="text-xs text-neutral-500">{item.poster_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={item.status} />
                        {(item.report_count ?? 0) > 0 && (
                          <span
                            className="inline-flex items-center rounded-full border border-emergency/40 bg-emergency/10 px-2 py-0.5 text-xs font-semibold text-emergency"
                            title={`${item.report_count} report(s) from students`}
                          >
                            ⚑ {item.report_count}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {!removed && (
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          disabled={removingId === item.id}
                          className="rounded-lg border border-neutral-900/10 px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-neutral-100 disabled:opacity-50 transition-colors"
                        >
                          {removingId === item.id ? 'Removing…' : 'Remove'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
