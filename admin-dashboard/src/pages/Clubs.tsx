import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import type { Club } from '../types'
import { Card, EmptyState, PageTitle, Spinner, inputCls, labelCls, primaryBtnCls } from '../components/ui'

export default function Clubs() {
  const { user } = useAuth()
  const { toast } = useToast()
  const isSuperAdmin = user?.role === 'super_admin'

  const [clubs, setClubs] = useState<Club[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [adminDrafts, setAdminDrafts] = useState<Record<string, string>>({})
  const [assigningId, setAssigningId] = useState<string | null>(null)

  const assignAdmin = async (club: Club) => {
    const email = (adminDrafts[club.id] ?? '').trim()
    if (!email || assigningId) return
    setAssigningId(club.id)
    try {
      await api<{ club: Club; admin_email: string }>(`/admin/clubs/${club.id}/admin`, {
        method: 'PATCH',
        body: { email },
      })
      setAdminDrafts((prev) => ({ ...prev, [club.id]: '' }))
      toast(`${email} now runs ${club.name} — they can create events and scan tickets`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to assign club admin', 'error')
    } finally {
      setAssigningId(null)
    }
  }

  useEffect(() => {
    api<{ items: Club[] }>('/clubs')
      .then((data) => setClubs(data.items))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load clubs'))
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !description.trim() || creating) return
    setCreating(true)
    try {
      const data = await api<{ club: Club }>('/admin/clubs', {
        method: 'POST',
        body: { name: name.trim(), description: description.trim() },
      })
      setClubs((prev) => [data.club, ...(prev ?? [])])
      setName('')
      setDescription('')
      toast('Club created', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create club', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <PageTitle sub="Campus clubs and membership">Clubs</PageTitle>

      {isSuperAdmin && (
        <Card className="p-6 mb-8">
          <h2 className="text-[17px] font-semibold text-neutral-900 mb-4">New Club</h2>
          <form onSubmit={create} className="space-y-4">
            <div>
              <label htmlFor="club-name" className={labelCls}>
                Name
              </label>
              <input
                id="club-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                placeholder="e.g. Photography Club"
              />
            </div>
            <div>
              <label htmlFor="club-desc" className={labelCls}>
                Description
              </label>
              <textarea
                id="club-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`${inputCls} min-h-20 resize-y`}
                placeholder="What is this club about?"
              />
            </div>
            <button type="submit" disabled={!name.trim() || !description.trim() || creating} className={primaryBtnCls}>
              {creating ? 'Creating…' : 'Create Club'}
            </button>
          </form>
        </Card>
      )}

      {clubs === null && !listError && <Spinner label="Loading clubs…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load clubs: {listError}</Card>}
      {clubs !== null && clubs.length === 0 && (
        <Card>
          <EmptyState icon="🎭" title="No clubs yet" />
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {clubs?.map((club) => (
          <Card key={club.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[17px] font-semibold text-neutral-900">{club.name}</p>
              <span className="shrink-0 inline-flex items-center rounded-full bg-primary-light/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {club.member_count.toLocaleString()} member{club.member_count === 1 ? '' : 's'}
              </span>
            </div>
            <p className="mt-2 text-sm text-neutral-500 line-clamp-3">{club.description}</p>
            {isSuperAdmin && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Club account
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={adminDrafts[club.id] ?? ''}
                    onChange={(e) => setAdminDrafts((prev) => ({ ...prev, [club.id]: e.target.value }))}
                    className={`${inputCls} text-sm`}
                    placeholder="user@vitstudent.ac.in"
                    aria-label={`Assign admin for ${club.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => void assignAdmin(club)}
                    disabled={!(adminDrafts[club.id] ?? '').trim() || assigningId === club.id}
                    className="shrink-0 rounded-lg border border-white/15 px-3 text-xs font-semibold text-neutral-900 hover:bg-white/5 disabled:opacity-50 transition-colors"
                  >
                    {assigningId === club.id ? 'Assigning…' : 'Assign'}
                  </button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
