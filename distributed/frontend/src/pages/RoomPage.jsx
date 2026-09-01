import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ensureSession,
  errorMessage,
  getDecision,
  getMembers,
  getRoom,
  getToken,
  getUser,
  joinRoom,
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
 * Someone opened a shared room link without a session yet: ask for a name,
 * start an anonymous session, join, and carry on. No account, no login.
 */
function NameGate({ roomCode, onReady }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function enter(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError('');
    setBusy(true);
    try {
      await ensureSession(trimmed);
      await joinRoom(roomCode);
      onReady();
    } catch (err) {
      setError(errorMessage(err, 'Could not join that room.'));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="home stack">
        <img className="mascot" src="/images/angwy.png" alt="A drawing of a hungry, angry bear." />
        <h1 className="center home-title">Joining room {roomCode}</h1>
        <Alert>{error}</Alert>
        <form className="join-row" onSubmit={enter}>
          <input
            className="pill-input"
            type="text"
            maxLength={40}
            placeholder="Your Name"
            aria-label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn btn-red" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Joining...' : 'Join'}
          </button>
        </form>
      </div>
    </main>
  );
}

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
  const [hasSession, setHasSession] = useState(() => Boolean(getToken()));
  const me = getUser();

  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [decision, setDecision] = useState(null);
  const [groupPrefs, setGroupPrefs] = useState(null);
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
    if (!hasSession) return undefined;
    let alive = true;
    (async () => {
      try {
        let fresh = await getRoom(roomCode);

        // A room that already decided should open straight on the result.
        let decided = null;
        try {
          decided = await getDecision(roomCode);
        } catch {
          // 404 simply means the blend is still running.
        }

        // Opening a shared link with a session but no membership yet: join
        // quietly, the way HBI Web admitted anyone who knew the room ID.
        const myId = getUser()?.id;
        const amIn = (fresh.members || []).some((m) => m.userId === myId && m.active);
        if (!decided && fresh.status !== 'DECIDED' && !amIn) {
          fresh = await joinRoom(roomCode);
        }

        if (!alive) return;
        setRoom(fresh);
        setMembers(fresh.members || []);
        if (decided) setDecision(decided);
      } catch (err) {
        if (alive) setError(errorMessage(err, 'Could not load that room.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomCode, hasSession]);

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
        case 'PREFERENCES_SUBMITTED':
          setGroupPrefs(event.payload);
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

  const connected = useRoomSocket(hasSession ? roomCode : null, onEvent);

  // Events are not replayed: anything that happened while the socket was down
  // (including the moment between page load and the first connect) is missed.
  // Re-reading the room on every (re)connect closes that gap.
  useEffect(() => {
    if (connected) {
      refreshRoom().catch(() => {});
    }
  }, [connected, refreshRoom]);

  if (!hasSession) {
    return <NameGate roomCode={roomCode} onReady={() => setHasSession(true)} />;
  }

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
    { LOBBY: 'Room', PREFERENCES: 'Cuisines', RATING: 'Rate', DECIDED: 'Results' }[phase] ||
    'Room';

  return (
    <main className="page">
      <div className="stack">
        <div className="room-head">
          <Steps current={stepName} />
          <button className="btn btn-pink btn-small" onClick={quit}>
            Leave
          </button>
        </div>

        <Alert>{error}</Alert>
        {!connected && <p className="center muted">Reconnecting...</p>}

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
            connected={connected}
            groupEvent={groupPrefs}
            onStartRating={() => advance('RATING')}
          />
        )}

        {phase === 'RATING' && (
          <RatingBoard
            roomCode={roomCode}
            members={members}
            isHost={isHost}
            progress={progress}
            setProgress={setProgress}
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
