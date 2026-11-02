import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { SimulationCanvas } from '../components/SimulationCanvas';
import {
  THEME_PALETTE,
  getGridStepMeters,
  renderWorldToCanvas,
  worldToCanvas,
} from '../engine/canvasRenderer';
import type { RenderOptions } from '../engine/canvasRenderer';
import { createInitialWorld, stepPhysicsWorld } from '../engine/physicsEngine';
import type { WorldState } from '../engine/physicsEngine';
import type { SimulationParams, TelemetrySnapshot } from '../types/simulation';
import {
  DEFAULT_SIMULATION_PARAMS,
  PARAM_BOUNDS,
  validateSimulationParams,
} from '../utils/paramValidator';
import { createMockContext2D, getMockContext, installCanvasTestEnvironment } from './canvasMock';
import type { MockContext2D } from './canvasMock';
import { TEST_PROFILE } from './testProfile';

// ---------------------------------------------------------------------------
// Допоміжні функції
// ---------------------------------------------------------------------------

const P = (override: Partial<SimulationParams> = {}): SimulationParams => ({
  ...DEFAULT_SIMULATION_PARAMS,
  ...override,
});

const asContext = (mock: MockContext2D): CanvasRenderingContext2D =>
  mock as unknown as CanvasRenderingContext2D;

const ALL_OFF: RenderOptions = {
  showGrid: false,
  showTrails: false,
  showVelocityVectors: false,
  showForceVectors: false,
  theme: 'light',
};

const W = 800;
const H = 480;

/** Малює світ у свіжий мок-контекст і повертає його. */
function paint(world: WorldState, options: RenderOptions, width = W, height = H): MockContext2D {
  const ctx = createMockContext2D();
  renderWorldToCanvas(asContext(ctx), world, options, width, height);
  return ctx;
}

const getCanvas = (): HTMLCanvasElement => {
  const element = screen.getByTestId('simulation-canvas');
  if (!(element instanceof HTMLCanvasElement)) throw new Error('Очікувався <canvas>');
  return element;
};

/** Підміна requestAnimationFrame: кадри запускаються вручну через runFrame. */
function installManualRaf() {
  const callbacks: FrameRequestCallback[] = [];
  const raf = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  const caf = vi.fn();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);

  const runFrame = (time: number): void => {
    const callback = callbacks[callbacks.length - 1];
    if (!callback) throw new Error('Немає запланованого кадру');
    act(() => {
      callback(time);
    });
  };
  return { raf, caf, runFrame };
}

afterEach(() => {
  // Повертаємо типові стаби після тестів, що підміняли rAF
  installCanvasTestEnvironment();
});

// ---------------------------------------------------------------------------
// Чисті функції
// ---------------------------------------------------------------------------

describe('worldToCanvas', () => {
  it('віддзеркалює вісь Y: (0,0) -> лівий нижній, (20,12) -> правий верхній кут', () => {
    expect(worldToCanvas({ x: 0, y: 0 }, W, H)).toEqual({ x: 0, y: H });
    expect(worldToCanvas({ x: 20, y: 12 }, W, H)).toEqual({ x: W, y: 0 });
    expect(worldToCanvas({ x: 10, y: 6 }, W, H)).toEqual({ x: W / 2, y: H / 2 });
  });
});

