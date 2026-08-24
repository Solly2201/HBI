import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  errorMessage,
  getDecision,
  getMembers,
  getRoom,
  getUser,
  leaveRoom,
  setRoomStatus,
} from '../api';
import useRoomSocket from '../useRoomSocket';
import { Alert, Loader, Steps } from '../components';
import Lobby from './Lobby';
import Preferences from './Preferences';
import RatingBoard from './RatingBoard';
import ResultBoard from './ResultBoard';

/**
 * Drives one room through the HBI flow.
 *
 * Room state lives on the server. This component reacts to WebSocket events by
 * re-reading whatever changed, rather than trying to keep a parallel copy of
 * the room in the browser — with several players acting at once, the server is
 * the only thing worth trusting.
 */
export default function RoomPage() {
  const { code } = useParams();
  const roomCode = (code || '').toUpperCase();
  const navigate = useNavigate();
  const me = getUser();

  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [decision, setDecision] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refreshRoom = useCallback(async () => {
    const fresh = await getRoom(roomCode);
    setRoom(fresh);
    setMembers(fresh.members || []);
    return fresh;
  }, [roomCode]);

  const refreshMembers = useCallback(async () => {
    setMembers(await getMembers(roomCode));
  }, [roomCode]);

  // Initial load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refreshRoom();
        // A room that already decided should open straight on the result.
        try {
          const existing = await getDecision(roomCode);
          if (alive) setDecision(existing);
        } catch {
          // 404 simply means the blend is still running.
        }
      } catch (err) {
        if (alive) setError(errorMessage(err, 'Could not load that room.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomCode, refreshRoom]);

  const onEvent = useCallback(
    (event) => {
      switch (event.type) {
        case 'USER_JOINED':
        case 'USER_LEFT':
          refreshMembers().catch(() => {});
          break;
        case 'ROOM_CREATED':
        case 'ROOM_STATE_CHANGED':
          refreshRoom().catch(() => {});
          break;
        case 'RATING_PROGRESS':
          setProgress(event.payload);
          break;
        case 'RECOMMENDATIONS_GENERATED':
          setRecommendations(event.payload || []);
          break;
        case 'DECISION_FINALIZED':
          setDecision(event.payload);
          break;
        default:
          break;
      }
    },
    [refreshMembers, refreshRoom]
  );

  const connected = useRoomSocket(roomCode, onEvent);

  const isHost = room && me && room.hostUserId === me.id;

  async function advance(status) {
    setError('');
    try {
      setRoom(await setRoomStatus(roomCode, status));
    } catch (err) {
      setError(errorMessage(err, 'Could not move the room forward.'));
    }
  }

  async function quit() {
    try {
      await leaveRoom(roomCode, me.id);
    } catch {
      // Leaving is best-effort; go home either way.
    }
    navigate('/');
  }

  if (loading) return <main className="page"><Loader label="Opening the room..." /></main>;

  if (!room) {
    return (
      <main className="page">
        <div className="stack" style={{ maxWidth: 460, margin: '0 auto' }}>
          <Alert>{error || 'Room not found.'}</Alert>
          <button className="btn btn-red" onClick={() => navigate('/')}>
            Back to home
          </button>
        </div>
      </main>
    );
  }

  // A finished blend wins over whatever status the room service last reported.
  const phase = decision ? 'DECIDED' : room.status;
  const stepName =
    { LOBBY: 'Lobby', PREFERENCES: 'Preferences', RATING: 'Rate', DECIDED: 'Result' }[phase] ||
    'Lobby';

  return (
    <main className="page">
      <div className="stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <Steps current={stepName} />
            <h1 style={{ marginBottom: 4 }}>Room {room.code}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {members.filter((m) => m.active).length} of {room.maxMembers} players
              {connected ? ' - live' : ' - reconnecting...'}
            </p>
          </div>
          <button className="btn btn-pink btn-small" onClick={quit}>
            Leave room
          </button>
        </div>

        <Alert>{error}</Alert>

        {phase === 'LOBBY' && (
          <Lobby
            room={room}
            members={members}
            isHost={isHost}
            connected={connected}
            onStart={() => advance('PREFERENCES')}
          />
        )}

        {phase === 'PREFERENCES' && (
          <Preferences
            roomCode={roomCode}
            members={members}
            isHost={isHost}
            onStartRating={() => advance('RATING')}
          />
        )}

        {phase === 'RATING' && (
          <RatingBoard
            roomCode={roomCode}
            isHost={isHost}
            progress={progress}
            setProgress={setProgress}
            recommendations={recommendations}
            setRecommendations={setRecommendations}
            onDecided={(d) => setDecision(d)}
          />
        )}

        {phase === 'DECIDED' && (
          <ResultBoard
            roomCode={roomCode}
            decision={decision}
            recommendations={recommendations}
            setRecommendations={setRecommendations}
            isHost={isHost}
            onCloseRoom={() => {
              if (isHost && room.status !== 'DECIDED') advance('DECIDED');
            }}
          />
        )}
      </div>
    </main>
  );
}
