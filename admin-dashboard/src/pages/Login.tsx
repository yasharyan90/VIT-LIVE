import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { inputCls, labelCls, primaryBtnCls } from '../components/ui'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary text-black text-xl font-bold mb-3">
            V
          </div>
          <h1 className="text-[22px] font-bold text-neutral-900">VIT Live Admin</h1>
          <p className="text-sm text-neutral-500 mt-1">Sign in to the admin dashboard</p>
        </div>

        <form onSubmit={onSubmit} className="glass rounded-2xl p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-sm text-warning font-medium">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="email" className={labelCls}>
              College email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="admin@vit.ac.in"
            />
          </div>
          <div>
            <label htmlFor="password" className={labelCls}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••••"
            />
          </div>
          <button type="submit" disabled={loading} className={`${primaryBtnCls} w-full`}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
