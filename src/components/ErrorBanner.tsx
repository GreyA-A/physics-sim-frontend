import { AlertTriangle } from 'lucide-react';

export interface ErrorBannerProps {
  /** Головне повідомлення про помилку. */
  message: string;
  /** Додаткові повідомлення за полями (необов'язково). */
  details?: readonly string[];
}

/**
 * Презентаційний блок помилки. role="alert" змушує екранні зчитувачі
 * озвучити повідомлення одразу після появи.
 */
export function ErrorBanner({ message, details = [] }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100"
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
      {/* Яскевич В. О. [[1]], с. 18-19: && не додає порожній список у DOM */}
      {details.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {/* с. 21-22 [[1]]: key; повідомлення містять назву поля, тому унікальні */}
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}