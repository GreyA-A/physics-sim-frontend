import type { TelemetrySnapshot } from '../types/simulation';

export interface LiveTelemetryProps {
  /** Останній знімок або null, поки даних немає. */
  telemetry: TelemetrySnapshot | null;
  /** FPS показується лише під час симуляції. */
  isRunning: boolean;
}

/** Коротка панель живих показників; повний журнал із useMemo буде в Issue #8. */
export function LiveTelemetry({ telemetry, isRunning }: LiveTelemetryProps) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm xl:grid-cols-1">
      <div>
        <dt className="text-xs text-slate-500 dark:text-slate-400">Час, с</dt>
        <dd data-testid="telemetry-time" className="font-mono">
          {telemetry ? telemetry.time.toFixed(2) : '-'}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500 dark:text-slate-400">FPS</dt>
        <dd data-testid="telemetry-fps" className="font-mono">
          {telemetry && isRunning ? telemetry.fps : '-'}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500 dark:text-slate-400">E, Дж</dt>
        <dd data-testid="telemetry-energy" className="font-mono">
          {telemetry ? telemetry.totalEnergy.toFixed(2) : '-'}
        </dd>
      </div>
    </dl>
  );
}