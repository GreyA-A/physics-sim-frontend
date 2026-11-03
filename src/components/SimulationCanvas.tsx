import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { renderWorldToCanvas } from '../engine/canvasRenderer';
import type { LayerOptions } from '../engine/canvasRenderer';
import {
  WORLD_BOUNDS,
  advanceWorldByFrameDelta,
  computeSystemEnergy,
  createInitialWorld,
  isWorldFinite,
} from '../engine/physicsEngine';
import type { WorldState } from '../engine/physicsEngine';
import type {
  PresetId,
  SimulationParams,
  SimulationStatus,
  TelemetrySnapshot,
  ThemeMode,
} from '../types/simulation';
import { PRESET_CATALOG } from '../utils/presetCatalog';

export interface SimulationCanvasProps {
  presetId: PresetId;
  params: SimulationParams;
  status: SimulationStatus;
  theme: ThemeMode;
  /** Лічильник скидань: зміна значення примусово повертає сцену на початок. */
  resetVersion: number;
  /** Знімок телеметрії (не частіше за ~5 разів на секунду). */
  onTelemetryUpdate?: (snapshot: TelemetrySnapshot) => void;
  /** Викликається, якщо інтегратор «вибухнув» (NaN / Infinity). */
  onSimulationDiverged?: (message: string) => void;
  /** Ref, у який передається елемент <canvas> (для PNG-експорту в батьківському компоненті). */
  canvasHandleRef?: MutableRefObject<HTMLCanvasElement | null>;
}

const FALLBACK_CSS_WIDTH = 800;
const MAX_DPR = 3;
/** Інтервал троттлінгу телеметрії та вимірювання FPS, мс. */
const TELEMETRY_INTERVAL_MS = 200;

/** Підписи й ключі перемикачів шарів. */
const LAYER_TOGGLES: readonly { key: keyof LayerOptions; label: string }[] = [
  { key: 'showGrid', label: 'Сітка' },
  { key: 'showTrails', label: 'Траєкторії' },
  { key: 'showVelocityVectors', label: 'Вектори швидкості' },
  { key: 'showForceVectors', label: 'Вектори сил' },
];

interface FpsMeter {
  frames: number;
  windowStart: number | null;
}

