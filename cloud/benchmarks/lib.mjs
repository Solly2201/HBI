/**
 * Shared helpers for the HBI Microservices measurement scripts.
 *
 * Everything goes through the API Gateway, exactly as a browser would.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080';
export const FRONTEND = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Connection-level retries, counted so they are visible.
 *
 * These cover the transport dropping the connection (ECONNRESET while the host
 * drains sockets after a load run), never an HTTP error: any response the
 * server produces, including 4xx and 5xx, is returned as-is so a measurement
 * can never be quietly "fixed" by a retry.
 */
export const transport = { retries: 0, failures: 0, timeouts: 0 };

/**
 * Per-request ceiling. Node's fetch has no default timeout, so without this a
 * request the gateway accepts but never answers blocks the whole script.
 */
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);

export async function call(method, url, {
  token, body, rawHeaders, attempts = 3, timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${GATEWAY}${url}`, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(rawHeaders || {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data };
    } catch (e) {
      lastErr = e;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') transport.timeouts += 1;
      transport.retries += 1;
      await sleep(200 * (i + 1));
    }
  }
  transport.failures += 1;
  return {
    status: 0,
    data: null,
    transportError: lastErr?.name === 'TimeoutError' ? 'TIMEOUT'
      : (lastErr?.cause?.code || lastErr?.message),
  };
}

/** Rejects if `promise` has not settled within `ms`. Never leaves a timer behind. */
export function withDeadline(promise, ms, label = 'operation') {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`DEADLINE: ${label} exceeded ${ms} ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** Starts an anonymous session, returning {token, id, displayName}. */
export async function makeUser(tag) {
  const displayName = tag.slice(0, 30);
  const session = await call('POST', '/api/users/session', { body: { displayName } });
  if (!session.data?.token) {
    throw new Error(`session failed for ${displayName}: ${session.status} ${JSON.stringify(session.data)}`);
  }
  return { token: session.data.token, id: session.data.user.id, displayName };
}

export function stompClient() {
  const require = createRequire(path.join(HERE, '..', 'frontend', 'package.json'));
  return require('@stomp/stompjs').Client;
}

/**
 * Connects a STOMP client to /ws through the gateway and subscribes to one room.
 * Every received frame is stamped with the local receive time in ms.
 */
export async function subscribeRoom(token, roomCode, onEvent, { timeoutMs = 15000 } = {}) {
  if (typeof WebSocket === 'undefined') {
    throw new Error('No global WebSocket. Run node with --experimental-websocket (Node < 22).');
  }
  const Client = stompClient();
  const wsUrl = `${GATEWAY.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;

  const client = new Client({
    webSocketFactory: () => new WebSocket(wsUrl),
    reconnectDelay: 0,
    debug: () => {},
  });

  const connected = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    client.onConnect = () => {
      clearTimeout(timer);
      client.subscribe(`/topic/rooms/${roomCode}`, (frame) => {
        const receivedAt = Date.now();
        try {
          onEvent({ ...JSON.parse(frame.body), receivedAt });
        } catch {
          /* ignore unparseable frames */
        }
      });
      setTimeout(() => resolve(true), 400);
    };
    client.onStompError = () => {
      clearTimeout(timer);
      resolve(false);
    };
    client.onWebSocketError = () => {
      clearTimeout(timer);
      resolve(false);
    };
    client.activate();
  });

  // deactivate() can wait on a RECEIPT that never arrives, so it is bounded and
  // always followed by forceDisconnect - otherwise a half-open socket keeps the
  // Node event loop alive and the script never exits.
  const close = async () => {
    try {
      await withDeadline(Promise.resolve(client.deactivate()), 3000, 'stomp deactivate');
    } catch {
      try { client.forceDisconnect(); } catch { /* already gone */ }
    }
  };

  // A failed connect still leaves an activated client holding a socket.
  if (!connected) await close();

  return { connected, client, close };
}

/** Opens a bare WebSocket and reports how it ended: open | error | closed | timeout. */
export function probeWs(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      resolve('timeout');
    }, timeoutMs);
    const done = (o) => {
      clearTimeout(timer);
      resolve(o);
    };
    ws.onopen = () => {
      ws.close();
      done('open');
    };
    ws.onerror = () => done('error');
    ws.onclose = () => done('closed');
  });
}

export async function waitFor(fn, { attempts = 60, delay = 250 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
  }
  return false;
}

// ---------------------------------------------------------------- statistics

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function stats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    min: s[0],
    avg: Math.round((sum / s.length) * 100) / 100,
    median: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1],
  };
}

// ------------------------------------------------------------- test harness

export function harness() {
  const results = [];
  return {
    results,
    check(name, condition, detail) {
      const pass = !!condition;
      results.push({ name, pass, detail: pass ? '' : String(detail ?? '') });
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && detail ? ` -- ${detail}` : ''}`);
      return pass;
    },
    section(title) {
      console.log(`\n=== ${title}`);
    },
    summary() {
      const failed = results.filter((r) => !r.pass);
      console.log(`\n${'-'.repeat(60)}`);
      console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
      failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
      return failed.length;
    },
  };
}
