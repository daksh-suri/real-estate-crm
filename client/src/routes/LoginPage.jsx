import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { APP_NAME } from '../config';
import { Button, Field, Input } from '../components/ui/controls';
import { ErrorState } from '../components/ui/data';
import './routes.css';

// Login is refresh-free by construction: one bootstrap login call, 401 shows
// inline, success navigates. No authenticated calls happen on this page.
export default function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const expired = new URLSearchParams(location.search).get('expired') === '1';

  if (status === 'authenticated') {
    return <Navigate to="/app/dashboard" replace />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ email: email.trim(), password, organizationId: organizationId.trim() });
      const from = location.state?.from || '/app/dashboard';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <h1 className="login-card__title">{APP_NAME}</h1>
        <p className="login-card__subtitle">Sign in to your organization workspace</p>
        {expired && status !== 'booting' && (
          <p className="login-card__notice" role="status">
            Your session expired. Please sign in again.
          </p>
        )}
        <Field label="Work email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <Field
          label="Organization ID"
          hint="Temporary: paste your organization ID until org discovery lands (open item)."
        >
          <Input value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required placeholder="UUID" />
        </Field>
        {error && (
          <ErrorState
            message={error.status === 401 ? 'Invalid email, password, or organization.' : error.message}
            details={error.details ? JSON.stringify(error.details) : null}
          />
        )}
        <Button variant="primary" size="lg" type="submit" disabled={busy || status === 'booting'}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