export function SimulationCanvas({
  presetId,
  params,
  status,
  theme,
  resetVersion,
  onTelemetryUpdate,
  onSimulationDiverged,
  canvasHandleRef,
}: SimulationCanvasProps) {
  // useState (с. 25 [[1]]): видимі шари; зміна має перемалювати інтерфейс перемикачів
  const [options, setOptions] = useState<LayerOptions>({
    showGrid: true,
    showTrails: true,
    showVelocityVectors: true,
    showForceVectors: false,
  });
  // Значення FPS для бейджа оновлюється рідко (раз на 200 мс), а не щокадру
  const [fps, setFps] = useState(0);

  // ---- useRef, СЦЕНАРІЙ 1 (с. 40 [[1]]): доступ до DOM-елемента ----
  // Крок 1: створюємо посилання. Крок 2 - атрибут ref у JSX нижче.
  // Крок 3 - використання canvasRef.current після монтування (в ефектах і draw).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ---- useRef, СЦЕНАРІЙ 2 (с. 38-39 [[1]]): мутабельні дані без повторного рендерингу ----
  /** Поточний стан фізичного світу між кадрами (змінюється 60 разів/с). */
  const worldRef = useRef<WorldState | null>(null);
  /** ID requestAnimationFrame (аналог intervalRef зі с. 39 [[1]]). */
  const rafIdRef = useRef<number | null>(null);
  /** Час попереднього кадру для обчислення дельти. */
  const lastFrameTimeRef = useRef<number | null>(null);
  /** Лічильник кадрів для FPS. */
  const fpsMeterRef = useRef<FpsMeter>({ frames: 0, windowStart: null });
  /** Розмір полотна в CSS-пікселях. */
  const sizeRef = useRef({
    width: FALLBACK_CSS_WIDTH,
    height: Math.round((FALLBACK_CSS_WIDTH * WORLD_BOUNDS.height) / WORLD_BOUNDS.width),
  });
  /** «Живі» копії props: цикл кадрів читає їх, не перезапускаючись при зміні. */
  const paramsRef = useRef(params);
  const optionsRef = useRef({ ...options, theme });
  const onTelemetryRef = useRef(onTelemetryUpdate);
  const onDivergedRef = useRef(onSimulationDiverged);

  // Синхронізація «живих» копій після кожного рендера (оголошено ПЕРШИМ,
  // тому наступні ефекти того ж коміту бачать свіжі значення)
  useEffect(() => {
    paramsRef.current = params;
    optionsRef.current = { ...options, theme };
    onTelemetryRef.current = onTelemetryUpdate;
    onDivergedRef.current = onSimulationDiverged;
  });

  // Віддаємо елемент <canvas> батьківському компоненту й прибираємо його при розмонтуванні
  useEffect(() => {
    if (!canvasHandleRef) return;
    canvasHandleRef.current = canvasRef.current;
    return () => {
      canvasHandleRef.current = null;
    };
  }, [canvasHandleRef]);

  /** Перемальовує поточний стан світу (якщо він є). */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    if (!canvas || !world) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = sizeRef.current;
    renderWorldToCanvas(ctx, world, optionsRef.current, width, height);
  }, []);

  /** Формує знімок телеметрії та віддає батьківському компоненту. */
  const emitTelemetry = useCallback((world: WorldState, measuredFps: number) => {
    const energy = computeSystemEnergy(world, paramsRef.current);
    onTelemetryRef.current?.({
      time: world.time,
      kineticEnergy: energy.kineticEnergy,
      potentialEnergy: energy.potentialEnergy,
      totalEnergy: energy.totalEnergy,
      fps: measuredFps,
      activeBodiesCount: world.bodies.length,
    });
  }, []);

  /**
   * Retina / HiDPI: фізичний буфер = CSS-розмір * devicePixelRatio, а контекст
   * масштабується так, щоб малювати й надалі в CSS-пікселях. Без цього лінії
   * на щільних екранах розмиті.
   */
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cssWidth = canvas.clientWidth || FALLBACK_CSS_WIDTH;
    const cssHeight =
      canvas.clientHeight || Math.round((cssWidth * WORLD_BOUNDS.height) / WORLD_BOUNDS.width);
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR);

    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    // Присвоєння width/height очищує полотно та скидає трансформацію, тому лише за зміни
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    sizeRef.current = { width: cssWidth, height: cssHeight };
    draw();
  }, [draw]);

  // useEffect з порожніми залежностями (с. 32-33 [[1]], ідея [] з с. 40): підписка
  // на зміну розміру при монтуванні та обов'язкове очищення при розмонтуванні
  useEffect(() => {
    resizeCanvas();
    const canvas = canvasRef.current;

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvas) {
      observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(canvas);
    }
    // Запасний варіант і реакція на зміну масштабу сторінки (змінює devicePixelRatio)
    window.addEventListener('resize', resizeCanvas);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [resizeCanvas]);

  // Ініціалізація сцени (с. 32-33 [[1]], масив залежностей [dep]).
  // READY завжди означає «початок»: створюємо світ заново та малюємо стартовий кадр.
  // У PAUSED / ERROR / RUNNING поточний світ зберігається, лише перемальовується.
  useEffect(() => {
    const needsFreshWorld =
      status === 'READY' ||
      worldRef.current === null ||
      worldRef.current.presetId !== presetId;

    if (needsFreshWorld) {
      const fresh = createInitialWorld(presetId, params);
      worldRef.current = fresh;
      lastFrameTimeRef.current = null;
      emitTelemetry(fresh, 0);
    }
    draw();
  }, [status, presetId, params, resetVersion, draw, emitTelemetry]);

  // Перемальовування при зміні шарів або теми (особливо важливо на паузі,
  // коли цикл анімації не працює)
  useEffect(() => {
    draw();
  }, [options, theme, draw]);

  // Цикл анімації (с. 32-33, 38-39 [[1]]): працює лише в RUNNING.
  // Cleanup зупиняє requestAnimationFrame при паузі, зміні стану та розмонтуванні.
  useEffect(() => {
    if (status !== 'RUNNING') return;

    lastFrameTimeRef.current = null;
    fpsMeterRef.current = { frames: 0, windowStart: null };

    const tick = (now: number): void => {
      const world = worldRef.current;
      if (world) {
        const last = lastFrameTimeRef.current;
        // Перший кадр після старту має нульову дельту (без «стрибка» після паузи)
        const deltaSec = last === null ? 0 : (now - last) / 1000;
        lastFrameTimeRef.current = now;

        const next = advanceWorldByFrameDelta(world, paramsRef.current, deltaSec);

        if (!isWorldFinite(next)) {
          // Інтегратор розійшовся: зупиняємо цикл і повідомляємо автомат
          rafIdRef.current = null;
          onDivergedRef.current?.(
            'Симуляція стала нестабільною (некінцеві значення). Змініть параметри або скиньте сцену.',
          );
          return;
        }

        worldRef.current = next;
        draw();

        // FPS та телеметрія з троттлінгом: React-дерево не рендериться 60 разів/с
        const meter = fpsMeterRef.current;
        meter.frames += 1;
        if (meter.windowStart === null) meter.windowStart = now;
        const elapsed = now - meter.windowStart;
        if (elapsed >= TELEMETRY_INTERVAL_MS) {
          const measuredFps = Math.round((meter.frames * 1000) / elapsed);
          meter.frames = 0;
          meter.windowStart = now;
          setFps(measuredFps);
          emitTelemetry(next, measuredFps);
        }
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [status, draw, emitTelemetry]);

  // Іммутабельне оновлення об'єкта стану (с. 27-28 [[1]]): { ...prev, поле: значення }
  const toggleLayer = (key: keyof LayerOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const presetTitle = PRESET_CATALOG.find((preset) => preset.id === presetId)?.title ?? presetId;

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Шари візуалізації" className="flex flex-wrap items-center gap-2">
        {/* Список із унікальним key (с. 21-22 [[1]]) */}
        {LAYER_TOGGLES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={options[key]}
            onClick={() => toggleLayer(key)}
            className={`rounded-md border px-2 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${
              options[key]
                ? 'border-sky-600 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
        {/* Тернарний оператор (с. 19-20 [[1]]): FPS має сенс лише під час симуляції */}
        <span
          data-testid="fps-badge"
          className="ml-auto rounded bg-slate-200 px-2 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        >
          FPS: {status === 'RUNNING' ? fps : '—'}
        </span>
      </div>

      {/* Крок 2 (с. 40 [[1]]): прив'язка ref до елемента. aspect-ratio зберігає пропорції світу 20:12 */}
      <canvas
        ref={canvasRef}
        data-testid="simulation-canvas"
        role="img"
        aria-label={`Полотно симуляції: ${presetTitle}`}
        className="block w-full rounded border border-slate-200 dark:border-slate-700"
        style={{ aspectRatio: `${WORLD_BOUNDS.width} / ${WORLD_BOUNDS.height}`, height: 'auto' }}
      />
    </div>
  );
}