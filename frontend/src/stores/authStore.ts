import { create } from 'zustand';
import type { User, UserSettings } from '../types';
import { api } from '../lib/api';

const TOKEN_STORAGE_KEY = 'chatsphere-token';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  settings: UserSettings;

  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
  updateUser: (data: Record<string, unknown>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateSettings: (data: Partial<UserSettings>) => Promise<void>;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem(TOKEN_STORAGE_KEY),
  isLoading: true,
  settings: {
    theme: (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
    notifications_enabled: true,
  },

  login: async (username, password) => {
    const { token, user } = await api.login({ username, password }) as { token: string; user: User };
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    set({ token, user });

    try {
      const settings = await api.getSettings() as UserSettings;
      set({ settings });
      get().setTheme(settings.theme);
    } catch {
      get().setTheme(get().settings.theme);
    }
  },

  signup: async (username, password) => {
    const { token, user } = await api.signup({ username, password }) as { token: string; user: User };
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    set({ token, user });

    try {
      const settings = await api.getSettings() as UserSettings;
      set({ settings });
      get().setTheme(settings.theme);
    } catch {
      get().setTheme(get().settings.theme);
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    set({ user: null, token: null });
  },

  loadUser: async () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      set({ isLoading: false });
      return;
    }
    set({ token });
    try {
      const user = await api.getMe() as User;
      const settings = await api.getSettings() as UserSettings;
      set({ user, settings, isLoading: false });
      get().setTheme(settings.theme);
    } catch {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      set({ user: null, token: null, isLoading: false });
    }
  },

  updateUser: async (data) => {
    const user = await api.updateMe(data) as User;
    set({ user });
  },

  changePassword: async (currentPassword, newPassword) => {
    await api.changePassword({ current_password: currentPassword, new_password: newPassword });
  },

  updateSettings: async (data) => {
    const settings = await api.updateSettings(data) as UserSettings;
    set({ settings });
    if (data.theme) get().setTheme(data.theme);
  },

  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    document.body.className = theme;
    set((s) => ({ settings: { ...s.settings, theme } }));
  },
}));
