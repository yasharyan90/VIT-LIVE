import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '../types'
import { api, clearSession, getStoredUser, storeSession, updateStoredUser, SESSION_EXPIRED_EVENT } from '../lib/api'
import { wsClient } from '../lib/ws'

interface LoginResponse {
  access_token: string
  refresh_token: string
  user: User
}

interface AuthContextValue {
  user: User | null
  login: (email: string, password: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  login: async () => {
    throw new Error('AuthProvider missing')
  },
  logout: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser())

  const logout = useCallback(() => {
    clearSession()
    wsClient.stop()
    setUser(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { college_email: email, password },
      noAuth: true,
    })
    if (data.user.role === 'student') {
      // Students have no admin access — do not keep the session.
      throw new Error('You do not have admin access')
    }
    storeSession(data.access_token, data.refresh_token, data.user)
    setUser(data.user)
    return data.user
  }, [])

  // Re-sync the user from the server on load: role changes (e.g. being made a
  // club admin) reach existing sessions without a manual re-login.
  useEffect(() => {
    if (!getStoredUser()) return
    api<{ user: User }>('/me')
      .then((data) => {
        updateStoredUser(data.user)
        setUser(data.user)
      })
      .catch(() => {
        // token refresh path handles real session expiry
      })
  }, [])

  // Start/stop the shared WebSocket with the session.
  useEffect(() => {
    if (user) {
      wsClient.start()
    } else {
      wsClient.stop()
    }
  }, [user])

  // Force logout when a refresh attempt fails anywhere in the app.
  useEffect(() => {
    const onExpired = () => {
      wsClient.stop()
      setUser(null)
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>
}
