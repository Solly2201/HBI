import React from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { clearSession, getToken, getUser } from './api';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';

function Navbar() {
  const navigate = useNavigate();
  const user = getUser();

  return (
    <header className="navbar">
      <button className="brand" onClick={() => navigate('/')} aria-label="HBI home">
        <img src="/images/logo.png" alt="HBI" />
        <span>CLOUD</span>
      </button>
      {user && (
        <div className="who">
          <span>{user.displayName}</span>
          <button
            className="pill"
            onClick={() => {
              clearSession();
              navigate('/login');
            }}
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}

function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <div className="app">
      <Navbar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/room/:code"
          element={
            <RequireAuth>
              <RoomPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
