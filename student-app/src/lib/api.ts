// REST client: Bearer auth, single-flight refresh-on-401 with one retry,
// {error} message extraction. Base path /api/v1 (proxied to :8080 in dev).

const LS_ACCESS = 'vit_access'
const LS_REFRESH = 'vit_refresh'

let accessToken: string | null = localStorage.getItem(LS_ACCESS)
let refreshToken: string | null = localStorage.getItem(LS_REFRESH)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function setTokens(access: string, refresh: string) {
  accessToken = access
  refreshToken = refresh
  localStorage.setItem(LS_ACCESS, access)
  localStorage.setItem(LS_REFRESH, refresh)
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
  localStorage.removeItem(LS_ACCESS)
  localStorage.removeItem(LS_REFRESH)
}

export function getAccessToken(): string | null {
  return accessToken
}

export function hasSession(): boolean {
  return refreshToken !== null
}

function forceLogout() {
  clearTokens()
  window.dispatchEvent(new Event('vit:logout'))
}

let refreshing: Promise<boolean> | null = null

async function attemptRefresh(): Promise<boolean> {
  if (!refreshToken) return false
  try {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { access_token: string; refresh_token: string }
    setTokens(data.access_token, data.refresh_token)
    return true
  } catch {
    return false
  }
}

function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = attemptRefresh().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

export interface ApiOptions {
  method?: string
  body?: unknown
  form?: FormData
  /** set false for public endpoints (auth, departments) */
  auth?: boolean
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const useAuth = opts.auth !== false

  const doFetch = (): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (useAuth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    let body: BodyInit | undefined
    if (opts.form) {
      body = opts.form
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    return fetch(`/api/v1${path}`, {
      method: opts.method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
    })
  }

  let res = await doFetch()

  if (res.status === 401 && useAuth) {
    const ok = await refreshOnce()
    if (!ok) {
      forceLogout()
      throw new ApiError(401, 'Session expired — please log in again')
    }
    res = await doFetch()
    if (res.status === 401) {
      forceLogout()
      throw new ApiError(401, 'Session expired — please log in again')
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data.error === 'string' && data.error.length > 0) message = data.error
    } catch {
      // non-JSON error body; keep fallback message
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
