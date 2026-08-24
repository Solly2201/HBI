import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, errorMessage, joinRoom } from '../api';
import { Alert } from '../components';

export default function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setError('');
    setBusy(true);
    try {
      const room = await createRoom();
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create a room.'));
      setBusy(false);
    }
  }

  async function join(e) {
    e.preventDefault();
    const wanted = code.trim().toUpperCase();
    if (!wanted) return;
    setError('');
    setBusy(true);
    try {
      await joinRoom(wanted);
      navigate(`/room/${wanted}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not join that room.'));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
        <img className="mascot" src="/images/angwy.png" alt="The hungry HBI bear" />

        <div className="card center stack">
          <h1>Let&apos;s settle this.</h1>
          <p className="muted" style={{ marginTop: -6 }}>
            Start a new blend, or join one with a room ID.
          </p>

          <button className="btn btn-red" onClick={create} disabled={busy}>
            {busy ? 'Working...' : 'Create New'}
          </button>

          <form className="stack" onSubmit={join}>
            <div className="field">
              <label htmlFor="room">Have a room ID?</label>
              <input
                id="room"
                className="code"
                type="text"
                maxLength={12}
                placeholder="HBI1234"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <button className="btn btn-pink" type="submit" disabled={busy || !code.trim()}>
              Join Room
            </button>
          </form>

          <Alert>{error}</Alert>
        </div>

        <p className="center muted">
          HBI Cloud &mdash; the same HBI, running on Spring Boot microservices behind an API
          Gateway.
        </p>
      </div>
    </main>
  );
}
