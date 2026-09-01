import { useState } from 'react';
import { PlayerList } from '../components';

export default function Lobby({ room, members, isHost, connected, onStart }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be blocked; the code is selectable anyway.
    }
  }

  const activeCount = members.filter((m) => m.active).length;

  return (
    <div className="stack">
      <div className="card tinted center stack">
        <h2>Waiting for people to join...</h2>
        <div className="roomcode" style={{ margin: '0 auto' }}>
          <strong>{room.code}</strong>
          <button className="btn btn-red btn-small" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Share this ID. Players appear here the moment they join
          {connected ? '.' : ' (reconnecting...).'}
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>
            Joined ({activeCount}/{room.maxMembers})
          </h3>
        </div>
        <PlayerList members={members} hostId={room.hostUserId} />
      </div>

      {isHost ? (
        <button
          className="btn btn-red"
          onClick={onStart}
          disabled={activeCount < 2}
          title={activeCount < 2 ? 'You need at least one more player.' : undefined}
        >
          Start Blend
        </button>
      ) : (
        <p className="center muted">Waiting for the host to start the blend.</p>
      )}
    </div>
  );
}
