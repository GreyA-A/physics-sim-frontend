import type { ReactNode } from 'react';

/**
 * Властивості компонента-картки.
 * Яскевич В. О. [[1]], с. 52-54: спеціальна властивість `children`
 * дозволяє передати у компонент довільні дочірні елементи.
 */
export interface CardProps {
  /** Довільний вміст картки (текст, списки, інші компоненти). */
  children: ReactNode;
  /** Заголовок картки (необов'язковий). */
  title?: string;
  /** Підзаголовок (необов'язковий). */
  subtitle?: string;
  /** Слот для дій у заголовку, наприклад кнопка (необов'язковий). */
  headerAction?: ReactNode;
  /** Додаткові Tailwind-класи для зовнішнього контейнера. */
  className?: string;
}

export function Card({ children, title, subtitle, headerAction, className = '' }: CardProps) {
  // Шапка відображається, лише якщо є заголовок або дія
  const hasHeader = Boolean(title) || Boolean(headerAction);

  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 ${className}`}
    >
      {/* Яскевич В. О. [[1]], с. 18-19: умовний рендеринг через && (аналог прикладу Card) */}
      {hasHeader && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {/* Підзаголовок з'являється лише коли переданий */}
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          {/* Слот дій також необов'язковий; flex-wrap запобігає виходу кнопок за межі 360 px */}
          {headerAction && (
            <div className="flex flex-wrap items-center gap-1.5">{headerAction}</div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}