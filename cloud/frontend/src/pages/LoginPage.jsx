import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage, loginUser, registerUser, setSession } from '../api';
import { Alert } from '../components';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'register') {
        await registerUser({
          email: form.email.trim(),
          displayName: form.displayName.trim(),
          password: form.password,
        });
        // Registering does not log you in, so do it immediately afterwards.
      }
      const session = await loginUser({ email: form.email.trim(), password: form.password });
      setSession(session.token, session.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not sign you in.'));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setNotice(
      next === 'register'
        ? 'Pick any email and a password of at least 6 characters.'
        : ''
    );
  }

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 460, margin: '0 auto' }}>
        <img className="mascot" src="/images/angwy.png" alt="The hungry HBI bear" />

        <div className="card">
          <h1 className="center">Hungry but Indecisive?</h1>
          <p className="center muted" style={{ marginTop: 0 }}>
            Sign in to start a blend with your friends.
          </p>

          <div className="button-group center" style={{ margin: '18px 0' }}>
            <button
              className={mode === 'login' ? 'btn btn-red btn-small' : 'btn btn-pink btn-small'}
              onClick={() => switchMode('login')}
              type="button"
            >
              Log in
            </button>
            <button
              className={mode === 'register' ? 'btn btn-red btn-small' : 'btn btn-pink btn-small'}
              onClick={() => switchMode('register')}
              type="button"
            >
              Create account
            </button>
          </div>

          <form className="stack" onSubmit={submit}>
            {mode === 'register' && (
              <div className="field">
                <label htmlFor="displayName">Your name</label>
                <input
                  id="displayName"
                  type="text"
                  maxLength={40}
                  required
                  placeholder="What should we call you?"
                  value={form.displayName}
                  onChange={set('displayName')}
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={set('email')}
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                placeholder="At least 6 characters"
                value={form.password}
                onChange={set('password')}
              />
            </div>

            <Alert kind="info">{notice}</Alert>
            <Alert>{error}</Alert>

            <button className="btn btn-red" type="submit" disabled={busy}>
              {busy ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Log in'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
