import { memo } from 'react';
import type { ChangeEvent } from 'react';
import type { ParamKey } from '../utils/paramValidator';

/**
 * Патерн «Дублювання властивостей» (Duplicating the props), Яскевич В. О. [[1]], с. 60:
 * замість передачі всього об'єкта ParamBound або {...bound} (що прив'язує компонент
 * до моделі даних, с. 59, 61) компонент отримує лише ті скалярні значення, які
 * йому справді потрібні. Тому ParamField не знає, звідки взято межі: з валідатора,
 * з JSON-файлу чи з тестового прикладу.
 */
export interface ParamFieldProps {
  /** Ім'я поля: використовується в `name`/`id` і в обчислюваному ключі [e.target.name]. */
  name: ParamKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Рекомендований крок (показується в підказці). */
  step: number;
  /** Сире текстове значення з чернетки (контрольований компонент). */
  value: string;
  /** Повідомлення про помилку; undefined, якщо значення коректне. */
  error?: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * React.memo (с. 37 [[1]]): поле перемальовується лише якщо змінилися його власні пропси.
 * Під час введення в одне поле інші поля не рендеряться.
 */
export const ParamField = memo(function ParamField({
  name,
  label,
  unit,
  min,
  max,
  step,
  value,
  error,
  onChange,
}: ParamFieldProps) {
  const inputId = `param-${name}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const unitSuffix = unit === '' ? '' : ` ${unit}`;
  const rangeHint = `від ${min} до ${max}${unitSuffix}`;
  const hasError = error !== undefined;

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
        {label}
        {/* && (с. 18-19 [[1]]): одиниця виміру показується лише якщо вона є */}
        {unit !== '' && (
          <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
            ({unit})
          </span>
        )}
      </label>

      {/*
        Контрольований компонент (с. 56-58 [[1]]): value і onChange приходять зверху.
        type="text": нечислове значення має дійти до валідатора, а не загубитися
        в нативному числовому полі (воно віддає '' для будь-якого сміття).
      */}
      <input
        id={inputId}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={onChange}
        title={`Допустимо ${rangeHint}; рекомендований крок ${step}`}
        aria-invalid={hasError}
        aria-describedby={hasError ? `${hintId} ${errorId}` : hintId}
        className={`w-full rounded-md border bg-white px-3 py-2 font-mono text-sm focus-visible:outline focus-visible:outline-2 dark:bg-slate-900 ${
          hasError
            ? 'border-rose-500 focus-visible:outline-rose-500'
            : 'border-slate-300 focus-visible:outline-sky-600 dark:border-slate-600'
        }`}
      />

      <p id={hintId} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Допустимо: {rangeHint}
      </p>

      {/* && (с. 18-19 [[1]]): текст помилки лише коли вона є */}
      {hasError && (
        <p id={errorId} className="mt-1 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
});