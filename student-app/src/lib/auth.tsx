import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, clearTokens, hasSession, setTokens } from './api'
import { ws } from './ws'
import type { User } from './types'

interface LoginResponse {
  access_token: string
  refresh_token: string
  user: User
}

interface AuthContextValue {
  user: User | null
  booting: boolean
  login: (collegeEmail: string, password: string) => Promise<User>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!hasSession()) {
      setBooting(false)
      return
    }
    api<{ user: User }>('/me')
      .then((data) => {
        if (!cancelled) setUser(data.user)
      })
      .catch(() => {
        if (!cancelled) {
          clearTokens()
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) setBooting(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fired by the api client when a refresh fails mid-session.
  useEffect(() => {
    const onLogout = () => {
      ws.stop()
      setUser(null)
    }
    window.addEventListener('vit:logout', onLogout)
    return () => window.removeEventListener('vit:logout', onLogout)
  }, [])

  const login = useCallback(async (collegeEmail: string, password: string) => {
    const data = await api<LoginResponse>('/auth/login', {
      body: { college_email: collegeEmail, password },
      auth: false,
    })
    setTokens(data.access_token, data.refresh_token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    ws.stop()
    clearTokens()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const data = await api<{ user: User }>('/me')
    setUser(data.user)
  }, [])

  const value = useMemo(
    () => ({ user, booting, login, logout, refreshUser }),
    [user, booting, login, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
