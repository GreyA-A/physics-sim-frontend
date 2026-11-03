import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import App from '../App';
import { ExportPanel } from '../components/ExportPanel';
import { ParameterPanel } from '../components/ParameterPanel';
import { SimulationCanvas } from '../components/SimulationCanvas';
import { TelemetryPanel } from '../components/TelemetryPanel';
import {
  advanceWorldByFrameDelta,
  createInitialWorld,
  isWorldFinite,
  makeBody,
  stepPhysicsWorld,
} from '../engine/physicsEngine';
import type { WorldState } from '../engine/physicsEngine';
import type { SimulationParams, TelemetrySnapshot } from '../types/simulation';
import {
  exportCanvasToPng,
  parseAndValidateSceneJson,
  readFileAsText,
  serializeSceneToJson,
} from '../utils/exportService';
import { DEFAULT_SIMULATION_PARAMS } from '../utils/paramValidator';
import {
  STORAGE_KEY,
  clearProfile,
  createProfile,
  isResearcherProfile,
} from '../utils/profileStorage';
import { computeTelemetryStats } from '../utils/telemetryStats';
import { exportMocks, installCanvasTestEnvironment } from './canvasMock';
import { TEST_PROFILE } from './testProfile';

// Обгортка над справжньою isWorldFinite: за замовчуванням викликає оригінал, але тест
// може змусити її один раз повернути false (дивергенція інтегратора в App).
vi.mock('../engine/physicsEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/physicsEngine')>();
  return { ...actual, isWorldFinite: vi.fn(actual.isWorldFinite) };
});

// ---------------------------------------------------------------------------
// Прибирання між тестами
// ---------------------------------------------------------------------------

const spies: Array<{ mockRestore: () => void }> = [];
const track = <T extends { mockRestore: () => void }>(spy: T): T => {
  spies.push(spy);
  return spy;
};

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
  vi.unstubAllGlobals();
  installCanvasTestEnvironment();
});

// ---------------------------------------------------------------------------
// Допоміжні функції
// ---------------------------------------------------------------------------

const P = (override: Partial<SimulationParams> = {}): SimulationParams => ({
  ...DEFAULT_SIMULATION_PARAMS,
  ...override,
});

const NOW = new Date('2026-11-03T10:15:30.000Z');

type Obj = Record<string, unknown>;

const validJson = () => serializeSceneToJson('PROJECTILE', P(), NOW);

const mutate = (change: (obj: Obj) => void): string => {
  const obj = JSON.parse(validJson()) as Obj;
  change(obj);
  return JSON.stringify(obj);
};

const section = (obj: Obj, key: string): Obj => obj[key] as Obj;

const firstBodyOf = (obj: Obj): Obj => {
  const body = (obj.bodies as Obj[])[0];
  if (!body) throw new Error('Немає тіл');
  return body;
};

const snap = (time: number, ek: number, ep: number, fps = 60): TelemetrySnapshot => ({
  time,
  kineticEnergy: ek,
  potentialEnergy: ep,
  totalEnergy: ek + ep,
  fps,
  activeBodiesCount: 1,
});

/** Підміна requestAnimationFrame: кадри запускаються вручну через runFrame. */
function installManualRaf() {
  const callbacks: FrameRequestCallback[] = [];
  const raf = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  const runFrame = (time: number): void => {
    const callback = callbacks[callbacks.length - 1];
    if (!callback) throw new Error('Немає запланованого кадру');
    act(() => {
      callback(time);
    });
  };
  return { raf, runFrame };
}

function getInput(label: RegExp): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error('Очікувався <input>');
  return element;
}

const status = () => screen.getByTestId('simulation-status');

