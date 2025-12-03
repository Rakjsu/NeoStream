import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Welcome } from './pages/Welcome';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { LiveTV } from './pages/LiveTV';
import { VOD } from './pages/VOD';
import { Series } from './pages/Series';
import { Settings } from './pages/Settings';
import { WatchLater } from './pages/WatchLater';
import { ProfileSelector } from './pages/ProfileSelector';
import { CategoryAnalyzer } from './components/CategoryAnalyzer';
import { profileService } from './services/profileService';
import { useState, useEffect } from 'react';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileSelected, setProfileSelected] = useState(false);

  useEffect(() => {
    // Force refresh content by clearing cache timestamp
    localStorage.removeItem('contentLastFetch');

    // Initialize profile service (migrate old data if needed)
    profileService.initialize();

    // Check if there's an active profile
    const activeProfile = profileService.getActiveProfile();
    setProfileSelected(!!activeProfile);

    // Then check auth
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

  const handleProfileSelected = () => {
    setProfileSelected(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0c0c0cff' }}>
        <div className="text-white text-xl">Carregando...</div>
      </div>
    );
  }

  // If authenticated but no profile selected, show ProfileSelector
  if (isAuthenticated && !profileSelected) {
    return <ProfileSelector onProfileSelected={handleProfileSelected} />;
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
          <Route path="category-analyzer" element={<CategoryAnalyzer />} />
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
