import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..');
function src(...parts) { return readFileSync(join(clientSrc, ...parts), 'utf8'); }

describe('auth pages — login & signup', () => {
  test('LoginPage is email+password only, no organizationId', () => {
    const s = src('routes', 'LoginPage.jsx');
    expect(s).toContain('Work email');
    expect(s).toContain('Password');
    expect(s).not.toContain('Organization ID');
    expect(s).toContain('Sign up');
    expect(s).toContain('useAuth');
    // Should call login with email,password only
    expect(s).toContain('login({ email:');
    expect(s).not.toContain('organizationId');
    expect(s).toContain('Link to="/signup"');
  });

  test('SignupPage collects org + user and auto-logins', () => {
    const s = src('routes', 'SignupPage.jsx');
    expect(s).toContain('Organization name');
    expect(s).toContain('Your name');
    expect(s).toContain('Work email');
    expect(s).toContain('Password');
    expect(s).toContain('Confirm password');
    expect(s).toContain('Create workspace');
    expect(s).toContain('signup(');
    expect(s).toContain('Already have an account');
    expect(s).toContain('Link to="/login"');
    expect(s).toContain('useAuth');
    // Prevent double submit
    expect(s).toContain('if (password !== confirmPassword)');
    expect(s).toContain('disabled={busy');
  });

  test('App routing has public /login and /signup', () => {
    const app = src('App.jsx');
    expect(app).toContain('path="/login"');
    expect(app).toContain('path="/signup"');
    expect(app).toContain('SignupPage');
    expect(app).toContain('LoginPage');
  });

  test('AuthContext exposes login and signup', () => {
    const ctx = src('auth', 'AuthContext.jsx');
    expect(ctx).toContain('login');
    expect(ctx).toContain('signup');
    expect(ctx).toContain('/auth/login');
    expect(ctx).toContain('/auth/signup');
    expect(ctx).toContain('bootstrap: true');
  });
});
