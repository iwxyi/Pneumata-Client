import { lazy, Suspense, useMemo, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Box, LinearProgress, ThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import { createAppTheme } from './theme';
import { useSettingsStore } from './stores/useSettingsStore';
import { useAuthStore } from './stores/useAuthStore';
import { useCharacterStore } from './stores/useCharacterStore';
import { useCharacterArtifactStore } from './stores/useCharacterArtifactStore';
import AppLayout from './components/layout/AppLayout';
import HomePage from './pages/HomePage';
import ChatListPage from './pages/ChatListPage';
import CreateChatPage from './pages/CreateChatPage';
import ChatDetailPage from './pages/ChatDetailPage';
import CreateDirectChatPage from './pages/CreateDirectChatPage';
import './i18n';

const routePreloaders = [
  () => import('./pages/CharacterLibraryPage'),
  () => import('./pages/CharacterEditorPage'),
  () => import('./pages/SettingsPage'),
  () => import('./pages/RecycleBinPage'),
  () => import('./pages/AIModelsPage'),
  () => import('./pages/AccountPage'),
  () => import('./pages/SyncStatusPage'),
  () => import('./pages/BatchGenerateCharactersPage'),
  () => import('./pages/LettersPage'),
  () => import('./pages/IntroPage'),
  () => import('./pages/LoginPage'),
];

const [
  loadCharacterLibraryPage,
  loadCharacterEditorPage,
  loadSettingsPage,
  loadRecycleBinPage,
  loadAIModelsPage,
  loadAccountPage,
  loadSyncStatusPage,
  loadBatchGenerateCharactersPage,
  loadLettersPage,
  loadIntroPage,
  loadLoginPage,
] = routePreloaders;

const CharacterLibraryPage = lazy(loadCharacterLibraryPage);
const CharacterEditorPage = lazy(loadCharacterEditorPage);
const SettingsPage = lazy(loadSettingsPage);
const RecycleBinPage = lazy(loadRecycleBinPage);
const AIModelsPage = lazy(loadAIModelsPage);
const AccountPage = lazy(loadAccountPage);
const SyncStatusPage = lazy(loadSyncStatusPage);
const BatchGenerateCharactersPage = lazy(loadBatchGenerateCharactersPage);
const LettersPage = lazy(loadLettersPage);
const IntroPage = lazy(loadIntroPage);
const LoginPage = lazy(loadLoginPage);

function RouteFallback() {
  return (
    <Box sx={{ px: 2.5, pt: 1.5 }}>
      <LinearProgress sx={{ borderRadius: 999 }} />
    </Box>
  );
}

function RouteElement({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function ChatDetailRouteElement() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <ChatDetailPage />
    </Suspense>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const authMode = useAuthStore((s) => s.authMode);
  const location = useLocation();

  if (!isLoggedIn && authMode !== 'local') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function DataLoader({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const authMode = useAuthStore((s) => s.authMode);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    if (isLoggedIn || authMode === 'local') {
      void loadSettings();
      void useCharacterStore.getState().loadCharacters();
      void Promise.resolve(useCharacterArtifactStore.persist.rehydrate()).then(() => {
        void useCharacterArtifactStore.getState().resumeProcessing();
      });
    }
  }, [authMode, isLoggedIn, loadSettings]);

  useEffect(() => {
    const preload = () => {
      for (const loadRoute of routePreloaders) {
        void loadRoute();
      }
    };
    const scheduler = (window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    if (typeof scheduler === 'function') {
      const handle = scheduler(preload, { timeout: 1600 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(preload, 800);
    return () => window.clearTimeout(handle);
  }, []);

  return <>{children}</>;
}

function RoutedApp() {
  return (
    <Routes>
      <Route path="/login" element={<RouteElement><LoginPage /></RouteElement>} />
      <Route path="/intro" element={<RouteElement><IntroPage /></RouteElement>} />
      <Route element={
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      }>
        <Route path="/" element={<RouteElement><HomePage /></RouteElement>} />
        <Route path="/chats" element={<RouteElement><ChatListPage /></RouteElement>} />
        <Route path="/chats/create" element={<RouteElement><CreateChatPage /></RouteElement>} />
        <Route path="/direct/create" element={<RouteElement><CreateDirectChatPage /></RouteElement>} />
        <Route path="/chats/:id/edit" element={<RouteElement><CreateChatPage /></RouteElement>} />
        <Route path="/chats/:id" element={<ChatDetailRouteElement />} />
        <Route path="/characters" element={<RouteElement><CharacterLibraryPage /></RouteElement>} />
        <Route path="/characters/create" element={<RouteElement><CharacterEditorPage /></RouteElement>} />
        <Route path="/characters/:id/edit" element={<RouteElement><CharacterEditorPage /></RouteElement>} />
        <Route path="/characters/batch-generate" element={<RouteElement><BatchGenerateCharactersPage /></RouteElement>} />
        <Route path="/letters" element={<RouteElement><LettersPage /></RouteElement>} />
        <Route path="/models" element={<RouteElement><AIModelsPage /></RouteElement>} />
        <Route path="/account" element={<RouteElement><AccountPage /></RouteElement>} />
        <Route path="/account/sync-status" element={<RouteElement><SyncStatusPage /></RouteElement>} />
        <Route path="/settings" element={<RouteElement><SettingsPage /></RouteElement>} />
        <Route path="/settings/recycle-bin" element={<RouteElement><RecycleBinPage /></RouteElement>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const themeMode = useSettingsStore((s) => s.theme);
  const themeColor = useSettingsStore((s) => s.themeColor);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const resolvedMode = themeMode === 'system' ? (prefersDark ? 'dark' : 'light') : themeMode;

  const theme = useMemo(
    () => createAppTheme(resolvedMode, themeColor),
    [resolvedMode, themeColor]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <DataLoader>
          <RoutedApp />
        </DataLoader>
      </BrowserRouter>
    </ThemeProvider>
  );
}
