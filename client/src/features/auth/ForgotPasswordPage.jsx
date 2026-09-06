import { Link } from 'react-router-dom'
import { useState } from 'react'
import { authApi } from '.'
import { getApiError } from '../../shared/api/apiError'
import ErrorBanner from '../../shared/components/ErrorBanner/ErrorBanner'
import FormField from '../../shared/components/FormField/FormField'
import favicon from '../../assets/favicon.svg'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await authApi.requestPasswordReset({ email })
      setSubmitted(true)
    } catch (requestError) {
      setError(getApiError(requestError).message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="auth-card">
    <div className="brand brand--auth">
      <span className="brand-mark"><img src={favicon} alt="PeoplePay360" /></span>
      <div><strong>PeoplePay360</strong><small>Account recovery</small></div>
    </div>
    <div className="auth-heading"><h1>Forgot password?</h1><p>Enter your work email to receive a temporary password.</p></div>
    <ErrorBanner message={error} />
    {submitted ? <div className="alert alert--success">If an active account matches that email, a temporary password has been sent. Use it to sign in, then choose a new password.</div> : <form onSubmit={submit} className="stack">
      <FormField label="Email" htmlFor="email"><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></FormField>
      <button className="button button--full" disabled={busy}>{busy ? 'Sending…' : 'Send temporary password'}</button>
    </form>}
    <p className="auth-footnote"><Link className="button-link" to="/login">Back to sign in</Link></p>
  </div>
}
