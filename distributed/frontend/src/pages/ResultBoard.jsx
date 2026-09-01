import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecommendations } from '../api';

const TOP_DEFAULT = 10;

/**
 * The answer to "what should our group eat?" — the group's food preferences,
 * ranked. Top 10 by default, VIEW MORE for the rest.
 */
export default function ResultBoard({
  roomCode,
  decision,
  recommendations,
  setRecommendations,
  isHost,
  onCloseRoom,
}) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);

  // Fill in the ranking if this browser joined after it was pushed.
  useEffect(() => {
    let alive = true;
    if (recommendations.length === 0) {
      getRecommendations(roomCode)
        .then((r) => {
          if (alive) setRecommendations(r.recommendations || []);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // Once decided, park the room in its final state for anyone who reloads.
  useEffect(() => {
    onCloseRoom?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ranked = recommendations.filter((rec) => rec.food);
  const visible = showAll ? ranked : ranked.slice(0, TOP_DEFAULT);
  const hasMore = ranked.length > TOP_DEFAULT;

  return (
    <div className="stack">
      <div className="card tinted">
        <h2 style={{ marginBottom: 4 }}>TOP FOOD CHOICES</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Blended from everyone&apos;s ratings
          {decision?.decidedBy === 'HOST' ? ' (the host called it)' : ''}.
        </p>

        {ranked.length === 0 ? (
          <p className="muted">The blend is done, but the ranking could not be loaded.</p>
        ) : (
          <ol className="rank-list">
            {visible.map((rec) => (
              <li key={rec.food.id} className={rec.rank === 1 ? 'top' : undefined}>
                <span className="rank-no">#{rec.rank}</span>
                {rec.food.imageUrl && <img src={rec.food.imageUrl} alt="" loading="lazy" />}
                <div className="rank-body">
                  <div style={{ fontWeight: 900 }}>{rec.food.name}</div>
                  <div className="muted">{rec.food.cuisine}</div>
                </div>
                <span className="rank-score">{Math.round(rec.score * 100)}</span>
              </li>
            ))}
          </ol>
        )}

        {hasMore && !showAll && (
          <button className="btn btn-pink" onClick={() => setShowAll(true)}>
            VIEW MORE
          </button>
        )}
      </div>

      <div className="button-group center">
        <button className="btn btn-red" onClick={() => navigate('/')}>
          Play Again
        </button>
      </div>
      {isHost && <p className="center muted">This room is now closed.</p>}
    </div>
  );
}
