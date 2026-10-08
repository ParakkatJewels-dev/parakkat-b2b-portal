import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const getInitialTheme = (): Theme => {
  // Evaluated when the module loads, which also happens while Next.js prerenders pages.
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  // Default to light mode (white and blue theme)
  return 'light';
};

/**
 * Apply the theme to <html> synchronously. Doing this inside the store (rather
 * than only in a React effect) means the `dark` class flips in the same tick as
 * the state change — which is what lets the View Transition snapshot capture the
 * before/after states for the wave reveal animation.
 */
const applyTheme = (theme: Theme) => {
  const root = window.document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    applyTheme(next);
    set({ theme: next });
  },
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    set({ theme });
  },
}));
