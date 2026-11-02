import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import type { SimulationStatus, TelemetrySnapshot } from '../types/simulation';
import { computeTelemetryStats } from '../utils/telemetryStats';
import { Button } from './Button';

export interface TelemetryPanelProps {
  /** Журнал знімків (кільцевий буфер із App). */
  log: readonly TelemetrySnapshot[];
  /** Стан автомата: визначає підпис журналу й показ FPS. */
  status: SimulationStatus;
  /** Чи обрано пресет (інакше показується порожній стан). */
  hasPreset: boolean;
  /** Очищення журналу (стабільний useCallback у батька). */
  onClearLog: () => void;
}

const LOG_STATUS_NOTE: Record<SimulationStatus, string> = {
  IDLE: 'Пресет не обрано.',
  READY: 'Очікування запуску: натисніть «Старт» або Space.',
  RUNNING: 'Запис триває.',
  PAUSED: 'Пауза: запис зупинено.',
  ERROR: 'Помилка: запис зупинено.',
};

/** Число з фіксованою кількістю знаків або "-" для null / нескінченних значень. */
function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

function formatPercent(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '-' : `${value.toFixed(digits)} %`;
}

/** Відсоток зі знаком для дрейфу енергії. */
function formatDrift(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} %`;
}

/** Презентаційна картка одного показника (<dt>/<dd>). */
function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd data-testid={testId} className="font-mono text-sm">
        {value}
      </dd>
    </div>
  );
}

/**
 * Панель аналітики: числові показники, розподіл енергії, статистика та журнал.
 * Без React.memo НАВМИСНО: панель перемальовується разом із батьком, а useMemo
 * гарантує, що агрегати по журналу не перераховуються, поки `log` не змінився.
 */
export function TelemetryPanel({ log, status, hasPreset, onClearLog }: TelemetryPanelProps) {
  // useMemo (с. 34-36 [[1]]): обчислення запам'ятовується до зміни залежності [log].
  // Рендери без зміни log (перемикання теми, паузи, пресету) повторно проходять
  // по всьому масиву не будуть. Аналог із посібника: мемоізація «важкої» функції
  // (числа Фібоначчі / факторіал), яка не перераховується, поки не змінився аргумент.
  const stats = useMemo(() => computeTelemetryStats(log), [log]);

  // Рядки журналу: найновіші зверху. Копія, бо reverse() мутує масив.
  const rows = useMemo(() => [...log].reverse(), [log]);

  const isRunning = status === 'RUNNING';
  const { kineticShare, potentialShare } = stats;
  const hasShares = kineticShare !== null && potentialShare !== null;
  const barLabel = hasShares
    ? `Частка кінетичної енергії ${kineticShare.toFixed(1)} %, потенціальної ${potentialShare.toFixed(1)} %`
    : 'Розподіл енергії недоступний';

  /** Умовний рендеринг журналу (с. 18-20 [[1]]): порожні стани й активний список. */
  const renderJournal = () => {
    if (!hasPreset) {
      return (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Оберіть пресет, щоб почати запис телеметрії.
        </p>
      );
    }
    if (log.length === 0) {
      return <p className="text-sm text-slate-600 dark:text-slate-300">Журнал порожній.</p>;
    }
    return (
      <>
        <p data-testid="telemetry-log-status" className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          {LOG_STATUS_NOTE[status]}
        </p>
        {/* Список із унікальним key (с. 21-22 [[1]]): час симуляції унікальний
            завдяки правилу заміни в appendTelemetry */}
        <ol
          data-testid="telemetry-log"
          className="max-h-48 space-y-1 overflow-y-auto rounded border border-slate-200 p-2 font-mono text-xs dark:border-slate-700"
        >
          {rows.map((entry) => (
            <li key={entry.time} className="flex justify-between gap-2">
              <span>t = {entry.time.toFixed(2)} с</span>
              <span>E = {formatNumber(entry.kineticEnergy + entry.potentialEnergy)} Дж</span>
              <span>{entry.fps} FPS</span>
            </li>
          ))}
        </ol>
      </>
    );
  };

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
        <Metric label="Час, с" value={formatNumber(stats.latest?.time ?? null)} testId="telemetry-time" />
        <Metric
          label="FPS"
          value={stats.latest !== null && isRunning ? String(stats.latest.fps) : '-'}
          testId="telemetry-fps"
        />
        <Metric
          label="Кількість тіл"
          value={stats.latest !== null ? String(stats.latest.activeBodiesCount) : '-'}
          testId="telemetry-bodies"
        />
        <Metric label="Ek, Дж" value={formatNumber(stats.kineticEnergy)} testId="telemetry-ek" />
        <Metric label="Ep, Дж" value={formatNumber(stats.potentialEnergy)} testId="telemetry-ep" />
        <Metric label="E = Ek + Ep, Дж" value={formatNumber(stats.totalEnergy)} testId="telemetry-energy" />
      </dl>

      {/* Двоколірний індикатор розподілу енергії */}
      <div>
        <div
          role="img"
          aria-label={barLabel}
          className="flex h-3 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700"
        >
          {hasShares && (
            <>
              <div className="bg-sky-500" style={{ width: `${kineticShare}%` }} />
              <div className="bg-amber-500" style={{ width: `${potentialShare}%` }} />
            </>
          )}
        </div>
        <p className="mt-1 flex justify-between text-xs text-slate-600 dark:text-slate-300">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-500" aria-hidden="true" />
            Ek <span data-testid="telemetry-ek-share">{formatPercent(kineticShare)}</span>
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500" aria-hidden="true" />
            Ep <span data-testid="telemetry-ep-share">{formatPercent(potentialShare)}</span>
          </span>
        </p>
      </div>

      <section>
        <h3 className="mb-1 text-sm font-semibold">Статистика E за вікном журналу</h3>
        <dl className="grid grid-cols-2 gap-2">
          <Metric label="Макс., Дж" value={formatNumber(stats.maxEnergy)} testId="telemetry-max" />
          <Metric label="Мін., Дж" value={formatNumber(stats.minEnergy)} testId="telemetry-min" />
          <Metric label="Середнє, Дж" value={formatNumber(stats.avgEnergy)} testId="telemetry-avg" />
          <Metric label="Дрейф ΔE" value={formatDrift(stats.driftPercent)} testId="telemetry-drift" />
        </dl>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Журнал телеметрії</h3>
          <Button onClick={onClearLog} disabled={log.length === 0}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span>Очистити журнал</span>
          </Button>
        </div>
        {renderJournal()}
      </section>
    </div>
  );
}