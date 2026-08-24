import axios from 'axios';

/**
 * Every call in HBI Cloud goes through the API Gateway.
 *
 * There is deliberately no per-service base URL anywhere in this app: the
 * browser knows about one origin, and the gateway decides which microservice
 * actually answers. In Docker nginx forwards /api to the gateway; in dev the
 * Vite proxy does the same.
 */
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api' });

const TOKEN_KEY = 'hbi.token';
const USER_KEY = 'hbi.user';

/*
 * The session lives in sessionStorage, not localStorage: each browser tab is
 * its own player (handy at a table full of phones — and for demos with two
 * tabs), and a refresh keeps the player in their room, which mirrors the
 * reconnect behaviour of HBI Web.
 */
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = sessionStorage.getItem(USER_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    // An expired session should drop the player back to the home screen with a
    // clean slate rather than leaving them on a page that silently fails.
    if (error.response?.status === 401 && getToken()) {
      clearSession();
      if (window.location.pathname !== '/') {
        window.location.assign('/');
      }
    }
    return Promise.reject(error);
  }
);

/** Pulls a readable message out of whatever the gateway or a service returned. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  return data?.message || error?.message || fallback;
}

// ---------------------------------------------------------------- sessions

const createSession = (displayName) =>
  api.post('/users/session', { displayName }).then((r) => r.data);

/**
 * Makes sure this tab has a session for the given display name.
 *
 * There is no login: the first thing a player does is type a name, and this
 * quietly turns that name into an anonymous session token. Entering the same
 * name again reuses the session (so a refresh doesn't create a new player);
 * a different name starts a fresh one.
 */
export async function ensureSession(displayName) {
  const existing = getUser();
  if (existing && getToken() && existing.displayName === displayName) {
    return existing;
  }
  const session = await createSession(displayName);
  setSession(session.token, session.user);
  return session.user;
}

// ------------------------------------------------------------------ rooms

export const createRoom = () => api.post('/rooms').then((r) => r.data);
export const joinRoom = (code) => api.post(`/rooms/${code}/join`).then((r) => r.data);
export const getRoom = (code) => api.get(`/rooms/${code}`).then((r) => r.data);
export const getMembers = (code) => api.get(`/rooms/${code}/members`).then((r) => r.data);
export const leaveRoom = (code, userId) =>
  api.delete(`/rooms/${code}/members/${userId}`).then((r) => r.data);
export const setRoomStatus = (code, status) =>
  api.put(`/rooms/${code}/status`, { status }).then((r) => r.data);

// ------------------------------------------------------------ restaurants

export const getCuisines = () => api.get('/restaurants/cuisines').then((r) => r.data);

// ------------------------------------------------- preferences & ratings

export const submitPreferences = (code, body) =>
  api.post(`/rooms/${code}/preferences`, body).then((r) => r.data);
export const getPreferences = (code) => api.get(`/rooms/${code}/preferences`).then((r) => r.data);
export const getCandidates = (code) => api.get(`/rooms/${code}/candidates`).then((r) => r.data);
export const submitRating = (code, restaurantId, score) =>
  api.post(`/rooms/${code}/ratings`, { restaurantId, score }).then((r) => r.data);
export const getRatings = (code) => api.get(`/rooms/${code}/ratings`).then((r) => r.data);
export const getRecommendations = (code) =>
  api.get(`/rooms/${code}/recommendations`).then((r) => r.data);
export const finalizeRoom = (code) => api.post(`/rooms/${code}/finalize`).then((r) => r.data);
export const getDecision = (code) => api.get(`/rooms/${code}/decision`).then((r) => r.data);

export default api;
