import React, { useEffect, useState } from 'react';
import {
  blendNow,
  errorMessage,
  finalizeRoom,
  getCandidates,
  getRatings,
  getUser,
  submitRating,
} from '../api';
import { Alert, Loader } from '../components';

/**
 * The EAT-O-METER, one food item at a time.
 *
 * This is the heart of HBI: foods are revealed one by one, never as a list.
 * The player sees a single dish, sets the meter, hits NEXT, and the next one
 * appears — exactly like HBI Web.
 *
 * Rating everything is optional. Once a player has rated the minimum the
 * server asks for (half the shortlist), BLEND NOW appears: "I have given
 * enough preferences, use my current ratings." Rating on to the end stays
 * available through NEXT.
 *
 * Each rating is POSTed as it happens. The server stores it, publishes the
 * event to Kafka, and group progress arrives back over the WebSocket. When
 * every player has finished — fully or via BLEND NOW — the decision is pushed
 * to everyone at once and this screen is replaced by the result.
 */
export default function RatingBoard({ roomCode, isHost, progress, setProgress, onDecided }) {
  const me = getUser();
  const [candidates, setCandidates] = useState([]);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(3);
  const [myCount, setMyCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await getCandidates(roomCode);
        if (!alive) return;
        setCandidates(list);

        // After a refresh, resume where this player left off: at the first
        // unrated food, or straight on the waiting screen if the server
        // already counts them as finished (fully rated or blended early).
        const existing = await getRatings(roomCode);
        if (!alive) return;
        const mine = new Set(
          (existing.ratings || [])
            .filter((r) => r.userId === me?.id)
            .map((r) => r.foodId)
        );
        setMyCount(mine.size);
        const serverFinished = (existing.progress?.finishedUserIds || []).includes(me?.id);
        const firstUnrated = list.findIndex((f) => !mine.has(f.id));
        if (serverFinished || (firstUnrated === -1 && list.length > 0)) {
          setFinished(true);
        } else {
          setIndex(Math.max(firstUnrated, 0));
        }
        setProgress(existing.progress);
      } catch (err) {
        if (alive) setError(errorMessage(err, 'Could not load the food list.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  async function next() {
    const current = candidates[index];
    if (!current || busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await submitRating(roomCode, current.id, Number(score));
      setProgress(result.progress);
      setMyCount((c) => c + 1);
      if (index + 1 < candidates.length) {
        setIndex(index + 1);
        setScore(3);
      } else {
        setFinished(true);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not submit that rating.'));
    } finally {
      setBusy(false);
    }
  }

  /** The player's own early finish: enough rated, use my current ratings. */
  async function blendMine() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await blendNow(roomCode);
      setProgress(result.progress);
      setFinished(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not finish yet.'));
    } finally {
      setBusy(false);
    }
  }

  /** Host only: force the group blend once enough players have rated. */
  async function forceBlend() {
    setBusy(true);
    setError('');
    try {
      onDecided(await finalizeRoom(roomCode));
    } catch (err) {
      setError(errorMessage(err, 'Could not finish the blend yet.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loader label="Warming up the EAT-O-METER..." />;

  if (candidates.length === 0) {
    return (
      <div className="stack center">
        <Alert>{error || 'No foods matched — ask the host to restart the blend.'}</Alert>
      </div>
    );
  }

  const minRequired =
    progress?.minRatingsRequired ?? Math.max(1, Math.ceil(candidates.length / 2));
  const hostCanForce = Boolean(isHost && progress?.hostCanFinalize);

  // ------------------------------------------------------------- finished
  if (finished) {
    return (
      <div className="stack center">
        <div className="game-card stack center">
          <h2>All blended!</h2>
          <div className="loader" aria-hidden="true" />
          <p className="muted" style={{ margin: 0 }}>
            Waiting for the other players to finish...
          </p>
          {progress && (
            <p className="muted" style={{ margin: 0 }}>
              {progress.membersFinished} of {progress.membersTotal} players done.
            </p>
          )}
        </div>
        <Alert>{error}</Alert>
        {hostCanForce && (
          <button className="btn btn-green" onClick={forceBlend} disabled={busy}>
            {busy ? 'Blending...' : "BLEND... (don't wait)"}
          </button>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- one food
  const f = candidates[index];
  const isLast = index === candidates.length - 1;
  const canBlendNow = myCount >= minRequired;

  return (
    <div className="stack center">
      <div className="game-card food-card" key={f.id}>
        <span className="food-count">
          {index + 1} / {candidates.length}
        </span>
        <img src={f.imageUrl} alt={f.name} />
        <h2 className="food-name">{f.name}</h2>
        <p className="food-meta muted">{f.cuisine}</p>

        <h3 className="meter-title">EAT-O-METER</h3>
        <div className="eat-o-meter">
          <span className="face" aria-hidden="true">
            &#128542;
          </span>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            aria-label={`Your rating for ${f.name}`}
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
          <span className="face" aria-hidden="true">
            &#128516;
          </span>
        </div>

        <button
          className={isLast ? 'btn btn-green' : 'btn btn-red'}
          onClick={next}
          disabled={busy}
        >
          {busy ? '...' : isLast ? 'BLEND...' : 'NEXT'}
        </button>

        {canBlendNow && !isLast && (
          <button className="btn btn-green" onClick={blendMine} disabled={busy}>
            BLEND NOW
          </button>
        )}
        {!canBlendNow && (
          <p className="muted food-hint">
            Rate {minRequired} foods to unlock BLEND NOW.
          </p>
        )}
      </div>

      <Alert>{error}</Alert>

      {progress && progress.membersFinished > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {progress.membersFinished} of {progress.membersTotal} players have finished rating.
        </p>
      )}

      {hostCanForce && (
        <button className="btn btn-pink btn-small" onClick={forceBlend} disabled={busy}>
          Force blend for everyone
        </button>
      )}
    </div>
  );
}