describe('getGridStepMeters', () => {
  it('крок 1 м для широкого полотна та 2 м для вузького', () => {
    expect(getGridStepMeters(800)).toBe(1);
    expect(getGridStepMeters(400)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// renderWorldToCanvas
// ---------------------------------------------------------------------------

describe('renderWorldToCanvas', () => {
  const projectile = createInitialWorld('PROJECTILE', P());

  it('малює сітку, коли showGrid = true (34 лінії при кроці 1 м) і підписи осей', () => {
    const ctx = paint(projectile, { ...ALL_OFF, showGrid: true });
    expect(ctx.moveTo).toHaveBeenCalledTimes(21 + 13);
    expect(ctx.stroke).toHaveBeenCalled();
    // Числові підписи + "x, м" + "y, м" + підпис тіла
    expect(ctx.fillText.mock.calls.length).toBeGreaterThan(5);
  });

  it('пропускає сітку, коли showGrid = false', () => {
    const ctx = paint(projectile, ALL_OFF);
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });

  it('на вузькому полотні сітка розріджується до кроку 2 м', () => {
    const wide = paint(projectile, { ...ALL_OFF, showGrid: true }, 800, 480);
    const narrow = paint(projectile, { ...ALL_OFF, showGrid: true }, 400, 240);
    expect(narrow.moveTo.mock.calls.length).toBeLessThan(wide.moveTo.mock.calls.length);
  });

  it('очищає полотно та заливає фон кольором теми', () => {
    const light = paint(projectile, ALL_OFF);
    expect(light.clearRect).toHaveBeenCalledWith(0, 0, W, H);
    expect(light.fillRect).toHaveBeenCalledWith(0, 0, W, H);
    expect(light.fillStyleHistory).toContain(THEME_PALETTE.light.background);

    const dark = paint(projectile, { ...ALL_OFF, theme: 'dark' });
    expect(dark.fillStyleHistory).toContain(THEME_PALETTE.dark.background);
    expect(dark.fillStyleHistory).not.toContain(THEME_PALETTE.light.background);
  });

  it('малює кожне тіло колом з підписом', () => {
    const world = createInitialWorld('COLLISIONS', P());
    const ctx = paint(world, ALL_OFF);
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(ctx.fillText).toHaveBeenCalledTimes(3);
  });

  it('маятник: малює точку підвісу, нитку та вантаж', () => {
    const world = createInitialWorld('PENDULUM', P());
    const ctx = paint(world, ALL_OFF);
    // Вантаж + точка підвісу
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    // Перекладина + нитка
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
  });

  it('малює стрілки швидкості та сил лише коли ввімкнено', () => {
    const base = paint(projectile, ALL_OFF).fill.mock.calls.length;
    const withVelocity = paint(projectile, { ...ALL_OFF, showVelocityVectors: true });
    const withForce = paint(projectile, { ...ALL_OFF, showForceVectors: true });
    // Наконечник стрілки - додатковий fill
    expect(withVelocity.fill.mock.calls.length).toBeGreaterThan(base);
    expect(withForce.fill.mock.calls.length).toBeGreaterThan(base);
    expect(withVelocity.closePath).toHaveBeenCalled();
  });

  it('вектори працюють і для маятника', () => {
    const moving = stepPhysicsWorld(createInitialWorld('PENDULUM', P()), P());
    const base = paint(moving, ALL_OFF).fill.mock.calls.length;
    const ctx = paint(moving, { ...ALL_OFF, showVelocityVectors: true, showForceVectors: true });
    expect(ctx.fill.mock.calls.length).toBeGreaterThan(base);
  });

  it('малює слід траєкторії лише коли showTrails = true', () => {
    const params = P();
    let world = createInitialWorld('PROJECTILE', params);
    for (let i = 0; i < 10; i++) world = stepPhysicsWorld(world, params);

    const off = paint(world, ALL_OFF);
    const on = paint(world, { ...ALL_OFF, showTrails: true });
    expect(off.lineTo).not.toHaveBeenCalled();
    expect(on.lineTo).toHaveBeenCalled();
  });

  it('пропускає тіла з нескінченними координатами без винятків', () => {
    const body = projectile.bodies[0];
    if (!body) throw new Error('Немає тіла');
    const broken: WorldState = {
      ...projectile,
      bodies: [{ ...body, position: { x: NaN, y: Infinity } }],
    };
    const ctx = paint(broken, { ...ALL_OFF, showVelocityVectors: true, showForceVectors: true });
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('нічого не малює, якщо розмір полотна нульовий', () => {
    const ctx = paint(projectile, ALL_OFF, 0, 0);
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Межі світу та валідатор
// ---------------------------------------------------------------------------

describe('Довжина маятника вміщується у світ', () => {
  it('валідатор відхиляє L > 9.5 м та приймає L = 9.5 м', () => {
    expect(PARAM_BOUNDS.pendulumLength.max).toBe(9.5);
    expect(validateSimulationParams(P({ pendulumLength: 9.6 })).valid).toBe(false);
    expect(validateSimulationParams(P({ pendulumLength: 9.5 })).valid).toBe(true);
  });

  it('вантаж найдовшого маятника лишається над підлогою', () => {
    const world = createInitialWorld('PENDULUM', P({ pendulumLength: 9.5, initialAngleDeg: 0 }));
    const body = world.bodies[0];
    if (!body) throw new Error('Немає тіла');
    expect(body.position.y).toBeGreaterThanOrEqual(body.radius);
  });
});

// ---------------------------------------------------------------------------
// Компонент SimulationCanvas
// ---------------------------------------------------------------------------

describe('SimulationCanvas', () => {
  const baseProps = {
    presetId: 'PROJECTILE' as const,
    params: DEFAULT_SIMULATION_PARAMS,
    theme: 'light' as const,
    resetVersion: 0,
  };

  it('прив’язує ref до <canvas> і малює стартовий кадр у стані READY', () => {
    render(<SimulationCanvas {...baseProps} status="READY" />);
    const canvas = getCanvas();
    const ctx = getMockContext(canvas);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('враховує devicePixelRatio: буфер збільшено, контекст масштабовано', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    try {
      render(<SimulationCanvas {...baseProps} status="READY" />);
      const canvas = getCanvas();
      // У jsdom clientWidth = 0, тому застосовується запасна ширина 800 x 480
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(960);
      expect(getMockContext(canvas).setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    }
  });

  it('перемикає шари та перемальовує полотно', () => {
    render(<SimulationCanvas {...baseProps} status="PAUSED" />);
    const ctx = getMockContext(getCanvas());

    const grid = screen.getByRole('button', { name: 'Сітка' });
    const trails = screen.getByRole('button', { name: 'Траєкторії' });
    const velocity = screen.getByRole('button', { name: 'Вектори швидкості' });
    const force = screen.getByRole('button', { name: 'Вектори сил' });

    // Початкові значення
    expect(grid).toHaveAttribute('aria-pressed', 'true');
    expect(trails).toHaveAttribute('aria-pressed', 'true');
    expect(velocity).toHaveAttribute('aria-pressed', 'true');
    expect(force).toHaveAttribute('aria-pressed', 'false');

    ctx.clearRect.mockClear();
    fireEvent.click(grid);
    expect(grid).toHaveAttribute('aria-pressed', 'false');
    expect(ctx.clearRect).toHaveBeenCalled();

    fireEvent.click(force);
    expect(force).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(trails);
    expect(trails).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(velocity);
    expect(velocity).toHaveAttribute('aria-pressed', 'false');
  });

  it('перемальовує полотно кольором нової теми', () => {
    const { rerender } = render(<SimulationCanvas {...baseProps} status="READY" />);
    const ctx = getMockContext(getCanvas());
    // Фон завжди заливається першим у кадрі, тому порівнюємо останній виклик fillRect
    // із кольором, який був встановлений перед ним
    expect(ctx.fillStyleHistory).toContain(THEME_PALETTE.light.background);

    const lengthBefore = ctx.fillStyleHistory.length;
    rerender(<SimulationCanvas {...baseProps} theme="dark" status="READY" />);

    // Нові присвоєння після зміни теми: перше з них - фон темної теми
    const added = ctx.fillStyleHistory.slice(lengthBefore);
    expect(added[0]).toBe(THEME_PALETTE.dark.background);
    expect(added).not.toContain(THEME_PALETTE.light.background);
  });

  it('запускає цикл requestAnimationFrame у RUNNING та зупиняє його на паузі', () => {
    const { raf, caf } = installManualRaf();
    const { rerender } = render(<SimulationCanvas {...baseProps} status="READY" />);
    expect(raf).not.toHaveBeenCalled();

    rerender(<SimulationCanvas {...baseProps} status="RUNNING" />);
    expect(raf).toHaveBeenCalledTimes(1);

    rerender(<SimulationCanvas {...baseProps} status="PAUSED" />);
    expect(caf).toHaveBeenCalledWith(1);
  });

  it('скасовує requestAnimationFrame при розмонтуванні', () => {
    const { caf } = installManualRaf();
    const { rerender, unmount } = render(<SimulationCanvas {...baseProps} status="READY" />);
    rerender(<SimulationCanvas {...baseProps} status="RUNNING" />);
    expect(caf).not.toHaveBeenCalled();

    unmount();
    expect(caf).toHaveBeenCalledWith(1);
  });

  it('просуває світ, троттлить телеметрію та показує FPS', () => {
    const { runFrame } = installManualRaf();
    const onTelemetry = vi.fn<(snapshot: TelemetrySnapshot) => void>();
    const { rerender } = render(
      <SimulationCanvas {...baseProps} status="READY" onTelemetryUpdate={onTelemetry} />,
    );

    // Початкова телеметрія від READY: час 0
    expect(onTelemetry.mock.calls[0]?.[0].time).toBe(0);
    const callsAtStart = onTelemetry.mock.calls.length;

    rerender(<SimulationCanvas {...baseProps} status="RUNNING" onTelemetryUpdate={onTelemetry} />);
    runFrame(1000);
    runFrame(1100);
    // Менше 200 мс від початку вікна: нова телеметрія ще не надсилалась
    expect(onTelemetry.mock.calls.length).toBe(callsAtStart);

    runFrame(1250);
    expect(onTelemetry.mock.calls.length).toBe(callsAtStart + 1);
    const last = onTelemetry.mock.lastCall?.[0];
    expect(last?.time).toBeGreaterThan(0);
    // 3 кадри за 250 мс -> 12 FPS
    expect(last?.fps).toBe(12);
    expect(screen.getByTestId('fps-badge')).toHaveTextContent('FPS: 12');
  });

  it('повертає сцену на початок, коли READY приходить із новим resetVersion', () => {
    const { runFrame } = installManualRaf();
    const onTelemetry = vi.fn<(snapshot: TelemetrySnapshot) => void>();
    const props = { ...baseProps, onTelemetryUpdate: onTelemetry };
    const { rerender } = render(<SimulationCanvas {...props} status="READY" />);

    rerender(<SimulationCanvas {...props} status="RUNNING" />);
    runFrame(1000);
    runFrame(1100);
    runFrame(1250);
    expect(onTelemetry.mock.lastCall?.[0].time).toBeGreaterThan(0);

    rerender(<SimulationCanvas {...props} status="PAUSED" />);
    rerender(<SimulationCanvas {...props} status="READY" resetVersion={1} />);
    expect(onTelemetry.mock.lastCall?.[0].time).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Інтеграція з App
// ---------------------------------------------------------------------------

describe('Інтеграція Canvas у App', () => {
  it('показує <canvas> лише після вибору пресету', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    expect(screen.queryByTestId('simulation-canvas')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
    expect(screen.getByTestId('simulation-canvas')).toBeInTheDocument();
  });

  it('оновлює телеметрію під час симуляції та скидає її кнопкою «Скидання»', () => {
    const { runFrame } = installManualRaf();
    render(<App initialProfile={TEST_PROFILE} />);

    fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
    expect(screen.getByTestId('telemetry-time')).toHaveTextContent('0.00');

    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('RUNNING');
    runFrame(1000);
    runFrame(1100);
    runFrame(1250);
    expect(screen.getByTestId('telemetry-time')).not.toHaveTextContent('0.00');
    expect(screen.getByTestId('telemetry-fps')).toHaveTextContent('12');

    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('PAUSED');

    fireEvent.click(screen.getByRole('button', { name: 'Скидання' }));
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('READY');
    expect(screen.getByTestId('telemetry-time')).toHaveTextContent('0.00');
  });
});