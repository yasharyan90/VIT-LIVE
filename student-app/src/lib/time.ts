export function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs} sec ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: days > 300 ? 'numeric' : undefined,
  })
}

export function formatEventTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 0) return `Today · ${time}`
  if (diffDays === 1) return `Tomorrow · ${time}`
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  return `${date} · ${time}`
}

/** e.g. "closes in 2 hrs" / "closes soon" — for future timestamps. */
export function closesIn(iso: string): string {
  const secs = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (Number.isNaN(secs)) return ''
  if (secs <= 0) return 'closing now'
  if (secs < 60) return 'closes in under a minute'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `closes in ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `closes in ${hrs} hr${hrs > 1 ? 's' : ''}`
  const days = Math.floor(hrs / 24)
  return `closes in ${days} day${days > 1 ? 's' : ''}`
}

export function formatClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
