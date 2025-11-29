import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Welcome } from './pages/Welcome';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { LiveTV } from './pages/LiveTV';
import { VOD } from './pages/VOD';
import { Series } from './pages/Series';
import { Settings } from './pages/Settings';
import { WatchLater } from './pages/WatchLater';
import { useState, useEffect } from 'react';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const result = await window.ipcRenderer.invoke('auth:check');
      setIsAuthenticated(result.authenticated);
    } catch (error) {
      console.error('Failed to check auth:', error);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0c0c0cff' }}>
        <div className="text-white text-xl">Carregando...</div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" replace />}
        >
          <Route index element={<Navigate to="live" replace />} />
          <Route path="live" element={<LiveTV />} />
          <Route path="vod" element={<VOD />} />
          <Route path="series" element={<Series />} />
          <Route path="watch-later" element={<WatchLater />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/welcome" />}
        />
      </Routes>
    </HashRouter>
  );
}

export default App;
