import React, { useEffect, useState } from 'react';
import {
  errorMessage,
  finalizeRoom,
  getCandidates,
  getRatings,
  getUser,
  submitRating,
} from '../api';
import { Alert, Loader, Progress, money, km } from '../components';

/**
 * The EAT-O-METER, one card per shortlisted restaurant.
 *
 * Each rating is POSTed on its own. The server stores it, publishes
 * RATING_SUBMITTED to Kafka, and the resulting progress and ranking arrive back
 * over the WebSocket — which is why nothing here polls.
 */
export default function RatingBoard({
  roomCode,
  isHost,
  progress,
  setProgress,
  recommendations,
  setRecommendations,
  onDecided,
}) {
  const me = getUser();
  const [candidates, setCandidates] = useState([]);
  const [scores, setScores] = useState({});
  const [saved, setSaved] = useState({});
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
        setScores(Object.fromEntries(list.map((r) => [r.id, 3])));

        // Restore anything this player already rated (e.g. after a refresh).
        const existing = await getRatings(roomCode);
        if (!alive) return;
        const mine = (existing.ratings || []).filter((r) => r.userId === me?.id);
        if (mine.length) {
          setScores((s) => ({ ...s, ...Object.fromEntries(mine.map((r) => [r.restaurantId, r.score])) }));
          setSaved(Object.fromEntries(mine.map((r) => [r.restaurantId, true])));
        }
        setProgress(existing.progress);
      } catch (err) {
        if (alive) setError(errorMessage(err, 'Could not load the restaurants.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  async function rate(restaurantId) {
    setError('');
    try {
      const result = await submitRating(roomCode, restaurantId, Number(scores[restaurantId]));
      setSaved((s) => ({ ...s, [restaurantId]: true }));
      setProgress(result.progress);
    } catch (err) {
      setError(errorMessage(err, 'Could not submit that rating.'));
    }
  }

  async function rateAll() {
    setBusy(true);
    setError('');
    try {
      for (const r of candidates) {
        if (!saved[r.id]) {
          // Sequential on purpose: it keeps the Kafka event order readable
          // when demonstrating the flow.
          // eslint-disable-next-line no-await-in-loop
          const result = await submitRating(roomCode, r.id, Number(scores[r.id]));
          setSaved((s) => ({ ...s, [r.id]: true }));
          setProgress(result.progress);
        }
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not submit all ratings.'));
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

  if (loading) return <Loader label="Fetching restaurants..." />;

  const doneCount = Object.keys(saved).length;
  const allDone = candidates.length > 0 && doneCount === candidates.length;

  return (
    <div className="stack">
      <div className="card tinted stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Rate the shortlist</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              You have rated {doneCount} of {candidates.length}.
            </p>
          </div>
          {!allDone && (
            <button className="btn btn-pink btn-small" onClick={rateAll} disabled={busy}>
              Submit all
            </button>
          )}
        </div>
        <Progress value={doneCount} max={candidates.length} />
        {progress && (
          <p className="muted" style={{ margin: 0 }}>
            Group progress: {progress.membersFinished} of {progress.membersTotal} players finished
            &middot; {progress.ratingsSubmitted} ratings in.
          </p>
        )}
      </div>

      <Alert>{error}</Alert>

      <div className="resto-grid">
        {candidates.map((r) => (
          <article className="resto" key={r.id}>
            <img src={r.imageUrl} alt={r.signatureDish} loading="lazy" />
            <div className="body">
              <div className="name">{r.name}</div>
              <div className="meta">
                <span>{r.cuisine}</span>
                <span>&middot;</span>
                <span>{r.signatureDish}</span>
              </div>
              <div className="meta">
                <span>{money(r.avgCostForTwo)} for two</span>
                <span>&middot;</span>
                <span>{km(r.distanceKm)}</span>
                <span>&middot;</span>
                <span>{r.area}</span>
              </div>

              <div className="eat-o-meter">
                <span className="face" aria-hidden="true">
                  &#128542;
                </span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  aria-label={`Your rating for ${r.name}`}
                  value={scores[r.id] ?? 3}
                  onChange={(e) => setScores((s) => ({ ...s, [r.id]: e.target.value }))}
                />
                <span className="face" aria-hidden="true">
                  &#128516;
                </span>
              </div>

              <div className="button-group" style={{ justifyContent: 'space-between' }}>
                <button className="btn btn-red btn-small" onClick={() => rate(r.id)}>
                  {saved[r.id] ? `Update (${scores[r.id]})` : `Rate ${scores[r.id] ?? 3}/5`}
                </button>
                {saved[r.id] && <span className="rated-badge">Saved</span>}
              </div>
            </div>
          </article>
        ))}
      </div>

      {recommendations.length > 0 && (
        <div className="card">
          <h3>Where the group is leaning</h3>
          <p className="muted" style={{ marginTop: -6 }}>
            Updated live as ratings come in.
          </p>
          <ol className="rank-list">
            {recommendations.slice(0, 3).map((rec) => (
              <li key={rec.restaurant?.id ?? rec.rank} className={rec.rank === 1 ? 'top' : undefined}>
                <span className="rank-no">#{rec.rank}</span>
                <div className="rank-body">
                  <div style={{ fontWeight: 900 }}>{rec.restaurant?.name}</div>
                  <div className="muted">{rec.restaurant?.cuisine}</div>
                </div>
                <span className="rank-score">{Math.round(rec.score * 100)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {isHost && (
        <button className="btn btn-green" onClick={blendNow} disabled={busy || doneCount === 0}>
          {busy ? 'Blending...' : 'Blend now and decide'}
        </button>
      )}
      {!isHost && allDone && (
        <p className="center muted">
          All done. Waiting for everyone else &mdash; the result appears here automatically.
        </p>
      )}
    </div>
  );
}
