import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import type { Role, User } from '../types'
import { Card, EmptyState, PageTitle, RoleBadge, Spinner, inputCls } from '../components/ui'

const ROLES: Role[] = ['student', 'club_admin', 'dept_admin', 'moderator', 'super_admin']

export default function Users() {
  const { user: me } = useAuth()
  const { toast } = useToast()

  const [items, setItems] = useState<User[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (roleFilter) params.set('role', roleFilter)
      const qs = params.toString()
      api<{ items: User[] }>(`/admin/users${qs ? `?${qs}` : ''}`)
        .then((data) => {
          setItems(data.items)
          setListError(null)
        })
        .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load users'))
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q, roleFilter])

  const changeRole = async (target: User, role: Role) => {
    if (role === target.role) return
    setUpdatingId(target.id)
    try {
      const data = await api<{ user: User }>(`/admin/users/${target.id}/role`, {
        method: 'PATCH',
        body: { role },
      })
      setItems((prev) => (prev ? prev.map((u) => (u.id === target.id ? { ...u, ...data.user } : u)) : prev))
      toast(`${target.full_name} is now ${role.replace('_', ' ')}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update role', 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div>
      <PageTitle sub="Search users and manage roles">Users</PageTitle>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${inputCls} max-w-xs`}
          placeholder="Search name or email…"
          aria-label="Search users"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className={`${inputCls} max-w-44`}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {items === null && !listError && <Spinner label="Loading users…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load users: {listError}</Card>}
      {items !== null && items.length === 0 && (
        <Card>
          <EmptyState icon="👥" title="No users found" hint="Try a different search or role filter." />
        </Card>
      )}

      {items !== null && items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-900/5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Verified</th>
                <th className="px-4 py-3">Change role</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-neutral-900/5 last:border-0">
                  <td className="px-4 py-3 font-semibold text-neutral-900 whitespace-nowrap">{u.full_name}</td>
                  <td className="px-4 py-3 text-neutral-500">{u.college_email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">
                    {u.department_code ?? '—'}
                    {u.year_of_study ? ` · Yr ${u.year_of_study}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_verified ? (
                      <span className="text-success" title="Verified" aria-label="Verified">
                        ✓
                      </span>
                    ) : (
                      <span className="text-neutral-500/50" title="Not verified" aria-label="Not verified">
                        ✕
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as Role)}
                      disabled={updatingId === u.id || u.id === me?.id}
                      className="rounded-lg border border-neutral-900/10 bg-surface px-2 py-1.5 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-light/50 disabled:opacity-50"
                      aria-label={`Change role for ${u.full_name}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
