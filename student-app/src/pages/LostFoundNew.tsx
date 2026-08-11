import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { LostFoundItem } from '../lib/types'
import { useToast } from '../lib/toast'
import { Spinner, ErrorText } from '../components/ui'
import { BackIcon } from '../components/Icons'

const inputClass =
  'min-h-12 w-full rounded-xl border border-white/15 bg-soft px-4 text-[15px] text-ink placeholder:text-muted focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/15'
const labelClass = 'mb-1.5 block text-sm font-semibold text-ink'

export function LostFoundNewPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [type, setType] = useState<'lost' | 'found'>('lost')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const form = new FormData()
      form.set('type', type)
      form.set('title', title.trim())
      form.set('description', description.trim())
      form.set('location', location.trim())
      if (file) form.set('image', file)
      await api<{ item: LostFoundItem }>('/lostfound', { form })
      toast('Posted! Your item is now live.', { kind: 'success' })
      navigate('/lostfound')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post item')
      setBusy(false)
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-6 w-6" />
        </button>
        <h2 className="text-lg font-bold text-ink">New Post</h2>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="flex rounded-xl bg-soft p-1" role="radiogroup" aria-label="Post type">
          {(['lost', 'found'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`min-h-11 flex-1 rounded-lg text-sm font-semibold capitalize transition-colors ${
                type === t ? 'bg-white/10 text-ink shadow-sm' : 'text-muted'
              }`}
            >
              {t === 'lost' ? 'I lost something' : 'I found something'}
            </button>
          ))}
        </div>

        <div>
          <span className={labelClass}>Photo (optional)</span>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/20 bg-soft/50 p-3 text-muted">
            {preview ? (
              <img src={preview} alt="Selected preview" className="max-h-48 rounded-lg object-contain" />
            ) : (
              <>
                <span className="text-2xl" aria-hidden="true">
                  📷
                </span>
                <span className="text-sm font-medium">Add a photo</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && (
            <button
              type="button"
              onClick={() => setFile(null)}
              className="mt-1 min-h-11 px-1 text-sm font-semibold text-muted"
            >
              Remove photo
            </button>
          )}
        </div>

        <div>
          <label htmlFor="lf-title" className={labelClass}>
            Title
          </label>
          <input
            id="lf-title"
            type="text"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'lost' ? 'e.g. Black JBL earbuds' : 'e.g. Found: blue water bottle'}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="lf-desc" className={labelClass}>
            Description
          </label>
          <textarea
            id="lf-desc"
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any identifying details, when you last saw it…"
            className={`${inputClass} py-3`}
          />
        </div>
        <div>
          <label htmlFor="lf-loc" className={labelClass}>
            Location
          </label>
          <input
            id="lf-loc"
            type="text"
            required
            maxLength={120}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Library, 2nd floor"
            className={inputClass}
          />
        </div>

        <ErrorText message={error} />
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-primary font-semibold text-black shadow-sm active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? <Spinner className="h-5 w-5 border-black/25 border-t-black" /> : 'Post'}
        </button>
      </form>
    </div>
  )
}
