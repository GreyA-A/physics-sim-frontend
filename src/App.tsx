import { Atom } from 'lucide-react';
import type { SimulationStatus } from './types/simulation';
import { PRESET_CATALOG } from './utils/presetCatalog';

// Початковий стан контролера симуляції; у Issue #4 перейде під керування useReducer
const INITIAL_STATUS: SimulationStatus = 'IDLE';

function App() {
  const status: SimulationStatus = INITIAL_STATUS;
  const isIdle = status === 'IDLE';

  return (
    // Яскевич В. О. [[1]], с. 50-51: скорочений синтаксис фрагмента <>...</>
    // дозволяє повернути кілька елементів без зайвого вузла DOM
    <>
      <header className="border-b border-slate-200 px-4 py-4 dark:border-slate-700 sm:px-6">
        <div className="flex items-center gap-3">
          <Atom className="h-7 w-7 text-sky-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold sm:text-xl">
            Веб-застосунок для інтерактивної симуляції та моделювання фізичних процесів
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <p className="mb-4 text-sm">
          Статус симуляції:{' '}
          {/* Яскевич В. О. [[1]], с. 18-20: тернарний оператор ?: обирає стиль бейджа за станом */}
          <span
            data-testid="simulation-status"
            className={
              isIdle
                ? 'rounded bg-slate-200 px-2 py-0.5 font-mono text-slate-700'
                : 'rounded bg-emerald-200 px-2 py-0.5 font-mono text-emerald-800'
            }
          >
            {status}
          </span>
        </p>

        {/* Яскевич В. О. [[1]], с. 18-20: логічний оператор && показує підказку лише в стані IDLE */}
        {isIdle && (
          <p className="mb-6 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
            Оберіть пресет, щоб розпочати роботу.
          </p>
        )}

        {/* Яскевич В. О. [[1]], с. 21-22: список із map() та унікальним key={preset.id} */}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRESET_CATALOG.map((preset) => (
            <li
              key={preset.id}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <h2 className="mb-1 font-medium">{preset.title}</h2>
              <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">{preset.description}</p>
              <code className="text-xs text-slate-500 dark:text-slate-400">{preset.keyFormula}</code>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

export default App;