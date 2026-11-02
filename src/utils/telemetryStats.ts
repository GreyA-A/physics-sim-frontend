import type { TelemetrySnapshot } from '../types/simulation';

/** Максимальна довжина журналу (кільцевий буфер); цей самий журнал піде в CSV (Issue #9). */
export const MAX_TELEMETRY_LOG_SIZE = 40;

/** Якщо |E0| менший за це значення, відносний дрейф не визначений (ділення на ~0). */
const ZERO_ENERGY_EPSILON = 1e-9;

/** Агрегати журналу. null означає «даних немає або вони некоректні». */
export interface TelemetryStats {
  /** Кількість записів у журналі. */
  count: number;
  /** Останній запис або null. */
  latest: TelemetrySnapshot | null;
  /** Поточні Ek, Ep та E = Ek + Ep, Дж. */
  kineticEnergy: number | null;
  potentialEnergy: number | null;
  totalEnergy: number | null;
  /** Частки Ek/E та Ep/E, відсотки (null, якщо E <= 0). */
  kineticShare: number | null;
  potentialShare: number | null;
  /** Максимум, мінімум і середнє E за вікном журналу, Дж. */
  maxEnergy: number | null;
  minEnergy: number | null;
  avgEnergy: number | null;
  /** E першого запису вікна, Дж. */
  initialEnergy: number | null;
  /** Відносне відхилення E від першого запису вікна, відсотки. */
  driftPercent: number | null;
}

const EMPTY_STATS: TelemetryStats = Object.freeze({
  count: 0,
  latest: null,
  kineticEnergy: null,
  potentialEnergy: null,
  totalEnergy: null,
  kineticShare: null,
  potentialShare: null,
  maxEnergy: null,
  minEnergy: null,
  avgEnergy: null,
  initialEnergy: null,
  driftPercent: null,
});

/** Повна механічна енергія запису: E = Ek + Ep. */
const totalOf = (entry: TelemetrySnapshot): number => entry.kineticEnergy + entry.potentialEnergy;

/**
 * Чиста функція агрегації: один прохід по журналу.
 * Записи з нескінченною енергією пропускаються в max/min/avg, щоб один збій
 * не «отруював» статистику.
 */
export function computeTelemetryStats(log: readonly TelemetrySnapshot[]): TelemetryStats {
  const first = log[0];
  const latest = log[log.length - 1];
  if (first === undefined || latest === undefined) return EMPTY_STATS;

  let max = -Infinity;
  let min = Infinity;
  let sum = 0;
  let finiteCount = 0;
  for (const entry of log) {
    const total = totalOf(entry);
    if (!Number.isFinite(total)) continue;
    if (total > max) max = total;
    if (total < min) min = total;
    sum += total;
    finiteCount += 1;
  }

  const latestTotal = totalOf(latest);
  const initialTotal = totalOf(first);
  const latestOk = Number.isFinite(latestTotal);

  const hasShares = latestOk && latestTotal > 0;
  const driftDefined =
    Number.isFinite(initialTotal) &&
    latestOk &&
    Math.abs(initialTotal) > ZERO_ENERGY_EPSILON;

  return {
    count: log.length,
    latest,
    kineticEnergy: latestOk ? latest.kineticEnergy : null,
    potentialEnergy: latestOk ? latest.potentialEnergy : null,
    totalEnergy: latestOk ? latestTotal : null,
    kineticShare: hasShares ? (latest.kineticEnergy / latestTotal) * 100 : null,
    potentialShare: hasShares ? (latest.potentialEnergy / latestTotal) * 100 : null,
    maxEnergy: finiteCount > 0 ? max : null,
    minEnergy: finiteCount > 0 ? min : null,
    avgEnergy: finiteCount > 0 ? sum / finiteCount : null,
    initialEnergy: Number.isFinite(initialTotal) ? initialTotal : null,
    driftPercent: driftDefined ? ((latestTotal - initialTotal) / initialTotal) * 100 : null,
  };
}

/**
 * Додає знімок до журналу ІММУТАБЕЛЬНО (Яскевич В. О. [[1]], с. 26-27).
 * Мутація через prev.push(...) залишила б те саме посилання, а useState порівнює
 * старе й нове значення через Object.is (===): посилання не змінилося, тож React
 * вважає, що стан той самий, і пропускає повторний рендеринг. Тому створюється
 * НОВИЙ масив: [...prev, snapshot].
 *
 * Правила:
 *  - time === 0 (стартовий кадр READY або після RESET): журнал скидається до [snapshot];
 *  - нескінченний time: знімок ігнорується (повертається prev, рендеру не буде);
 *  - time збігається з останнім записом (за малого timeScale крок міг не відбутися):
 *    останній запис замінюється, щоб key={entry.time} лишався унікальним;
 *  - інакше: додавання з обрізанням до останніх MAX_TELEMETRY_LOG_SIZE записів.
 */
export function appendTelemetry(
  prev: TelemetrySnapshot[],
  snapshot: TelemetrySnapshot,
): TelemetrySnapshot[] {
  if (!Number.isFinite(snapshot.time)) return prev;
  if (snapshot.time === 0) return [snapshot];

  const last = prev[prev.length - 1];
  if (last !== undefined && last.time === snapshot.time) {
    return [...prev.slice(0, -1), snapshot];
  }
  return [...prev, snapshot].slice(-MAX_TELEMETRY_LOG_SIZE);
}