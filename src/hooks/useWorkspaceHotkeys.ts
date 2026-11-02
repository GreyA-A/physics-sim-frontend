import { useEffect } from 'react';
import type { SimulationStatus } from '../types/simulation';

/** Теги, у яких натискання клавіш має обробляти сам елемент. */
const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

/**
 * true, якщо подія прийшла з елемента, який сам реагує на клавіші
 * (поле вводу, кнопка, contenteditable). Тоді глобальні скорочення ігноруються:
 * пробіл у полі це символ, а пробіл на кнопці це її натискання.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INTERACTIVE_TAGS.has(target.tagName) || target.isContentEditable === true;
}

export interface WorkspaceHotkeysOptions {
  status: SimulationStatus;
  onStartOrResume: () => void;
  onPause: () => void;
  onReset: () => void;
}

/**
 * Глобальні гарячі клавіші: Space - старт / пауза / продовжити, R - скидання.
 * useEffect із залежностями (с. 32-33 [[1]]): підписка на window оновлюється
 * разом зі статусом, а cleanup знімає старий обробник.
 * Використовується event.code (фізична клавіша), тому працює в будь-якій розкладці.
 */
export function useWorkspaceHotkeys({
  status,
  onStartOrResume,
  onPause,
  onReset,
}: WorkspaceHotkeysOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Автоповтор при утриманні клавіші, вже оброблені події та комбінації не чіпаємо
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isInteractiveTarget(event.target)) return;

      if (event.code === 'Space') {
        if (status === 'RUNNING') {
          event.preventDefault(); // без прокручування сторінки
          onPause();
        } else if (status === 'READY' || status === 'PAUSED') {
          event.preventDefault();
          onStartOrResume();
        }
        return;
      }

      if (event.code === 'KeyR' && status !== 'IDLE') {
        event.preventDefault();
        onReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, onStartOrResume, onPause, onReset]);
}