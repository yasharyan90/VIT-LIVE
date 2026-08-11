import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import { useWS } from '../lib/ws'
import type { Announcement, Club, Department, DeliveryUpdate, WSEnvelope } from '../types'
import {
  Card,
  CountUp,
  EmptyState,
  PageTitle,
  PriorityBadge,
  Spinner,
  inputCls,
  labelCls,
  primaryBtnCls,
  secondaryBtnCls,
  timeAgo,
  formatDateTime,
} from '../components/ui'

type AudienceType = 'all' | 'department' | 'club' | 'year'

const AUDIENCE_LABELS: Record<AudienceType, string> = {
  all: 'All Students',
  department: 'Department',
  club: 'Club',
  year: 'Year',
}

export default function Announcements() {
  const { toast } = useToast()

  // List state
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<'normal' | 'high'>('normal')
  const [audienceType, setAudienceType] = useState<AudienceType>('all')
  const [departmentId, setDepartmentId] = useState('')
  const [clubId, setClubId] = useState('')
  const [year, setYear] = useState('1')
  const [image, setImage] = useState<File | null>(null)
  const [publishAt, setPublishAt] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // Reference data
  const [departments, setDepartments] = useState<Department[]>([])
  const [clubs, setClubs] = useState<Club[]>([])

  useEffect(() => {
    api<{ items: Announcement[] }>('/admin/announcements')
      .then((data) => setItems(data.items))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load announcements'))
  }, [])

  useEffect(() => {
    if (audienceType === 'department' && departments.length === 0) {
      api<{ items: Department[] }>('/departments')
        .then((data) => setDepartments(data.items))
        .catch(() => toast('Failed to load departments', 'error'))
    }
    if (audienceType === 'club' && clubs.length === 0) {
      api<{ items: Club[] }>('/clubs')
        .then((data) => setClubs(data.items))
        .catch(() => toast('Failed to load clubs', 'error'))
    }
  }, [audienceType, departments.length, clubs.length, toast])

  // Live delivery counts for announcements
  const onWS = useCallback((msg: WSEnvelope) => {
    if (msg.type === 'delivery.update') {
      const upd = msg.payload as DeliveryUpdate
      if (upd.kind === 'announcement') {
        setItems((prev) =>
          prev
            ? prev.map((a) => (a.id === upd.ref_id ? { ...a, delivered_count: upd.delivered } : a))
            : prev,
        )
      }
    }
  }, [])
  useWS(onWS)

  const audienceRef = useMemo(() => {
    switch (audienceType) {
      case 'department':
        return departmentId || null
      case 'club':
        return clubId || null
      case 'year':
        return year
      default:
        return null
    }
  }, [audienceType, departmentId, clubId, year])

  const audienceDescription = useMemo(() => {
    switch (audienceType) {
      case 'all':
        return 'All Students'
      case 'department': {
        const d = departments.find((dep) => dep.id === departmentId)
        return d ? `${d.name} (${d.code})` : 'Department'
      }
      case 'club': {
        const c = clubs.find((cl) => cl.id === clubId)
        return c ? c.name : 'Club'
      }
      case 'year':
        return `Year ${year}`
    }
  }, [audienceType, departments, departmentId, clubs, clubId, year])

  const formValid =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audienceType === 'all' ||
      audienceType === 'year' ||
      (audienceType === 'department' && !!departmentId) ||
      (audienceType === 'club' && !!clubId))

  const resetForm = () => {
    setTitle('')
    setBody('')
    setPriority('normal')
    setAudienceType('all')
    setDepartmentId('')
    setClubId('')
    setYear('1')
    setImage(null)
    setPublishAt('')
    setShowPreview(false)
  }

  const publish = async (e: FormEvent) => {
    e.preventDefault()
    if (!formValid || publishing) return
    setPublishing(true)
    const publishAtISO = publishAt ? new Date(publishAt).toISOString() : ''
    try {
      let data: { announcement: Announcement }
      if (image) {
        const fd = new FormData()
        fd.append('title', title.trim())
        fd.append('body', body.trim())
        fd.append('priority', priority)
        fd.append('audience_type', audienceType)
        if (audienceRef !== null) fd.append('audience_ref', audienceRef)
        if (publishAtISO) fd.append('publish_at', publishAtISO)
        fd.append('image', image)
        data = await api<{ announcement: Announcement }>('/admin/announcements', {
          method: 'POST',
          formData: fd,
        })
      } else {
        data = await api<{ announcement: Announcement }>('/admin/announcements', {
          method: 'POST',
          body: {
            title: title.trim(),
            body: body.trim(),
            priority,
            audience_type: audienceType,
            ...(audienceRef !== null ? { audience_ref: audienceRef } : {}),
            ...(publishAtISO ? { publish_at: publishAtISO } : {}),
          },
        })
      }
      setItems((prev) => [data.announcement, ...(prev ?? [])])
      toast(data.announcement.scheduled ? 'Announcement scheduled' : 'Announcement published', 'success')
      resetForm()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to publish', 'error')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div>
      <PageTitle sub="Publish announcements to students and review delivery">Announcements</PageTitle>

      {/* Compose */}
      <Card className="p-6 mb-8">
        <h2 className="text-[17px] font-semibold text-neutral-900 mb-4">New Announcement</h2>
        <form onSubmit={publish} className="space-y-4">
          <div>
            <label htmlFor="ann-title" className={labelCls}>
              Title
            </label>
            <input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputCls}
              placeholder="e.g. Placement drive registrations open"
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="ann-body" className={labelCls}>
              Body
            </label>
            <textarea
              id="ann-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={`${inputCls} min-h-28 resize-y`}
              placeholder="Full announcement text…"
            />
          </div>

          <div className="flex flex-wrap gap-6">
            <fieldset>
              <legend className={labelCls}>Priority</legend>
              <div className="flex gap-4 pt-1">
                {(['normal', 'high'] as const).map((p) => (
                  <label key={p} className="inline-flex items-center gap-2 text-sm text-neutral-900 cursor-pointer">
                    <input
                      type="radio"
                      name="priority"
                      value={p}
                      checked={priority === p}
                      onChange={() => setPriority(p)}
                      className="accent-[#1E3A8A]"
                    />
                    {p === 'normal' ? 'Normal' : 'High'}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex-1 min-w-48">
              <label htmlFor="ann-audience" className={labelCls}>
                Audience
              </label>
              <select
                id="ann-audience"
                value={audienceType}
                onChange={(e) => setAudienceType(e.target.value as AudienceType)}
                className={inputCls}
              >
                {(Object.keys(AUDIENCE_LABELS) as AudienceType[]).map((t) => (
                  <option key={t} value={t}>
                    {AUDIENCE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            {audienceType === 'department' && (
              <div className="flex-1 min-w-48">
                <label htmlFor="ann-dept" className={labelCls}>
                  Department
                </label>
                <select
                  id="ann-dept"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {audienceType === 'club' && (
              <div className="flex-1 min-w-48">
                <label htmlFor="ann-club" className={labelCls}>
                  Club
                </label>
                <select
                  id="ann-club"
                  value={clubId}
                  onChange={(e) => setClubId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select club…</option>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {audienceType === 'year' && (
              <div className="min-w-32">
                <label htmlFor="ann-year" className={labelCls}>
                  Year
                </label>
                <select id="ann-year" value={year} onChange={(e) => setYear(e.target.value)} className={inputCls}>
                  {['1', '2', '3', '4', '5'].map((y) => (
                    <option key={y} value={y}>
                      Year {y}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-6">
            <div className="flex-1 min-w-48">
              <label htmlFor="ann-image" className={labelCls}>
                Image (optional)
              </label>
              <input
                id="ann-image"
                type="file"
                accept="image/*"
                onChange={(e) => setImage(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-neutral-500 file:mr-3 file:rounded-lg file:border file:border-white/15 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-neutral-900"
              />
            </div>
            <div className="min-w-56">
              <label htmlFor="ann-publish-at" className={labelCls}>
                Schedule (optional — publishes later)
              </label>
              <input
                id="ann-publish-at"
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Preview */}
          {showPreview && formValid && (
            <div>
              <p className={labelCls}>Preview</p>
              <div className="rounded-xl border border-primary-light/40 bg-neutral-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <PriorityBadge priority={priority} />
                  <span className="text-xs text-neutral-500">→ {audienceDescription}</span>
                </div>
                <p className="text-[17px] font-semibold text-neutral-900">{title}</p>
                <p className="mt-1 text-[15px] text-neutral-900 whitespace-pre-wrap">{body}</p>
                <p className="mt-2 text-xs text-neutral-500">Just now</p>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              disabled={!formValid}
              className={secondaryBtnCls}
            >
              {showPreview ? 'Hide Preview' : 'Preview'}
            </button>
            <button type="submit" disabled={!formValid || publishing} className={primaryBtnCls}>
              {publishing ? 'Publishing…' : publishAt ? 'Schedule →' : 'Publish →'}
            </button>
          </div>
        </form>
      </Card>

      {/* List */}
      <h2 className="text-[17px] font-semibold text-neutral-900 mb-3">Published</h2>
      {items === null && !listError && <Spinner label="Loading announcements…" />}
      {listError && <Card className="p-6 text-sm text-neutral-500">Could not load announcements: {listError}</Card>}
      {items !== null && items.length === 0 && (
        <Card>
          <EmptyState icon="📣" title="No announcements yet" hint="Publish your first announcement above." />
        </Card>
      )}
      <div className="space-y-3">
        {items?.map((a) => (
          <Card key={a.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <PriorityBadge priority={a.priority} />
                  {a.scheduled && (
                    <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
                      ⏰ Scheduled {a.publish_at ? formatDateTime(a.publish_at) : ''}
                    </span>
                  )}
                  <span className="text-xs text-neutral-500">
                    {AUDIENCE_LABELS[a.audience_type]}
                    {a.audience_type === 'year' && a.audience_ref ? ` ${a.audience_ref}` : ''}
                  </span>
                </div>
                <p className="mt-2 text-[17px] font-semibold text-neutral-900">{a.title}</p>
                {a.image_url && (
                  <img src={a.image_url} alt="" className="mt-2 max-h-40 rounded-lg border border-white/10 object-cover" />
                )}
                <p className="mt-1 text-[15px] text-neutral-500 line-clamp-2 whitespace-pre-wrap">{a.body}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  {a.author_name} · {timeAgo(a.created_at)}
                  {(a.reaction_count ?? 0) > 0 ? ` · 👍 ${a.reaction_count}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-primary">
                  <CountUp value={a.delivered_count ?? 0} />
                </p>
                <p className="text-xs text-neutral-500">delivered</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
