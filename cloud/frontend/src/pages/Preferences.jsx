import React, { useEffect, useState } from 'react';
import { errorMessage, getCuisines, getPreferences, submitPreferences } from '../api';
import { Alert, Loader, money, km } from '../components';

/**
 * Cuisine picking, kept in HBI's language ("SELECT CUISINES"), plus the two
 * filters the Restaurant Service can actually act on: budget and distance.
 */
export default function Preferences({ roomCode, members, isHost, onStartRating }) {
  const [cuisines, setCuisines] = useState([]);
  const [picked, setPicked] = useState([]);
  const [budget, setBudget] = useState(600);
  const [distance, setDistance] = useState(5);
  const [group, setGroup] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, existing] = await Promise.all([getCuisines(), getPreferences(roomCode)]);
        if (!alive) return;
        setCuisines(list);
        setGroup(existing);
      } catch (err) {
        if (alive) setError(errorMessage(err, 'Could not load the cuisine list.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomCode]);

  function toggle(c) {
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  }

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const result = await submitPreferences(roomCode, {
        cuisines: picked,
        maxBudget: Number(budget),
        maxDistanceKm: Number(distance),
      });
      setGroup(result.group);
      setSubmitted(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not save your preferences.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loader label="Loading cuisines..." />;

  const activeCount = members.filter((m) => m.active).length;
  const submittedCount = group?.submittedBy ?? 0;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2 style={{ margin: 0 }}>Select cuisines</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Pick anything you fancy, or none at all if you are easy either way.
            </p>
          </div>
        </div>

        <div className="chip-grid">
          {cuisines.map((c) => (
            <button
              key={c}
              type="button"
              className={picked.includes(c) ? 'chip on' : 'chip'}
              aria-pressed={picked.includes(c)}
              onClick={() => toggle(c)}
              disabled={submitted}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Your limits</h3>

        <div className="field">
          <label htmlFor="budget">Budget for two</label>
          <div className="slider-row">
            <input
              id="budget"
              type="range"
              min="100"
              max="1500"
              step="50"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              disabled={submitted}
            />
            <span className="slider-value">{money(budget)}</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="distance">How far will you go?</label>
          <div className="slider-row">
            <input
              id="distance"
              type="range"
              min="1"
              max="15"
              step="1"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              disabled={submitted}
            />
            <span className="slider-value">{km(distance)}</span>
          </div>
        </div>
      </div>

      <Alert>{error}</Alert>

      {submitted ? (
        <div className="card tinted center stack">
          <p style={{ margin: 0, fontWeight: 700 }}>
            Locked in. {submittedCount} of {activeCount} players have submitted.
          </p>
          {group?.cuisines?.length > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              The group is in the mood for: {group.cuisines.join(', ')}
            </p>
          )}
          {isHost ? (
            <button className="btn btn-green" onClick={onStartRating}>
              Everyone&apos;s in &mdash; start rating
            </button>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Waiting for the host to start the rating round.
            </p>
          )}
        </div>
      ) : (
        <button className="btn btn-red" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Submit choices'}
        </button>
      )}
    </div>
  );
}
