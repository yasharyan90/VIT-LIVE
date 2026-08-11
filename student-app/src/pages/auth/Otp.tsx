import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Spinner, ErrorText } from '../../components/ui'
import { AuthLayout, inputClass, labelClass, primaryBtnClass } from './AuthLayout'
import { clearPending, getPending, setPending } from './pending'

export function OtpPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [pending] = useState(getPending)
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState(pending?.devOtp)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (!pending) navigate('/signup', { replace: true })
  }, [pending, navigate])

  if (!pending) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (otp.length !== 6) {
      setError('Enter the 6-digit code')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await api<{ message: string }>('/auth/verify-otp', {
        body: { college_email: pending.email, otp },
        auth: false,
      })
      // Auto-login with the password they set during signup.
      try {
        await login(pending.email, pending.password)
        clearPending()
        navigate('/', { replace: true })
      } catch {
        clearPending()
        setError(null)
        navigate('/login', { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
      setBusy(false)
    }
  }

  const resend = async () => {
    setResending(true)
    setError(null)
    setInfo(null)
    try {
      const data = await api<{ message: string; dev_otp?: string }>('/auth/resend-otp', {
        body: { college_email: pending.email },
        auth: false,
      })
      setInfo('A new code has been sent to your email.')
      if (data.dev_otp) {
        setDevOtp(data.dev_otp)
        setPending({ ...pending, devOtp: data.dev_otp })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code')
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout>
      <h2 className="mb-1 text-2xl font-bold text-ink">Check your inbox</h2>
      <p className="mb-6 text-sm text-muted">
        We sent a 6-digit code to <span className="font-semibold text-ink">{pending.email}</span>.
        It expires in 10 minutes.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="otp" className={labelClass}>
            Verification code
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            placeholder="••••••"
            className={`${inputClass} text-center text-2xl font-bold tracking-[0.5em]`}
          />
          {devOtp && (
            <p className="mt-1.5 text-xs text-muted">
              Dev OTP: <span className="font-mono font-semibold text-primary-light">{devOtp}</span>
            </p>
          )}
        </div>
        <ErrorText message={error} />
        {info && <p className="text-sm font-medium text-success">{info}</p>}
        <button type="submit" disabled={busy} className={primaryBtnClass}>
          {busy ? <Spinner className="h-5 w-5 border-black/25 border-t-black" /> : 'Verify'}
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={resending || busy}
          className="min-h-11 w-full text-sm font-semibold text-primary-light disabled:opacity-60"
        >
          {resending ? 'Sending…' : "Didn't get it? Resend code"}
        </button>
      </form>
    </AuthLayout>
  )
}
