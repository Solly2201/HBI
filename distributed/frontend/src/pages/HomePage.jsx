import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, ensureSession, errorMessage, getUser, joinRoom } from '../api';
import { Alert } from '../components';

/**
 * The HBI home screen: the mascot, a name, and two buttons.
 *
 * There is no login. Typing a name and pressing Create New (or Join) quietly
 * starts an anonymous session for this tab and drops the player straight into
 * a room, exactly like HBI Web.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState(getUser()?.displayName || '');
  const [code, setCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function requireName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter your name.');
      return null;
    }
    return trimmed;
  }

  async function create() {
    const playerName = requireName();
    if (!playerName) return;
    setError('');
    setBusy(true);
    try {
      await ensureSession(playerName);
      const room = await createRoom();
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create a room.'));
      setBusy(false);
    }
  }

  async function join(e) {
    e.preventDefault();
    const playerName = requireName();
    if (!playerName) return;
    const wanted = code.trim().toUpperCase();
    if (!wanted) {
      setError('Please enter a room ID.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await ensureSession(playerName);
      await joinRoom(wanted);
      navigate(`/room/${wanted}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not join that room.'));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="home stack">
        <img className="mascot" src="/images/angwy.png" alt="A drawing of a hungry, angry bear." />

        <h1 className="center home-title">Hungry but Indecisive?</h1>

        <Alert>{error}</Alert>

        <div className="button-group center">
          <button className="btn btn-red" onClick={create} disabled={busy}>
            {busy ? 'Working...' : 'Create New'}
          </button>
          <button
            className="btn btn-red"
            type="button"
            onClick={() => setShowJoin((s) => !s)}
            disabled={busy}
          >
            Enter ID
          </button>
        </div>

        <input
          className="pill-input"
          type="text"
          maxLength={40}
          placeholder="Your Name"
          aria-label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {showJoin && (
          <form className="join-row" onSubmit={join}>
            <input
              className="pill-input code"
              type="text"
              maxLength={12}
              placeholder="Enter Room ID"
              aria-label="Room ID"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="btn btn-red" type="submit" disabled={busy}>
              Join
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
