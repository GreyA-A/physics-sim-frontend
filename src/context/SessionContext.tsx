import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ResearcherProfile, ThemeMode } from '../types/simulation';
import {
  clearProfile,
  createProfile,
  loadProfile,
  saveProfile,
  validateDisplayName,
} from '../utils/profileStorage';

/** Результат спроби входу: помилка повертається у форму, а не кидається. */
export type LoginResult = { ok: true } | { ok: false; error: string };

/** Значення, яке отримують усі споживачі контексту. */
export interface SessionContextValue {
  /** Поточний профіль або null (гість). */
  profile: ResearcherProfile | null;
  /** Поточна тема оформлення. */
  theme: ThemeMode;
  login: (rawName: string) => LoginResult;
  logout: () => void;
  toggleTheme: () => void;
}

// КРОК 1 (Яскевич В. О. [[1]], с. 42): створення контексту.
// Початкове значення undefined дозволяє виявити використання поза провайдером.
const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export interface SessionProviderProps {
  children: ReactNode;
  /**
   * Початковий профіль (для тестів і сценаріїв):
   *  - undefined -> прочитати з localStorage;
   *  - null      -> гість, localStorage НЕ читається;
   *  - об'єкт    -> використати його.
   */
  initialProfile?: ResearcherProfile | null;
}

// КРОК 2 (с. 43 [[1]]): провайдер тримає стан і передає його вниз по дереву.
export function SessionProvider({ children, initialProfile }: SessionProviderProps) {
  // Ліниве початкове значення useState (с. 25-27 [[1]]): localStorage читається один раз
  const [profile, setProfile] = useState<ResearcherProfile | null>(() =>
    initialProfile !== undefined ? initialProfile : loadProfile(),
  );
  const [theme, setTheme] = useState<ThemeMode>(() => profile?.theme ?? 'light');

  // useEffect із залежністю [theme] (с. 32-33 [[1]]): синхронізація React-стану
  // з зовнішньою системою - класом "dark" на <html>, який активує Tailwind darkMode: 'class'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const login = useCallback(
    (rawName: string): LoginResult => {
      const result = validateDisplayName(rawName);
      if (!result.valid) {
        return { ok: false, error: result.error };
      }
      const next = createProfile(result.sanitized, theme);
      saveProfile(next);
      setProfile(next);
      return { ok: true };
    },
    [theme],
  );

  const logout = useCallback(() => {
    clearProfile();
    setProfile(null);
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    // Для авторизованого користувача тема зберігається разом із профілем
    if (profile !== null) {
      const updated: ResearcherProfile = { ...profile, theme: nextTheme };
      saveProfile(updated);
      setProfile(updated);
    }
  }, [theme, profile]);

  // useMemo: стабільне посилання на value, щоб споживачі не рендерились без потреби (с. 34-36 [[1]])
  const value = useMemo<SessionContextValue>(
    () => ({ profile, theme, login, logout, toggleTheme }),
    [profile, theme, login, logout, toggleTheme],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * КРОК 3 (с. 43 [[1]]): хук-споживач.
 * Вирішує проблему «props drilling» (с. 41, 53-54 [[1]]): компонент у будь-якому місці
 * дерева (напр., HeaderSessionBar у шапці) бере профіль і тему напряму з контексту,
 * а проміжні компоненти (WorkspaceLayout) їх не передають і про них не знають.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession() можна викликати лише всередині <SessionProvider>.');
  }
  return context;
}