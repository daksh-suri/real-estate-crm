import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { APP_NAME } from '../config';
import { Button, Field, Input } from '../components/ui/controls';
import { ErrorState } from '../components/ui/data';
import './routes.css';

export default function SignupPage() {
  const { status, signup } = useAuth();
  const navigate = useNavigate();
  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/app/dashboard" replace />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError({ message: 'Passwords do not match', status: 400 });
      return;
    }
    setBusy(true);
    try {
      await signup({
        organizationName: organizationName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
        confirmPassword,
      });
      navigate('/app/dashboard', { replace: true });
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
        <p className="login-card__subtitle">Create your organization workspace</p>
        <Field label="Organization name">
          <Input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required placeholder="Acme Realty" autoComplete="organization" />
        </Field>
        <Field label="Your name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Jane Doe" autoComplete="name" />
        </Field>
        <Field label="Work email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
        </Field>
        {error && (
          <ErrorState
            message={error.message}
            details={error.details ? JSON.stringify(error.details) : null}
          />
        )}
        <Button variant="primary" size="lg" type="submit" disabled={busy || status === 'booting'}>
          {busy ? 'Creating workspace…' : 'Create workspace'}
        </Button>
        <p className="login-card__footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
