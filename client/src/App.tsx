import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store';
import { ToastProvider } from './ui';
import AdminPage from './pages/AdminPage';
import JoinPage from './pages/JoinPage';
import Landing from './pages/Landing';
import PhotoPage from './pages/PhotoPage';
import ScreenPage from './pages/ScreenPage';
import TeamPage from './pages/TeamPage';

export default function App() {
  const connect = useApp((s) => s.connect);
  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/photo/:code" element={<PhotoPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/screen" element={<ScreenPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
