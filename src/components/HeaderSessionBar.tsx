import { LogOut, Moon, Sun, User } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { Button } from './Button';

/**
 * Панель профілю у шапці. Дані беруться напряму з контексту через useSession():
 * WorkspaceLayout лише надає слот і нічого не знає про профіль чи тему
 * (усунення «props drilling», с. 41 [[1]]).
 */
export function HeaderSessionBar() {
  const { profile, theme, toggleTheme, logout } = useSession();
  const isDark = theme === 'dark';

  return (
    <div className="flex items-center gap-2">
      {/* && (с. 18-19 [[1]]): ім'я показується лише для авторизованого користувача */}
      {profile && (
        <span data-testid="session-name" className="flex items-center gap-1 text-sm">
          <User className="h-4 w-4" aria-hidden="true" />
          <span>{profile.displayName}</span>
        </span>
      )}

      {/* Тернарний оператор (с. 19-20 [[1]]): іконка показує, на яку тему буде перемикання */}
      <Button
        ariaLabel="Перемкнути тему"
        title={isDark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
        onClick={toggleTheme}
      >
        {isDark ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>

      <Button ariaLabel="Вийти з профілю" title="Вийти з профілю" onClick={logout}>
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Вийти</span>
      </Button>
    </div>
  );
}