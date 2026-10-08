'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { httpClient } from './api/httpClient';
import * as authApi from './api/auth.api';
import { hasSessionHint, useAuthStore } from './store/authStore';
import { useRealtime } from './hooks/useRealtime';
import { useThemeStore } from './store/themeStore';

/**
 * On first load the access token only lives in memory, so a page refresh
 * loses it. Attempt a silent refresh using the httpOnly cookie before
 * rendering routes, so an already-logged-in user isn't bounced to /login.
 * Skipped entirely for users who haven't logged in before (no spurious 401).
 */
function useSessionBootstrap() {
  const [ready, setReady] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    async function bootstrap() {
      if (!hasSessionHint()) {
        setReady(true);
        return;
      }
      try {
        const res = await httpClient.post('/auth/refresh');
        const accessToken = res.data.accessToken as string;
        useAuthStore.getState().setAccessToken(accessToken);
        const user = await authApi.getMe();
        setSession(accessToken, user);
      } catch {
        // No valid session — user will land on /login.
      } finally {
        setReady(true);
      }
    }
    bootstrap();
  }, [setSession]);

  return ready;
}

function SessionGate({ children }: { children: ReactNode }) {
  const ready = useSessionBootstrap();
  useRealtime(); // live multi-user updates once authenticated
  // Pages render only in the browser, after the session is known: they read browser storage and
  // the signed-in user while rendering, exactly as they did as a single-page app.
  if (!ready) return null;
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>{children}</SessionGate>
    </QueryClientProvider>
  );
}
