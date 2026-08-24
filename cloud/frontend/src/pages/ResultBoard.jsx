import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecommendations } from '../api';
import { money, km } from '../components';

export default function ResultBoard({
  roomCode,
  decision,
  recommendations,
  setRecommendations,
  isHost,
  onCloseRoom,
}) {
  const navigate = useNavigate();
  const winner = decision?.restaurant;

  // Fill in the runners-up if this browser joined after the ranking was pushed.
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

  return (
    <div className="stack">
      <div className="card tinted">
        <h2 style={{ marginBottom: 14 }}>You&apos;re eating at...</h2>
        {winner ? (
          <div className="winner">
            <img src={winner.imageUrl} alt={winner.signatureDish} />
            <div className="rank-body">
              <h1 style={{ marginBottom: 6 }}>{winner.name}</h1>
              <p style={{ margin: 0, fontWeight: 700 }}>
                {winner.cuisine} &middot; famous for {winner.signatureDish}
              </p>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                {money(winner.avgCostForTwo)} for two &middot; {km(winner.distanceKm)} away &middot;{' '}
                {winner.area}
              </p>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                Group score {Math.round((decision.finalScore ?? 0) * 100)} /100 &middot; decided{' '}
                {decision.decidedBy === 'AUTO' ? 'once everyone finished rating' : 'by the host'}.
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">The decision is in, but the restaurant details could not be loaded.</p>
        )}
      </div>

      {recommendations.length > 1 && (
        <div className="card">
          <h3>YOUR TOP MATCHES</h3>
          <ol className="rank-list">
            {recommendations.map((rec) => (
              <li key={rec.restaurant?.id ?? rec.rank} className={rec.rank === 1 ? 'top' : undefined}>
                <span className="rank-no">#{rec.rank}</span>
                {rec.restaurant?.imageUrl && (
                  <img src={rec.restaurant.imageUrl} alt="" loading="lazy" />
                )}
                <div className="rank-body">
                  <div style={{ fontWeight: 900 }}>{rec.restaurant?.name}</div>
                  <div className="muted">
                    {rec.restaurant?.cuisine} &middot; {money(rec.restaurant?.avgCostForTwo)} &middot;{' '}
                    {km(rec.restaurant?.distanceKm)}
                  </div>
                </div>
                <span className="rank-score">{Math.round(rec.score * 100)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="button-group center">
        <button className="btn btn-red" onClick={() => navigate('/')}>
          Play Again
        </button>
      </div>
      {isHost && <p className="center muted">This room is now closed.</p>}
    </div>
  );
}
