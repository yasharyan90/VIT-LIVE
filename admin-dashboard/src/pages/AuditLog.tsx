import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AuditLog as AuditLogEntry } from '../types'
import { Card, EmptyState, PageTitle, Spinner, formatDateTime } from '../components/ui'

export default function AuditLog() {
  const [items, setItems] = useState<AuditLogEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    api<{ items: AuditLogEntry[] }>('/admin/audit-logs?limit=50')
      .then((data) => setItems(data.items))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load audit logs'))
  }, [])

  return (
    <div>
      <PageTitle sub="Recent admin actions">Audit Log</PageTitle>

      {items === null && !listError && <Spinner label="Loading audit log…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load audit log: {listError}</Card>}
      {items !== null && items.length === 0 && (
        <Card>
          <EmptyState icon="🗒️" title="No audit entries yet" hint="Admin actions will be recorded here." />
        </Card>
      )}

      {items !== null && items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-900/5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-b border-neutral-900/5 last:border-0">
                  <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{formatDateTime(entry.created_at)}</td>
                  <td className="px-4 py-3 font-semibold text-neutral-900 whitespace-nowrap">{entry.actor_name}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-mono text-primary">
                      {entry.action}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 break-all">{entry.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
