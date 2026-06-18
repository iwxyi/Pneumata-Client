import { lazy, Suspense, useMemo, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, LinearProgress, ThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import { createAppTheme } from './theme';
import { useSettingsStore } from './stores/useSettingsStore';
import { useAuthStore } from './stores/useAuthStore';
import { useCharacterArtifactStore } from './stores/useCharacterArtifactStore';
import AppLayout from './components/layout/AppLayout';
import MasterDetailLayout from './components/layout/MasterDetailLayout';
import HomePage from './pages/HomePage';
import ChatListPage from './pages/ChatListPage';
import CreateChatPage from './pages/CreateChatPage';
import ChatDetailPage from './pages/ChatDetailPage';
import CreateDirectChatPage from './pages/CreateDirectChatPage';
import AdminLayout from './components/admin/AdminLayout';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminAIPage from './pages/admin/AdminAIPage';
import AdminBillingPage from './pages/admin/AdminBillingPage';
import AdminModerationPage from './pages/admin/AdminModerationPage';
import AdminRiskPage from './pages/admin/AdminRiskPage';
import AdminAuditPage from './pages/admin/AdminAuditPage';
import AdminNotificationsPage from './pages/admin/AdminNotificationsPage';
import { useAdminAuthStore } from './stores/useAdminAuthStore';
import { ADMIN_LOGIN_EVENT } from './services/adminApi';
import DevUpdatePrompt from './components/common/DevUpdatePrompt';
import PwaUpdatePrompt from './components/common/PwaUpdatePrompt';
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
  () => import('./pages/CalendarPage'),
  () => import('./pages/MomentsPage'),
  () => import('./pages/IntroPage'),
  () => import('./pages/LoginPage'),
  () => import('./pages/PublicSharedChatPage'),
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
  loadCalendarPage,
  loadMomentsPage,
  loadIntroPage,
  loadLoginPage,
  loadPublicSharedChatPage,
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
const CalendarPage = lazy(loadCalendarPage);
const MomentsPage = lazy(loadMomentsPage);
const IntroPage = lazy(loadIntroPage);
const LoginPage = lazy(loadLoginPage);
const PublicSharedChatPage = lazy(loadPublicSharedChatPage);

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

function ChatMasterDetailRouteElement({ detail, fallback = 'detail', detailTitle = '会话' }: { detail: React.ReactNode; fallback?: 'master' | 'detail'; detailTitle?: React.ReactNode | null }) {
  return (
    <MasterDetailLayout
      master={<RouteElement><ChatListPage /></RouteElement>}
      detail={detail}
      masterTitle="聊天"
      detailTitle={detail ? detailTitle : null}
      fallback={fallback}
    />
  );
}

function CharacterMasterDetailRouteElement({ detail, fallback = 'detail' }: { detail: React.ReactNode; fallback?: 'master' | 'detail' }) {
  return (
    <MasterDetailLayout
      master={<RouteElement><CharacterLibraryPage /></RouteElement>}
      detail={detail}
      masterTitle="角色库"
      detailTitle={detail ? '角色' : null}
      fallback={fallback}
    />
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

function RequireAdminAuth() {
  const isLoggedIn = useAdminAuthStore((s) => s.isLoggedIn);
  const location = useLocation();
  if (!isLoggedIn) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

function AdminAuthRedirectHandler() {
  const logout = useAdminAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [redirect, setRedirect] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const from = (event as CustomEvent<{ from?: string }>).detail?.from;
      logout();
      setRedirect(from?.startsWith('/admin') ? from : '/admin');
    };
    window.addEventListener(ADMIN_LOGIN_EVENT, handler);
    return () => window.removeEventListener(ADMIN_LOGIN_EVENT, handler);
  }, [logout]);

  useEffect(() => {
    if (!redirect) return;
    navigate('/admin/login', { replace: true, state: { from: { pathname: redirect } } });
    setRedirect(null);
  }, [navigate, redirect]);

  return null;
}

function DataLoader({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const authMode = useAuthStore((s) => s.authMode);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    if (isLoggedIn || authMode === 'local') {
      void loadSettings();
      void useCharacterArtifactStore.persist.rehydrate();
    }
  }, [authMode, isLoggedIn, loadSettings]);

  useEffect(() => {
    if (!isLoggedIn && authMode !== 'local') return;
    const preload = () => {
      void loadCharacterLibraryPage();
      void loadCharacterEditorPage();
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
  }, [authMode, isLoggedIn]);

  return <>{children}</>;
}

function RoutedApp() {
  return (
    <Routes>
      <Route path="/login" element={<RouteElement><LoginPage /></RouteElement>} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/intro" element={<RouteElement><IntroPage /></RouteElement>} />
      <Route path="/shared/:token" element={<RouteElement><PublicSharedChatPage /></RouteElement>} />
      <Route path="/shared/chats/:token" element={<RouteElement><PublicSharedChatPage /></RouteElement>} />
      <Route element={<RequireAdminAuth />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="ai" element={<AdminAIPage />} />
          <Route path="billing" element={<AdminBillingPage />} />
          <Route path="moderation" element={<AdminModerationPage />} />
          <Route path="notifications" element={<AdminNotificationsPage />} />
          <Route path="risk" element={<AdminRiskPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
        </Route>
      </Route>
      <Route element={
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      }>
        <Route path="/" element={<RouteElement><HomePage /></RouteElement>} />
        <Route path="/chats" element={<ChatMasterDetailRouteElement detail={null} fallback="master" />} />
        <Route path="/chats/create" element={<ChatMasterDetailRouteElement detail={<RouteElement><CreateChatPage /></RouteElement>} />} />
        <Route path="/direct/create" element={<ChatMasterDetailRouteElement detail={<RouteElement><CreateDirectChatPage /></RouteElement>} />} />
        <Route path="/chats/:id/edit" element={<ChatMasterDetailRouteElement detail={<RouteElement><CreateChatPage /></RouteElement>} />} />
        <Route path="/chats/:id" element={<ChatMasterDetailRouteElement detail={<ChatDetailRouteElement />} detailTitle={null} />} />
        <Route path="/characters" element={<CharacterMasterDetailRouteElement detail={null} fallback="master" />} />
        <Route path="/characters/create" element={<RouteElement><CharacterEditorPage /></RouteElement>} />
        <Route path="/characters/:id/edit" element={<RouteElement><CharacterEditorPage /></RouteElement>} />
        <Route path="/characters/batch-generate" element={<RouteElement><BatchGenerateCharactersPage /></RouteElement>} />
        <Route path="/letters" element={<RouteElement><LettersPage /></RouteElement>} />
        <Route path="/calendar" element={<RouteElement><CalendarPage /></RouteElement>} />
        <Route path="/moments" element={<RouteElement><MomentsPage /></RouteElement>} />
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
  const checkAdminAuth = useAdminAuthStore((s) => s.checkAuth);
  const [settingsHydrated, setSettingsHydrated] = useState(() => useSettingsStore.persist.hasHydrated());

  useEffect(() => {
    void checkAdminAuth();
  }, [checkAdminAuth]);

  useEffect(() => {
    if (settingsHydrated) return;
    let cancelled = false;
    Promise.resolve(useSettingsStore.persist.rehydrate()).finally(() => {
      if (!cancelled) setSettingsHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsHydrated]);

  const resolvedMode = themeMode === 'system' ? (prefersDark ? 'dark' : 'light') : themeMode;

  const theme = useMemo(
    () => createAppTheme(resolvedMode, themeColor),
    [resolvedMode, themeColor]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <DevUpdatePrompt />
      <PwaUpdatePrompt />
      {settingsHydrated ? (
        <BrowserRouter>
          <AdminAuthRedirectHandler />
          <DataLoader>
            <RoutedApp />
          </DataLoader>
        </BrowserRouter>
      ) : (
        <RouteFallback />
      )}
    </ThemeProvider>
  );
}
