import { create } from 'zustand';
import type { AuthUser } from '../types/auth';
import { clearNavigationState } from '../lib/router';

interface AuthState {
  // Access token lives in memory only — never localStorage/sessionStorage,
  // to reduce the blast radius of an XSS bug. The refresh token lives in an
  // httpOnly cookie the frontend never touches directly.
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => void;
}

// Non-sensitive hint (not a token) so the app only attempts a silent refresh
// when the user has logged in before — avoids a spurious 401 on the login page.
export const SESSION_HINT_KEY = 'had_session';
export const hasSessionHint = () => localStorage.getItem(SESSION_HINT_KEY) === '1';

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    set({ accessToken, user });
  },
  setAccessToken: (accessToken) => set({ accessToken }),
  clearSession: () => {
    localStorage.removeItem(SESSION_HINT_KEY);
    clearNavigationState(); // e.g. a pending MFA token carried to /mfa/*
    set({ accessToken: null, user: null });
  },
}));
