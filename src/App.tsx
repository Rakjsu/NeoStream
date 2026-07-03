import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { catalogRefreshService } from './services/catalogRefreshService';
import { tvModeService } from './services/tvModeService';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Welcome } from './pages/Welcome';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ProfileSelector } from './pages/ProfileSelector';
import { UpdateNotification } from './components/UpdateNotification';
import { PostUpdateChangelog } from './components/PostUpdateChangelog';
import { EpisodeToast } from './components/EpisodeToast';
import { MiniPlayerProvider } from './components/MiniPlayer';
import { CustomTitleBar } from './components/CustomTitleBar';
import { profileService } from './services/profileService';
import { reminderService } from './services/reminderService';
import { scheduledRecordingService } from './services/scheduledRecordingService';
import { movieProgressService } from './services/movieProgressService';
import { activePlaylistService } from './services/activePlaylistService';
import { useState, useEffect, lazy, Suspense } from 'react';
import { useGamepadNavigation } from './hooks/useGamepadNavigation';

const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const LiveTV = lazy(() => import('./pages/LiveTV').then(m => ({ default: m.LiveTV })));
const EpgGuide = lazy(() => import('./pages/EpgGuide').then(m => ({ default: m.EpgGuide })));
const VOD = lazy(() => import('./pages/VOD').then(m => ({ default: m.VOD })));
const Series = lazy(() => import('./pages/Series').then(m => ({ default: m.Series })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const WatchLater = lazy(() => import('./pages/WatchLater').then(m => ({ default: m.WatchLater })));
const Favorites = lazy(() => import('./pages/Favorites').then(m => ({ default: m.Favorites })));
const Downloads = lazy(() => import('./pages/Downloads').then(m => ({ default: m.Downloads })));
const History = lazy(() => import('./pages/History').then(m => ({ default: m.History })));
const PipWindow = lazy(() => import('./pages/PipWindow').then(m => ({ default: m.PipWindow })));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0c0c0cff' }}>
      <div className="text-white text-xl">Carregando...</div>
    </div>
  );
}

// Schedules program-reminder timers on boot and navigates when the user
// clicks a fired native notification (main process sends 'notify:clicked').
function ProgramReminderBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    reminderService.scheduleAll();
    scheduledRecordingService.init();

    const handleNotifyClicked = (_event: unknown, payload: unknown) => {
      const route = (payload as { route?: string } | undefined)?.route;
      if (route) navigate(route);
    };
    window.ipcRenderer.on('notify:clicked', handleNotifyClicked);
    return () => window.ipcRenderer.off('notify:clicked', handleNotifyClicked);
  }, [navigate]);

  return null;
}

// Wrapper component to use navigate hook inside App
function EpisodeToastWithNavigation() {
  const navigate = useNavigate();
  return <EpisodeToast onNavigateToSeries={(seriesId) => navigate(`/dashboard/series?id=${seriesId}`)} />;
}

// Wraps a route element in an error boundary that auto-resets on navigation
// (keyed by pathname), so a render crash in one page shows a fallback without
// taking down the shell.
function RouteBoundary({ name, children }: { name: string; children: React.ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary name={name} resetKey={location.pathname}>{children}</ErrorBoundary>;
}

// Background catalog refresh clock (interval set in Settings -> Reproducao).
catalogRefreshService.start();
// TV mode scale/focus (Settings -> Aparencia).
tvModeService.apply();

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileSelected, setProfileSelected] = useState(false);

  // Couch mode: navigate the whole app with a gamepad (D-pad/A/B/LB/RB).
  useGamepadNavigation();

  useEffect(() => {
    // Force refresh content by clearing cache timestamp
    localStorage.removeItem('contentLastFetch');

    // Best-effort sweep of expired certification cache (30-day TTL).
    void import('./services/indexedDBCache').then(({ indexedDBCache }) =>
      indexedDBCache.cleanupExpired()
    );

    // Best-effort sweep of unbounded localStorage keys (self-throttled to 24h).
    void import('./services/storageCleanup').then(({ runStorageCleanup }) =>
      runStorageCleanup()
    );

    // Weekly background refresh of the EPG fallback mappings from the repo
    // (applies on the next boot; static maps are the fallback if it fails).
    void import('./services/epgMappingsService').then(({ refreshFromRemote }) =>
      refreshFromRemote()
    );

    const boot = async () => {
      // Resolve the active playlist id FIRST so per-(profile,playlist) scoping
      // and the per-profile→per-playlist migrations below run with a known id
      // (a playlist switch reloads the app, so this re-runs each boot).
      await activePlaylistService.init();

      // Initialize profile service (migrate old data if needed)
      profileService.initialize();

      // One-time: split the legacy global movie-progress key into per-profile
      // keys (no-op once migrated). Runs after profiles exist.
      movieProgressService.migrateLegacyGlobalProgress();

      // Check if there's an active profile
      const activeProfile = profileService.getActiveProfile();
      setProfileSelected(!!activeProfile);

      // Then check auth
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

    void boot();
  }, []);

  const handleProfileSelected = () => {
    setProfileSelected(true);
    // Force navigation to dashboard after profile selection
    window.location.hash = '#/dashboard';
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
    <MiniPlayerProvider>
      <CustomTitleBar />
      <UpdateNotification />
      <PostUpdateChangelog />
      <HashRouter>
        <ProgramReminderBridge />
        <EpisodeToastWithNavigation />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/welcome" element={<RouteBoundary name="Welcome"><Welcome /></RouteBoundary>} />
            <Route path="/pip" element={<RouteBoundary name="PiP"><PipWindow /></RouteBoundary>} />
            <Route path="/login" element={<RouteBoundary name="Login"><Login /></RouteBoundary>} />
            <Route
              path="/dashboard"
              element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" replace />}
            >
              <Route index element={<Navigate to="home" replace />} />
              <Route path="home" element={<RouteBoundary name="Home"><Home /></RouteBoundary>} />
              <Route path="live" element={<RouteBoundary name="LiveTV"><LiveTV /></RouteBoundary>} />
              <Route path="guide" element={<RouteBoundary name="EpgGuide"><EpgGuide /></RouteBoundary>} />
              <Route path="vod" element={<RouteBoundary name="VOD"><VOD /></RouteBoundary>} />
              <Route path="series" element={<RouteBoundary name="Series"><Series /></RouteBoundary>} />
              <Route path="watch-later" element={<RouteBoundary name="WatchLater"><WatchLater /></RouteBoundary>} />
              <Route path="favorites" element={<RouteBoundary name="Favorites"><Favorites /></RouteBoundary>} />
              <Route path="downloads" element={<RouteBoundary name="Downloads"><Downloads /></RouteBoundary>} />
              <Route path="history" element={<RouteBoundary name="History"><History /></RouteBoundary>} />
              <Route path="settings" element={<RouteBoundary name="Settings"><Settings /></RouteBoundary>} />
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
