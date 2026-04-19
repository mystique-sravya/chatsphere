import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { setTokenGetter } from './lib/api';
import LoginPage from './pages/Login';
import SignupPage from './pages/Signup';
import ChatPage from './pages/Chat';
import AdminPage from './pages/Admin';

// Wire token from Zustand store into the API layer
setTokenGetter(() => useAuthStore.getState().token);

export default function App() {
  const { user, isLoading, loadUser, settings } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    document.body.className = settings.theme;
  }, [settings.theme]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-lg font-medium opacity-70">Loading ChatSphere...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" />} />
      <Route path="/signup" element={!user ? <SignupPage /> : <Navigate to="/" />} />
      <Route path="/admin" element={user?.is_admin ? <AdminPage /> : <Navigate to="/" />} />
      <Route path="/" element={user ? <ChatPage /> : <Navigate to="/login" />} />
    </Routes>
  );
}