function importFile(content: string, name = 'scene.json') {
  const input = screen.getByTestId('import-file-input');
  const file = new File([content], name, { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

/** Рендерить ExportPanel окремо; canvas за замовчуванням недоступний (null). */
function renderExportPanel(options: { canvas?: HTMLCanvasElement; log?: TelemetrySnapshot[] } = {}) {
  const canvasRef: RefObject<HTMLCanvasElement> = { current: options.canvas ?? null };
  const onImportScene = vi.fn();
  render(
    <ExportPanel
      presetId="PENDULUM"
      params={DEFAULT_SIMULATION_PARAMS}
      telemetryLog={options.log ?? [snap(0, 0, 10)]}
      canvasRef={canvasRef}
      onImportScene={onImportScene}
    />,
  );
  return { onImportScene };
}

/** Заглушки FileReader для імітації збоїв читання. */
class ErroringReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  result: unknown = null;
  readAsText(): void {
    this.onerror?.();
  }
}

class BinaryReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  result: unknown = null;
  readAsText(): void {
    this.result = new ArrayBuffer(1);
    this.onload?.();
  }
}

// ---------------------------------------------------------------------------
// Фізичний рушій: граничні гілки
// ---------------------------------------------------------------------------

describe('physicsEngine: граничні гілки', () => {
  const pendulumWorld = createInitialWorld('PENDULUM', P());

  it('isWorldFinite виявляє некоректні службові поля світу', () => {
    expect(isWorldFinite(pendulumWorld)).toBe(true);
    expect(isWorldFinite({ ...pendulumWorld, time: NaN })).toBe(false);
    expect(isWorldFinite({ ...pendulumWorld, accumulator: Infinity })).toBe(false);
    expect(isWorldFinite({ ...pendulumWorld, pendulumAngleRad: NaN })).toBe(false);
    expect(isWorldFinite({ ...pendulumWorld, pendulumAngularVel: -Infinity })).toBe(false);
  });

  it('isWorldFinite виявляє нескінченну силу тіла', () => {
    const body = pendulumWorld.bodies[0];
    if (!body) throw new Error('Немає тіла');
    const broken: WorldState = { ...pendulumWorld, bodies: [{ ...body, force: { x: NaN, y: 0 } }] };
    expect(isWorldFinite(broken)).toBe(false);
  });

  it('маятник без тіл: крок повертає той самий world', () => {
    const empty: WorldState = { ...pendulumWorld, bodies: [] };
    expect(stepPhysicsWorld(empty, P())).toBe(empty);
  });

  it('тіло з нульовою масою не інтегрується й не дає NaN', () => {
    const base = createInitialWorld('PROJECTILE', P());
    const world: WorldState = {
      ...base,
      bodies: [
        makeBody({
          id: 'm0', label: 'M0', mass: 0, radius: 0.3, restitution: 1, color: '#000',
          position: { x: 5, y: 5 }, velocity: { x: 1, y: 1 },
        }),
      ],
    };
    const after = stepPhysicsWorld(world, P());
    expect(isWorldFinite(after)).toBe(true);
    expect(after.bodies[0]?.position).toEqual({ x: 5, y: 5 });
  });

  it('зіткнення з тілом нульової маси пропускається без NaN', () => {
    const base = createInitialWorld('COLLISIONS', P());
    const world: WorldState = {
      ...base,
      bodies: [
        makeBody({
          id: 'a', label: 'A', mass: 0, radius: 0.5, restitution: 1, color: '#f00',
          position: { x: 5, y: 5 }, velocity: { x: 0, y: 0 },
        }),
        makeBody({
          id: 'b', label: 'B', mass: 1, radius: 0.5, restitution: 1, color: '#00f',
          position: { x: 5.2, y: 5 }, velocity: { x: 0, y: 0 },
        }),
      ],
    };
    expect(isWorldFinite(stepPhysicsWorld(world, P({ gravity: 0 })))).toBe(true);
  });

  it('некоректний timeScale замінюється на 1', () => {
    const params = P({ timeScale: NaN });
    const after = advanceWorldByFrameDelta(createInitialWorld('PROJECTILE', params), params, 0.05);
    expect(after.time).toBeCloseTo(3 * 0.016, 9);
  });

  it('запобіжник кроків: понад 1000 кроків за виклик обнуляє накопичений борг', () => {
    const params = P({ dt: 0.0001, timeScale: 5 });
    const after = advanceWorldByFrameDelta(createInitialWorld('PROJECTILE', params), params, 0.1);
    expect(after.time).toBeCloseTo(0.1, 6);
    expect(after.accumulator).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Дивергенція інтегратора
// ---------------------------------------------------------------------------

describe('Дивергенція симуляції', () => {
  const baseProps = {
    presetId: 'PROJECTILE' as const,
    theme: 'light' as const,
    resetVersion: 0,
  };

  it('SimulationCanvas зупиняє цикл і викликає onSimulationDiverged', () => {
    const { raf, runFrame } = installManualRaf();
    const onDiverged = vi.fn<(message: string) => void>();
    // Нескінченна початкова швидкість: стартовий світ уже не проходить isWorldFinite
    const props = {
      ...baseProps,
      params: P({ initialSpeed: Infinity }),
      onSimulationDiverged: onDiverged,
    };

    const { rerender } = render(<SimulationCanvas {...props} status="READY" />);
    rerender(<SimulationCanvas {...props} status="RUNNING" />);
    expect(raf).toHaveBeenCalledTimes(1);

    runFrame(1000);

    expect(onDiverged).toHaveBeenCalledTimes(1);
    expect(onDiverged.mock.calls[0]?.[0]).toMatch(/нестабільною/);
    // Новий кадр не заплановано: цикл зупинено
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('App переходить у ERROR, показує ErrorBanner і відновлюється кнопкою «Скидання»', () => {
    const { runFrame } = installManualRaf();
    vi.mocked(isWorldFinite).mockReturnValueOnce(false);

    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: /балістичний рух/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    expect(status()).toHaveTextContent('RUNNING');

    runFrame(1000);

    expect(status()).toHaveTextContent('ERROR');
    expect(screen.getByRole('alert')).toHaveTextContent(/нестабільною/);
    expect(screen.getByRole('button', { name: 'Старт' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Скидання' }));
    expect(status()).toHaveTextContent('READY');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExportPanel: збої
// ---------------------------------------------------------------------------

describe('ExportPanel: збої', () => {
  it('JSON: збій створення файлу показує помилку', () => {
    renderExportPanel();
    exportMocks.createObjectURL.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Експортувати сцену (JSON)' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося створити файл сцени.');
    expect(exportMocks.downloads).toHaveLength(0);
  });

  it('CSV: збій створення файлу показує помилку', () => {
    renderExportPanel();
    exportMocks.createObjectURL.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити телеметрію (CSV)' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося створити файл телеметрії.');
  });

  it('PNG: полотно недоступне -> role="alert"', async () => {
    renderExportPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти знімок (PNG)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/полотно недоступне/);
    expect(exportMocks.downloads).toHaveLength(0);
  });

  it('PNG: toBlob і toDataURL не створили зображення -> role="alert"', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = ((callback: BlobCallback) => callback(null)) as HTMLCanvasElement['toBlob'];
    canvas.toDataURL = (() => 'data:,') as HTMLCanvasElement['toDataURL'];
    renderExportPanel({ canvas });

    fireEvent.click(screen.getByRole('button', { name: 'Зберегти знімок (PNG)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Не вдалося зберегти знімок/);
  });

  it('імпорт: збій FileReader показує помилку читання', async () => {
    vi.stubGlobal('FileReader', ErroringReader);
    const { onImportScene } = renderExportPanel();

    importFile(validJson());

    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося прочитати файл.');
    expect(onImportScene).not.toHaveBeenCalled();
  });

  it('імпорт без вибраного файлу нічого не змінює', () => {
    const { onImportScene } = renderExportPanel();
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onImportScene).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// exportService: граничні гілки
// ---------------------------------------------------------------------------

describe('exportService: граничні гілки', () => {
  it('відхиляє надмірну вкладеність об’єктів і масивів', () => {
    const deepObject = `{"x":${'{"a":'.repeat(10)}1${'}'.repeat(10)}}`;
    const deepArray = `{"x":${'['.repeat(12)}${']'.repeat(12)}}`;
    for (const raw of [deepObject, deepArray]) {
      const result = parseAndValidateSceneJson(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/надмірна вкладеність/);
    }
  });

  const CASES: Array<[string, () => string, RegExp]> = [
    ['presetParams.initialSpeed рядком', () => mutate((o) => { section(o, 'presetParams').initialSpeed = '15'; }), /presetParams\.initialSpeed/],
    ['environment = null', () => mutate((o) => { o.environment = null; }), /environment/],
    ['presetParams масивом', () => mutate((o) => { o.presetParams = []; }), /presetParams/],
    ['exportedAt числом', () => mutate((o) => { o.exportedAt = 5; }), /exportedAt/],
    ['надто довгий exportedAt', () => mutate((o) => { o.exportedAt = 'x'.repeat(41); }), /exportedAt/],
    ['bodies не масив', () => mutate((o) => { o.bodies = {}; }), /bodies/],
    ['mass рядком', () => mutate((o) => { firstBodyOf(o).mass = '1'; }), /скінченними числами/],
    ['restitution рядком', () => mutate((o) => { firstBodyOf(o).restitution = '1'; }), /скінченними числами/],
    ['маса понад межу', () => mutate((o) => { firstBodyOf(o).mass = 5000; }), /Маса/],
    ['id числом', () => mutate((o) => { firstBodyOf(o).id = 5; }), /«id»/],
    ['label числом', () => mutate((o) => { firstBodyOf(o).label = 5; }), /«label»/],
    ['color числом', () => mutate((o) => { firstBodyOf(o).color = 5; }), /«color»/],
    ['velocity = null', () => mutate((o) => { firstBodyOf(o).velocity = null; }), /velocity/],
    ['position без y', () => mutate((o) => { delete section(firstBodyOf(o), 'position').y; }), /position/],
  ];

  it.each(CASES)('відхиляє: %s', (_name, build, expected) => {
    const result = parseAndValidateSceneJson(build());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(expected);
  });

  it('exportCanvasToPng: toBlob кидає виняток -> запасний toDataURL', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = (() => {
      throw new Error('toBlob');
    }) as unknown as HTMLCanvasElement['toBlob'];
    expect(await exportCanvasToPng(canvas, 'a.png')).toBe(true);
    expect(exportMocks.toDataURL).toHaveBeenCalled();
  });

  it('exportCanvasToPng: toBlob відсутній -> запасний toDataURL', async () => {
    const canvas = document.createElement('canvas');
    (canvas as unknown as { toBlob: unknown }).toBlob = undefined;
    expect(await exportCanvasToPng(canvas, 'a.png')).toBe(true);
  });

  it('exportCanvasToPng: toDataURL кидає виняток -> false', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = ((callback: BlobCallback) => callback(null)) as HTMLCanvasElement['toBlob'];
    canvas.toDataURL = (() => {
      throw new Error('SecurityError');
    }) as unknown as HTMLCanvasElement['toDataURL'];
    expect(await exportCanvasToPng(canvas, 'a.png')).toBe(false);
  });

  it('exportCanvasToPng: некоректний base64 -> false', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = ((callback: BlobCallback) => callback(null)) as HTMLCanvasElement['toBlob'];
    canvas.toDataURL = (() => 'data:image/png;base64,A') as HTMLCanvasElement['toDataURL'];
    expect(await exportCanvasToPng(canvas, 'a.png')).toBe(false);
  });

  it('readFileAsText відхиляє проміс, якщо читання не вдалося', async () => {
    vi.stubGlobal('FileReader', ErroringReader);
    await expect(readFileAsText(new Blob(['x']))).rejects.toThrow('Не вдалося прочитати файл.');
  });

  it('readFileAsText повертає порожній рядок, якщо результат не є рядком', async () => {
    vi.stubGlobal('FileReader', BinaryReader);
    expect(await readFileAsText(new Blob(['x']))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// profileStorage
// ---------------------------------------------------------------------------

describe('profileStorage: граничні гілки', () => {
  it('без crypto.randomUUID використовується запасний генератор id', () => {
    vi.stubGlobal('crypto', {});
    const profile = createProfile('Іван Петренко', 'light');
    expect(profile.id).toMatch(/^p-[a-z0-9]+-[a-z0-9]+$/);
    expect(isResearcherProfile(profile)).toBe(true);
  });

  it('clearProfile не кидає виняток, якщо сховище заблоковане', () => {
    track(vi.spyOn(Storage.prototype, 'removeItem')).mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => clearProfile()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ParameterPanel
// ---------------------------------------------------------------------------

describe('ParameterPanel: форма', () => {
  const renderPanel = () => {
    const onUpdateParams = vi.fn();
    render(
      <ParameterPanel
        params={DEFAULT_SIMULATION_PARAMS}
        validationErrors={{}}
        presetId="PENDULUM"
        onUpdateParams={onUpdateParams}
        onRestoreDefaults={vi.fn()}
      />,
    );
    return onUpdateParams;
  };

  it('відправка форми скасовує стандартну поведінку браузера', () => {
    renderPanel();
    const form = document.querySelector('form');
    if (!form) throw new Error('Форму не знайдено');
    // fireEvent повертає false, якщо подію скасовано через preventDefault()
    expect(fireEvent.submit(form)).toBe(false);
  });

  it('невідоме ім’я поля ігнорується', () => {
    const onUpdateParams = renderPanel();
    const gravity = getInput(/Прискорення/i);
    gravity.name = 'hack';
    fireEvent.change(gravity, { target: { value: '5' } });
    expect(onUpdateParams).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Статистика та TelemetryPanel
// ---------------------------------------------------------------------------

describe('Телеметрія: граничні гілки', () => {
  it('додатний дрейф енергії відображається зі знаком +', () => {
    const log = [snap(0, 0, 100), snap(1, 60, 45)];
    render(<TelemetryPanel log={log} status="RUNNING" hasPreset onClearLog={() => undefined} />);
    expect(screen.getByTestId('telemetry-drift')).toHaveTextContent('+5.00 %');
  });

  it('нескінченна енергія останнього запису дає порожні поточні показники', () => {
    const stats = computeTelemetryStats([snap(0, 1, 1), snap(1, NaN, 1)]);
    expect(stats.totalEnergy).toBeNull();
    expect(stats.kineticEnergy).toBeNull();
    expect(stats.kineticShare).toBeNull();
    expect(stats.maxEnergy).toBe(2);
    expect(stats.driftPercent).toBeNull();
  });

  it('нескінченна початкова енергія не дає дрейфу', () => {
    const stats = computeTelemetryStats([snap(0, NaN, 1), snap(1, 2, 2)]);
    expect(stats.initialEnergy).toBeNull();
    expect(stats.driftPercent).toBeNull();
    expect(stats.totalEnergy).toBe(4);
  });

  it('якщо всі записи нескінченні, агрегати порожні', () => {
    const stats = computeTelemetryStats([snap(1, NaN, 1)]);
    expect(stats.maxEnergy).toBeNull();
    expect(stats.minEnergy).toBeNull();
    expect(stats.avgEnergy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Наскрізний сценарій
// ---------------------------------------------------------------------------

describe('Повний шлях дослідника (End-to-End User Journey)', () => {
  it('вхід -> пресет -> параметри й симуляція -> експорт -> вихід', async () => {
    const { runFrame } = installManualRaf();
    render(<App />);

    // 1. Гість бачить екран швидкого старту й авторизується
    expect(screen.getByRole('heading', { name: /швидкий старт/i })).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-header')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/дослідника/i), { target: { value: 'Марія Коваль' } });
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(screen.getByTestId('workspace-header')).toBeInTheDocument();
    expect(screen.getByTestId('session-name')).toHaveTextContent('Марія Коваль');
    expect(status()).toHaveTextContent('IDLE');

    // 2. Крок 1 User Guide: вибір пресету
    fireEvent.click(screen.getByRole('button', { name: /балістичний рух/i }));
    expect(status()).toHaveTextContent('READY');
    expect(screen.getByTestId('selected-preset')).toHaveTextContent('Балістичний рух у полі тяжіння');
    expect(screen.getByTestId('simulation-canvas')).toBeInTheDocument();

    // 3. Крок 2 User Guide: параметри (Марс), старт, кадри, пауза
    fireEvent.click(screen.getByRole('tab', { name: 'Параметри' }));
    fireEvent.change(getInput(/Прискорення вільного падіння/i), { target: { value: '3.71' } });
    expect(status()).toHaveTextContent('READY');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    expect(status()).toHaveTextContent('RUNNING');
    runFrame(1000);
    runFrame(1100);
    runFrame(1250);

    expect(screen.getByTestId('telemetry-time')).not.toHaveTextContent('0.00');
    expect(screen.getByTestId('telemetry-fps')).toHaveTextContent('12');
    expect(within(screen.getByTestId('telemetry-log')).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    // Агрегати useMemo: максимум енергії та дрейф
    expect(screen.getByTestId('telemetry-max')).toHaveTextContent(/^\d+\.\d{2}$/);
    expect(screen.getByTestId('telemetry-drift')).toHaveTextContent(/%/);

    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(status()).toHaveTextContent('PAUSED');
    expect(screen.getByTestId('telemetry-log-status')).toHaveTextContent(/Пауза/);

    // 4. Крок 3 User Guide: експорт JSON, CSV, PNG
    fireEvent.click(screen.getByRole('tab', { name: 'Експорт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Експортувати сцену (JSON)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити телеметрію (CSV)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти знімок (PNG)' }));

    await waitFor(() => expect(exportMocks.downloads).toHaveLength(3));
    const names = exportMocks.downloads.map((download) => download.filename);
    expect(names[0]).toMatch(/^scene-projectile-\d{8}-\d{6}\.json$/);
    expect(names[1]).toMatch(/^telemetry-\d{8}-\d{6}\.csv$/);
    expect(names[2]).toMatch(/^snapshot-\d{8}-\d{6}\.png$/);

    // Вміст файлів: JSON проходить власну валідацію і містить gravity = 3.71
    const jsonBlob = exportMocks.createObjectURL.mock.calls[0]?.[0];
    if (!jsonBlob) throw new Error('JSON Blob не створено');
    const parsed = parseAndValidateSceneJson(await readFileAsText(jsonBlob));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.presetId).toBe('PROJECTILE');
      expect(parsed.params.gravity).toBe(3.71);
    }

    // CSV: заголовок і щонайменше два записи
    const csvBlob = exportMocks.createObjectURL.mock.calls[1]?.[0];
    if (!csvBlob) throw new Error('CSV Blob не створено');
    const lines = (await readFileAsText(csvBlob)).split('\r\n');
    expect(lines[0]).toBe('time_s,kinetic_energy_j,potential_energy_j,total_energy_j,fps,active_bodies');
    expect(lines[1]).toMatch(/^0,/);
    expect(lines.length).toBeGreaterThanOrEqual(4);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Знімок/));

    // 5. Вихід із профілю
    fireEvent.click(screen.getByRole('button', { name: 'Вийти з профілю' }));
    expect(screen.getByRole('heading', { name: /швидкий старт/i })).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('simulation-canvas')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});