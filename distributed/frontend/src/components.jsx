import React from 'react';

/** Small shared pieces, kept in one file because none of them is big. */

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Loader({ label }) {
  return (
    <div className="center">
      <div className="loader" aria-hidden="true" />
      {label && <p className="muted">{label}</p>}
    </div>
  );
}

/** Where the room is in the HBI flow. */
export function Steps({ current }) {
  const steps = ['Room', 'Cuisines', 'Rate', 'Results'];
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span aria-hidden="true">&rsaquo;</span>}
          <span className={s === current ? 'on' : undefined}>{s}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function PlayerList({ members, hostId }) {
  if (!members?.length) return <p className="muted">Nobody here yet.</p>;
  return (
    <ul className="player-list">
      {members.map((m) => (
        <li key={m.userId} className={m.active ? undefined : 'inactive'}>
          <span>{m.displayName}</span>
          {m.userId === hostId && <span className="tag">HOST</span>}
          {!m.active && <span className="tag grey">LEFT</span>}
        </li>
      ))}
    </ul>
  );
}
