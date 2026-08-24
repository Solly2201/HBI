import { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import { getToken } from './api';

/**
 * Subscribes to /topic/rooms/{roomCode} for the life of the component.
 *
 * This is HBI Microservices' replacement for HBI Web's Socket.IO channel. The server
 * side is Spring's STOMP broker, fed by Kafka, and reached through the gateway
 * at /ws — the same single entry point every REST call uses.
 *
 * The token goes in the query string because a browser cannot set headers on a
 * WebSocket upgrade; the rating service verifies it during the handshake.
 */
export default function useRoomSocket(roomCode, onEvent) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);

  // Keep the latest handler without re-opening the socket on every render.
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!roomCode) return undefined;

    const token = getToken();
    if (!token) return undefined;

    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${scheme}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    const client = new Client({
      brokerURL: url,
      reconnectDelay: 3000,
      onConnect: () => {
        setConnected(true);
        client.subscribe(`/topic/rooms/${roomCode}`, (frame) => {
          try {
            handlerRef.current?.(JSON.parse(frame.body));
          } catch {
            // A frame we cannot parse is not worth tearing the session down.
          }
        });
      },
      onDisconnect: () => setConnected(false),
      onWebSocketClose: () => setConnected(false),
      onStompError: () => setConnected(false),
    });

    client.activate();
    return () => {
      setConnected(false);
      client.deactivate();
    };
  }, [roomCode]);

  return connected;
}
