import React, { useEffect, useState } from 'react';
import {
  errorMessage,
  finalizeRoom,
  getCandidates,
  getRatings,
  getUser,
  submitRating,
} from '../api';
import { Alert, Loader, money, km } from '../components';

/**
 * The EAT-O-METER, one candidate at a time.
 *
 * This is the heart of HBI: options are revealed one by one, never as a list.
 * The player sees a single dish/restaurant, sets the meter, hits NEXT, and the
 * next candidate appears — the last one ends on BLEND... exactly like HBI Web.
 *
 * Each rating is POSTed as it happens. The server stores it, publishes
 * RATING_SUBMITTED to Kafka, and group progress arrives back over the
 * WebSocket. When every player has finished, the decision is pushed to
 * everyone at once and this screen is replaced by the result.
 */
export default function RatingBoard({ roomCode, isHost, progress, setProgress, onDecided }) {
  const me = getUser();
  const [candidates, setCandidates] = useState([]);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(3);
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

        // After a refresh, resume at the first candidate this player has not
        // rated yet instead of starting over.
        const existing = await getRatings(roomCode);
        if (!alive) return;
        const mine = new Set(
          (existing.ratings || [])
            .filter((r) => r.userId === me?.id)
            .map((r) => r.restaurantId)
        );
        const firstUnrated = list.findIndex((r) => !mine.has(r.id));
        if (firstUnrated === -1 && list.length > 0) {
          setFinished(true);
        } else {
          setIndex(Math.max(firstUnrated, 0));
        }
        setProgress(existing.progress);
      } catch (err) {
        if (alive) setError(errorMessage(err, 'Could not load the shortlist.'));
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

  async function blendNow() {
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
        <Alert>{error || 'No candidates matched — ask the host to restart the blend.'}</Alert>
      </div>
    );
  }

  // ------------------------------------------------------------- finished
  if (finished) {
    return (
      <div className="stack center">
        <div className="game-card stack center">
          <h2>All rated!</h2>
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
        {isHost && (
          <button className="btn btn-green" onClick={blendNow} disabled={busy}>
            {busy ? 'Blending...' : "BLEND... (don't wait)"}
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------- one candidate
  const r = candidates[index];
  const isLast = index === candidates.length - 1;

  return (
    <div className="stack center">
      <div className="game-card food-card" key={r.id}>
        <span className="food-count">
          {index + 1} / {candidates.length}
        </span>
        <img src={r.imageUrl} alt={r.signatureDish} />
        <h2 className="food-name">{r.signatureDish}</h2>
        <p className="food-place">{r.name}</p>
        <p className="food-meta muted">
          {r.cuisine} &middot; {money(r.avgCostForTwo)} for two &middot; {km(r.distanceKm)} &middot;{' '}
          {r.area}
        </p>

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
            aria-label={`Your rating for ${r.signatureDish} at ${r.name}`}
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
      </div>

      <Alert>{error}</Alert>

      {progress && progress.membersFinished > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {progress.membersFinished} of {progress.membersTotal} players have finished rating.
        </p>
      )}
    </div>
  );
}
