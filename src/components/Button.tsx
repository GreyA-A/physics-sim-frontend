import type { ReactNode } from 'react';

/** Візуальні варіанти кнопки. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  /**
   * Вміст кнопки. Яскевич В. О. [[1]], с. 53-54: через children передаємо
   * іконку Lucide разом із <span> з текстом.
   */
  children: ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  /** Доступна назва для кнопок без тексту. */
  ariaLabel?: string;
  /** Підказка при наведенні (UX). */
  title?: string;
}

// Таблиця відповідності варіант -> Tailwind-класи
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-700 focus-visible:outline-sky-600',
  secondary:
    'bg-slate-200 text-slate-900 hover:bg-slate-300 focus-visible:outline-slate-500 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-600',
};

export function Button({
  children,
  variant = 'secondary',
  disabled = false,
  onClick,
  type = 'button',
  ariaLabel,
  title,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </button>
  );
}