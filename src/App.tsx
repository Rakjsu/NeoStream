import { lazy, Suspense, useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { UpdateNotification } from './components/UpdateNotification';
import { PostUpdateChangelog } from './components/PostUpdateChangelog';
import { EpisodeToast } from './components/EpisodeToast';
import { MiniPlayerProvider } from './components/MiniPlayer';
import { CustomTitleBar } from './components/CustomTitleBar';
import { profileService } from './services/profileService';

const Welcome = lazy(() => import('./pages/Welcome').then(module => ({ default: module.Welcome })));
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Home = lazy(() => import('./pages/Home').then(module => ({ default: module.Home })));
const LiveTV = lazy(() => import('./pages/LiveTV').then(module => ({ default: module.LiveTV })));
const VOD = lazy(() => import('./pages/VOD').then(module => ({ default: module.VOD })));
const Series = lazy(() => import('./pages/Series').then(module => ({ default: module.Series })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const WatchLater = lazy(() => import('./pages/WatchLater').then(module => ({ default: module.WatchLater })));
const Favorites = lazy(() => import('./pages/Favorites').then(module => ({ default: module.Favorites })));
const Downloads = lazy(() => import('./pages/Downloads').then(module => ({ default: module.Downloads })));
const PipWindow = lazy(() => import('./pages/PipWindow').then(module => ({ default: module.PipWindow })));
const ProfileSelector = lazy(() => import('./pages/ProfileSelector').then(module => ({ default: module.ProfileSelector })));

function AppLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0c0c0cff' }}>
      <div className="text-white text-xl">Carregando...</div>
    </div>
  );
}

// Wrapper component to use navigate hook inside App
function EpisodeToastWithNavigation() {
  const navigate = useNavigate();
  return <EpisodeToast onNavigateToSeries={(seriesId) => navigate(`/dashboard/series?id=${seriesId}`)} />;
}

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
    // Force navigation to dashboard after profile selection
    window.location.hash = '#/dashboard';
  };

  if (loading) {
    return <AppLoadingFallback />;
  }

  // If authenticated but no profile selected, show ProfileSelector
  if (isAuthenticated && !profileSelected) {
    return (
      <Suspense fallback={<AppLoadingFallback />}>
        <ProfileSelector onProfileSelected={handleProfileSelected} />
      </Suspense>
    );
  }

  return (
    <MiniPlayerProvider>
      <CustomTitleBar />
      <UpdateNotification />
      <PostUpdateChangelog />
      <HashRouter>
        <EpisodeToastWithNavigation />
        <Suspense fallback={<AppLoadingFallback />}>
          <Routes>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/pip" element={<PipWindow />} />
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
        </Suspense>
      </HashRouter>
    </MiniPlayerProvider>
  );
}

export default App;
