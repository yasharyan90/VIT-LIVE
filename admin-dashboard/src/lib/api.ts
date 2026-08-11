import type { User } from '../types'

const BASE = '/api/v1'

const ACCESS_KEY = 'vitlive_access_token'
const REFRESH_KEY = 'vitlive_refresh_token'
const USER_KEY = 'vitlive_user'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY)
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function storeSession(access: string, refresh: string, user?: User) {
  localStorage.setItem(ACCESS_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
}

/** Fired when the session becomes invalid (refresh failed). */
export const SESSION_EXPIRED_EVENT = 'vitlive:session-expired'

async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (data && typeof data.error === 'string') return data.error
  } catch {
    // not JSON
  }
  return `Request failed (${res.status})`
}

let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = localStorage.getItem(REFRESH_KEY)
      if (!refreshToken) return false
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (!res.ok) return false
        const data = await res.json()
        if (!data.access_token || !data.refresh_token) return false
        storeSession(data.access_token, data.refresh_token)
        return true
      } catch {
        return false
      }
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export interface ApiOptions {
  method?: string
  /** JSON body — serialized automatically. */
  body?: unknown
  /** Multipart body — sent as-is (no Content-Type header set). */
  formData?: FormData
  /** Skip Authorization header (public endpoints). */
  noAuth?: boolean
}

async function doFetch(path: string, opts: ApiOptions): Promise<Response> {
  const headers: Record<string, string> = {}
  if (!opts.noAuth) {
    const token = getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  let body: BodyInit | undefined
  if (opts.formData) {
    body = opts.formData
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  return fetch(`${BASE}${path}`, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  })
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res = await doFetch(path, opts)

  if (res.status === 401 && !opts.noAuth) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      res = await doFetch(path, opts)
    } else {
      clearSession()
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      throw new ApiError('Session expired. Please log in again.', 401)
    }
  }

  if (!res.ok) {
    throw new ApiError(await extractError(res), res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
