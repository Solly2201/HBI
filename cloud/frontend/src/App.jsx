import React from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';

function Navbar() {
  const navigate = useNavigate();

  return (
    <header className="navbar">
      <button className="brand" onClick={() => navigate('/')} aria-label="HBI home">
        <img src="/images/logo.png" alt="HBI" />
      </button>
    </header>
  );
}

export default function App() {
  return (
    <div className="app">
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
