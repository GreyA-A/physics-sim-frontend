import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { Button } from './Button';
import { Card } from './Card';

/** Ім'я для швидкого демо-входу (без групи: дужки не проходять валідатор). */
const DEMO_NAME = 'Куценко Артур';

/** Екран «Швидкий старт -> Перший вхід» із плану User Guide. */
export function QuickStartAuth() {
  const { login } = useSession();

  // Контрольований компонент (с. 16-17, 56-58 [[1]]): значення поля живе у стані React
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // useRef, КРОК 1 (с. 40 [[1]]): створюємо ref для DOM-елемента
  const inputRef = useRef<HTMLInputElement>(null);

  // useEffect з порожнім масивом [] (с. 32-33, 40 [[1]]): виконується один раз після монтування.
  // КРОК 3: використовуємо ref - ставимо фокус на поле імені.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    // Старе повідомлення про помилку неактуальне, щойно користувач продовжив вводити
    setError(null);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    // Скасовуємо стандартне перезавантаження сторінки (с. 16-17 [[1]])
    e.preventDefault();
    const result = login(name);
    if (!result.ok) setError(result.error);
  };

  const handleDemo = () => {
    const result = login(DEMO_NAME);
    if (!result.ok) setError(result.error);
  };

  // Кнопка неактивна, поки поле порожнє (Завдання 5, с. 23 [[1]])
  const isSubmitDisabled = name.trim() === '';

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-center text-xl font-semibold">Симуляція фізичних процесів</h1>

      <Card title="Швидкий старт" subtitle="Створіть профіль дослідника">
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <div>
            <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
              Ім’я дослідника
            </label>
            {/* useRef, КРОК 2 (с. 40 [[1]]): прив'язуємо ref до елемента через атрибут ref */}
            <input
              ref={inputRef}
              id="displayName"
              name="displayName"
              type="text"
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={handleChange}
              aria-invalid={error !== null}
              aria-describedby={error ? 'displayName-error' : undefined}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 dark:border-slate-600 dark:bg-slate-900"
            />
          </div>

          {/* Умовний рендеринг через && (с. 18-19 [[1]]): помилка видна лише коли вона є */}
          {error && (
            <p id="displayName-error" role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={isSubmitDisabled}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>Увійти</span>
            </Button>
            <Button onClick={handleDemo}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              <span>Увійти як Куценко Артур (ІПЗ-31)</span>
            </Button>
          </div>
        </form>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Профіль зберігається лише у вашому браузері (localStorage) і нікуди не надсилається.
        </p>
      </Card>
    </div>
  );
}