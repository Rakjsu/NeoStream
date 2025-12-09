import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Welcome } from './pages/Welcome';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Home } from './pages/Home';
import { LiveTV } from './pages/LiveTV';
import { VOD } from './pages/VOD';
import { Series } from './pages/Series';
import { Settings } from './pages/Settings';
import { WatchLater } from './pages/WatchLater';
import { Favorites } from './pages/Favorites';
import { Downloads } from './pages/Downloads';
import { ProfileSelector } from './pages/ProfileSelector';
import { UpdateNotification } from './components/UpdateNotification';
import { PostUpdateChangelog } from './components/PostUpdateChangelog';
import { profileService } from './services/profileService';
import { useState, useEffect } from 'react';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileSelected, setProfileSelected] = useState(false);

  useEffect(() => {
    // Force refresh content by clearing cache timestamp
    localStorage.removeItem('contentLastFetch');

    // Initialize theme color from localStorage
    const savedThemeColor = localStorage.getItem('neostream_themeColor') as 'purple' | 'blue' | 'green' | 'red' | 'pink' | null;
    if (savedThemeColor) {
      const colors = {
        purple: { primary: '#a855f7', secondary: '#7c3aed', gradient: 'linear-gradient(135deg, #a855f7, #7c3aed)', primaryRgb: '168, 85, 247', secondaryRgb: '124, 58, 237' },
        blue: { primary: '#3b82f6', secondary: '#2563eb', gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)', primaryRgb: '59, 130, 246', secondaryRgb: '37, 99, 235' },
        green: { primary: '#10b981', secondary: '#059669', gradient: 'linear-gradient(135deg, #10b981, #059669)', primaryRgb: '16, 185, 129', secondaryRgb: '5, 150, 105' },
        red: { primary: '#ef4444', secondary: '#dc2626', gradient: 'linear-gradient(135deg, #ef4444, #dc2626)', primaryRgb: '239, 68, 68', secondaryRgb: '220, 38, 38' },
        pink: { primary: '#ec4899', secondary: '#db2777', gradient: 'linear-gradient(135deg, #ec4899, #db2777)', primaryRgb: '236, 72, 153', secondaryRgb: '219, 39, 119' }
      };
      const color = colors[savedThemeColor];
      document.documentElement.style.setProperty('--theme-primary', color.primary);
      document.documentElement.style.setProperty('--theme-secondary', color.secondary);
      document.documentElement.style.setProperty('--theme-gradient', color.gradient);
      document.documentElement.style.setProperty('--theme-primary-rgb', color.primaryRgb);
      document.documentElement.style.setProperty('--theme-secondary-rgb', color.secondaryRgb);
    }

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
    <>
      <UpdateNotification />
      <PostUpdateChangelog />
      <HashRouter>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" replace />}
          >
            <Route index element={<Navigate to="home" replace />} />
            <Route path="home" element={<Home />} />
            <Route path="live" element={<LiveTV />} />
            <Route path="vod" element={<VOD />} />
            <Route path="series" element={<Series />} />
            <Route path="watch-later" element={<WatchLater />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="downloads" element={<Downloads />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route
            path="/"
            element={isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/welcome" />}
          />
        </Routes>
      </HashRouter>
    </>
  );
}

export default App;
