import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/providers/authContext'
import { getApiError } from '../../shared/api/apiError'
import ErrorBanner from '../../shared/components/ErrorBanner/ErrorBanner'
import FormField from '../../shared/components/FormField/FormField'

export default function LoginPage() {
  const { login, isAuthenticated, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (isAuthenticated) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />

  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const currentUser = await login(form)
      const destination = currentUser.mustChangePassword ? '/change-password' : location.state?.from?.pathname || '/'
      navigate(destination, { replace: true })
    } catch (requestError) {
      const apiError = getApiError(requestError)
      setError(apiError.code === 'AUTH-001' ? 'Invalid email or password.' : apiError.message)
    } finally { setBusy(false) }
  }

  return <div className="auth-card"><div className="brand brand--auth">
    <span className="brand-mark">
  <img src="/favicon.svg" alt="PeoplePay360" />
</span>
<div><strong>PeoplePay360</strong><small>People and payroll, connected</small></div></div><div className="auth-heading"><h1>Welcome back</h1><p>Sign in to continue to your workspace.</p></div><ErrorBanner message={error} /><form onSubmit={submit} className="stack">
    <FormField label="Email" htmlFor="email"><input id="email" type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@company.com" /></FormField>
    <FormField label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" /></FormField>
    <button className="button button--full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form><p className="auth-footnote"><Link className="button-link" to="/forgot-password">Forgot password?</Link></p><p className="auth-footnote">Secure access for authorized PeoplePay360 users</p></div>
}
