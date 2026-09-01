import { useCallback, useEffect, useState } from 'react';
import { errorMessage, getCuisines, getPreferences, getUser, submitPreferences } from '../api';
import { Alert, Loader } from '../components';

/**
 * Cuisine picking, kept in HBI's language ("SELECT CUISINES"). The group's
 * chosen cuisines decide which food items appear on the rating shortlist.
 */
export default function Preferences({ roomCode, members, isHost, connected, groupEvent, onStartRating }) {
  const [cuisines, setCuisines] = useState([]);
  const [picked, setPicked] = useState([]);
  const [group, setGroup] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Aggregates arrive from three places (initial fetch, own submit response,
  // PREFERENCES_SUBMITTED pushes); submittedBy only grows, so an older
  // aggregate that lost a race must never replace a newer one.
  const applyGroup = useCallback((next) => {
    if (!next) return;
    setGroup((g) => (g && (g.submittedBy ?? 0) > (next.submittedBy ?? 0) ? g : next));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, existing] = await Promise.all([getCuisines(), getPreferences(roomCode)]);
        if (!alive) return;
        setCuisines(list);
        applyGroup(existing);
        // The server already has this player's choices (page refresh,
        // reconnect on another tab): rebuild the locked-in view instead of
        // asking them to submit again.
        const mine = (existing.perPlayer || []).find((p) => p.userId === getUser()?.id);
        if (mine) {
          setPicked(mine.cuisines || []);
          setSubmitted(true);
        }
      } catch (err) {
        if (alive) setError(errorMessage(err, 'Could not load the cuisine list.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomCode, applyGroup]);

  // Another player submitted: the pushed aggregate updates the count live.
  useEffect(() => {
    applyGroup(groupEvent);
  }, [groupEvent, applyGroup]);

  // Events are not replayed, so anything pushed while the socket was down is
  // gone; re-reading the aggregate on every (re)connect closes that gap.
  useEffect(() => {
    if (!connected) return;
    getPreferences(roomCode).then(applyGroup).catch(() => {});
  }, [connected, roomCode, applyGroup]);

  function toggle(c) {
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  }

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const result = await submitPreferences(roomCode, { cuisines: picked });
      applyGroup(result.group);
      setSubmitted(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not save your choices.'));
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
            <h2 style={{ margin: 0 }}>SELECT CUISINES</h2>
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
              Start Rating
            </button>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Waiting for the host to start the rating round.
            </p>
          )}
        </div>
      ) : (
        <button className="btn btn-red" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Submit Choices'}
        </button>
      )}
    </div>
  );
}
