import { lazy, Suspense, useMemo, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import { createAppTheme } from './theme';
import { useSettingsStore } from './stores/useSettingsStore';
import { useAuthStore } from './stores/useAuthStore';
import AppLayout from './components/layout/AppLayout';
import HomePage from './pages/HomePage';
import ChatListPage from './pages/ChatListPage';
import CreateChatPage from './pages/CreateChatPage';
import ChatDetailPage from './pages/ChatDetailPage';
import CreateDirectChatPage from './pages/CreateDirectChatPage';
import './i18n';

const CharacterLibraryPage = lazy(() => import('./pages/CharacterLibraryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const RecycleBinPage = lazy(() => import('./pages/RecycleBinPage'));
const AIModelsPage = lazy(() => import('./pages/AIModelsPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const SyncStatusPage = lazy(() => import('./pages/SyncStatusPage'));
const BatchGenerateCharactersPage = lazy(() => import('./pages/BatchGenerateCharactersPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));

function RouteElement({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

function ChatDetailRouteElement() {
  return (
    <Suspense fallback={null}>
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
      loadSettings();
    }
  }, [authMode, isLoggedIn, loadSettings]);

  return <>{children}</>;
}

function RoutedApp() {
  return (
    <Routes>
      <Route path="/login" element={<RouteElement><LoginPage /></RouteElement>} />
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
        <Route path="/characters/create" element={<RouteElement><CharacterLibraryPage /></RouteElement>} />
        <Route path="/characters/:id/edit" element={<RouteElement><CharacterLibraryPage /></RouteElement>} />
        <Route path="/characters/batch-generate" element={<RouteElement><BatchGenerateCharactersPage /></RouteElement>} />
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
