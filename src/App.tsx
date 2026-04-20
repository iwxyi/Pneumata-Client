import { useMemo, useEffect } from 'react';
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
import CharacterLibraryPage from './pages/CharacterLibraryPage';
import SettingsPage from './pages/SettingsPage';
import RecycleBinPage from './pages/RecycleBinPage';
import AIModelsPage from './pages/AIModelsPage';
import AccountPage from './pages/AccountPage';
import SyncStatusPage from './pages/SyncStatusPage';
import BatchGenerateCharactersPage from './pages/BatchGenerateCharactersPage';
import LoginPage from './pages/LoginPage';
import './i18n';

// Route guard component
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const location = useLocation();

  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

// Load data after login
function DataLoader({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    if (isLoggedIn) {
      loadSettings();
    }
  }, [isLoggedIn, loadSettings]);

  return <>{children}</>;
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
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }>
              <Route path="/" element={<HomePage />} />
              <Route path="/chats" element={<ChatListPage />} />
              <Route path="/chats/create" element={<CreateChatPage />} />
              <Route path="/direct/create" element={<CreateDirectChatPage />} />
              <Route path="/chats/:id/edit" element={<CreateChatPage />} />
              <Route path="/chats/:id" element={<ChatDetailPage />} />
              <Route path="/characters" element={<CharacterLibraryPage />} />
              <Route path="/characters/create" element={<CharacterLibraryPage />} />
              <Route path="/characters/:id/edit" element={<CharacterLibraryPage />} />
              <Route path="/characters/batch-generate" element={<BatchGenerateCharactersPage />} />
              <Route path="/models" element={<AIModelsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/account/sync-status" element={<SyncStatusPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/recycle-bin" element={<RecycleBinPage />} />
            </Route>
          </Routes>
        </DataLoader>
      </BrowserRouter>
    </ThemeProvider>
  );
}
