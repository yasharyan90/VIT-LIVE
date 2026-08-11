import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Department } from '../../lib/types'
import { Spinner, ErrorText } from '../../components/ui'
import { AuthLayout, inputClass, labelClass, primaryBtnClass } from './AuthLayout'
import { friendlyAuthError, setPending } from './pending'

export function SignupPage() {
  const navigate = useNavigate()
  const [departments, setDepartments] = useState<Department[]>([])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [departmentCode, setDepartmentCode] = useState('')
  const [year, setYear] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<{ items: Department[] }>('/departments', { auth: false })
      .then((data) => {
        if (!cancelled) setDepartments(data.items)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load departments — is the server running?')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!departmentCode) {
      setError('Please choose your department')
      return
    }
    setBusy(true)
    try {
      const data = await api<{ message: string; dev_otp?: string }>('/auth/signup', {
        body: {
          college_email: email.trim(),
          full_name: fullName.trim(),
          password,
          department_code: departmentCode,
          year_of_study: year,
        },
        auth: false,
      })
      setPending({ email: email.trim(), password, devOtp: data.dev_otp })
      navigate('/verify-otp')
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : 'Signup failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <h2 className="mb-1 text-2xl font-bold text-ink">Create your account</h2>
      <p className="mb-6 text-sm text-muted">Under 60 seconds, promise.</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="name" className={labelClass}>
            Full name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Priya Sharma"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="s-email" className={labelClass}>
            College email
          </label>
          <input
            id="s-email"
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
          <label htmlFor="s-password" className={labelClass}>
            Password
          </label>
          <input
            id="s-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className={inputClass}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="dept" className={labelClass}>
              Department
            </label>
            <select
              id="dept"
              required
              value={departmentCode}
              onChange={(e) => setDepartmentCode(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Select…
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.code}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label htmlFor="year" className={labelClass}>
              Year
            </label>
            <select
              id="year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className={inputClass}
            >
              {[1, 2, 3, 4, 5].map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ErrorText message={error} />
        <button type="submit" disabled={busy} className={primaryBtnClass}>
          {busy ? <Spinner className="h-5 w-5 border-black/25 border-t-black" /> : 'Sign up'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-primary-light">
          Log in
        </Link>
      </p>
    </AuthLayout>
  )
}
