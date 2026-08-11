import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Spinner, ErrorText } from '../../components/ui'
import { AuthLayout, inputClass, labelClass, primaryBtnClass } from './AuthLayout'
import { friendlyAuthError, setPending } from './pending'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setUnverified(false)
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      if (err instanceof ApiError && err.status === 403 && /not verified/i.test(message)) {
        setUnverified(true)
        setError('Your account is not verified yet.')
      } else {
        setError(friendlyAuthError(message))
      }
    } finally {
      setBusy(false)
    }
  }

  const verifyNow = async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await api<{ message: string; dev_otp?: string }>('/auth/resend-otp', {
        body: { college_email: email.trim() },
        auth: false,
      })
      setPending({ email: email.trim(), password, devOtp: data.dev_otp })
      navigate('/verify-otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend OTP')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <h2 className="mb-1 text-2xl font-bold text-ink">Welcome back</h2>
      <p className="mb-6 text-sm text-muted">Log in with your college email.</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>
            College email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@vitstudent.ac.in"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>
        <ErrorText message={error} />
        {unverified && (
          <button
            type="button"
            onClick={verifyNow}
            disabled={busy}
            className="min-h-11 w-full rounded-xl border border-primary-light px-4 text-sm font-semibold text-primary-light"
          >
            Verify my email now
          </button>
        )}
        <button type="submit" disabled={busy} className={primaryBtnClass}>
          {busy ? <Spinner className="h-5 w-5 border-black/25 border-t-black" /> : 'Log in'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New here?{' '}
        <Link to="/signup" className="font-semibold text-primary-light">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}
