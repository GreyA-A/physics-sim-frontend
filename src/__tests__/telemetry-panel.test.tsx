import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { TelemetryPanel } from '../components/TelemetryPanel';
import type { TelemetrySnapshot } from '../types/simulation';
import {
  MAX_TELEMETRY_LOG_SIZE,
  appendTelemetry,
  computeTelemetryStats,
} from '../utils/telemetryStats';
import { installCanvasTestEnvironment } from './canvasMock';
import { TEST_PROFILE } from './testProfile';

// Обгортка-шпигун над справжньою функцією агрегації: рахує виклики, поведінку не змінює
vi.mock('../utils/telemetryStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/telemetryStats')>();
  return { ...actual, computeTelemetryStats: vi.fn(actual.computeTelemetryStats) };
});

afterEach(() => {
  installCanvasTestEnvironment();
});

// ---------------------------------------------------------------------------
// Допоміжні функції
// ---------------------------------------------------------------------------

const snap = (time: number, ek: number, ep: number, fps = 60): TelemetrySnapshot => ({
  time,
  kineticEnergy: ek,
  potentialEnergy: ep,
  totalEnergy: ek + ep,
  fps,
  activeBodiesCount: 1,
});

const noop = () => undefined;

const rowsOf = () => within(screen.getByTestId('telemetry-log')).getAllByRole('listitem');

function installManualRaf() {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  return (time: number): void => {
    const callback = callbacks[callbacks.length - 1];
    if (!callback) throw new Error('Немає запланованого кадру');
    act(() => {
      callback(time);
    });
  };
}

// ---------------------------------------------------------------------------
// computeTelemetryStats
// ---------------------------------------------------------------------------

describe('computeTelemetryStats', () => {
  it('для порожнього журналу повертає порожні агрегати', () => {
    const stats = computeTelemetryStats([]);
    expect(stats.count).toBe(0);
    expect(stats.latest).toBeNull();
    expect(stats.totalEnergy).toBeNull();
    expect(stats.kineticShare).toBeNull();
    expect(stats.driftPercent).toBeNull();
  });

  it('для одного запису: E = Ek + Ep, частки та нульовий дрейф', () => {
    const stats = computeTelemetryStats([snap(1.5, 30, 70)]);
    expect(stats.count).toBe(1);
    expect(stats.totalEnergy).toBe(100);
    expect(stats.kineticShare).toBeCloseTo(30, 9);
    expect(stats.potentialShare).toBeCloseTo(70, 9);
    expect(stats.maxEnergy).toBe(100);
    expect(stats.minEnergy).toBe(100);
    expect(stats.driftPercent).toBeCloseTo(0, 9);
  });

  it('рахує max, min, середнє та дрейф відносно першого запису', () => {
    const stats = computeTelemetryStats([snap(0, 0, 100), snap(1, 60, 50), snap(2, 40, 50)]);
    expect(stats.maxEnergy).toBe(110);
    expect(stats.minEnergy).toBe(90);
    expect(stats.avgEnergy).toBeCloseTo(100, 9);
    expect(stats.initialEnergy).toBe(100);
    expect(stats.driftPercent).toBeCloseTo(-10, 9);
  });

  it('дрейф не визначений, якщо початкова енергія нульова', () => {
    expect(computeTelemetryStats([snap(0, 0, 0), snap(1, 5, 5)]).driftPercent).toBeNull();
  });

  it('частки не визначені, якщо E <= 0', () => {
    const stats = computeTelemetryStats([snap(1, 0, 0)]);
    expect(stats.kineticShare).toBeNull();
    expect(stats.potentialShare).toBeNull();
  });

  it('пропускає нескінченні значення в max / min / avg', () => {
    const stats = computeTelemetryStats([snap(0, NaN, 1), snap(1, 2, 3)]);
    expect(stats.maxEnergy).toBe(5);
    expect(stats.minEnergy).toBe(5);
    expect(stats.avgEnergy).toBe(5);
    expect(stats.driftPercent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// appendTelemetry (кільцевий буфер)
// ---------------------------------------------------------------------------

describe('appendTelemetry', () => {
  it('time = 0 скидає журнал до одного стартового запису', () => {
    const prev = [snap(1, 1, 1), snap(2, 1, 1)];
    const start = snap(0, 5, 5);
    expect(appendTelemetry(prev, start)).toEqual([start]);
  });

  it('додає запис у кінець, не змінюючи попередній масив', () => {
    const prev = Object.freeze([snap(1, 1, 1)]) as TelemetrySnapshot[];
    const next = appendTelemetry(prev, snap(2, 1, 1));
    expect(next).not.toBe(prev);
    expect(next).toHaveLength(2);
    expect(prev).toHaveLength(1);
  });

  it('замінює останній запис, якщо час не змінився (унікальність key)', () => {
    const prev = [snap(1, 1, 1, 30)];
    const next = appendTelemetry(prev, snap(1, 1, 1, 144));
    expect(next).toHaveLength(1);
    expect(next[0]?.fps).toBe(144);
  });

  it('ігнорує знімок із нескінченним часом (повертає той самий масив)', () => {
    const prev = [snap(1, 1, 1)];
    expect(appendTelemetry(prev, snap(NaN, 1, 1))).toBe(prev);
    expect(appendTelemetry(prev, snap(Infinity, 1, 1))).toBe(prev);
  });

  it('зберігає рівно останні 40 записів із 50 і не мутує попередні масиви', () => {
    expect(MAX_TELEMETRY_LOG_SIZE).toBe(40);
    let log: TelemetrySnapshot[] = [];
    for (let i = 1; i <= 50; i++) {
      // Заморожений масив: будь-який push кинув би TypeError
      const frozen = Object.freeze([...log]) as TelemetrySnapshot[];
      log = appendTelemetry(frozen, snap(i, 1, 1));
    }
    expect(log).toHaveLength(40);
    expect(log[0]?.time).toBe(11);
    expect(log[39]?.time).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// TelemetryPanel
// ---------------------------------------------------------------------------

describe('TelemetryPanel: відображення', () => {
  it('без пресету показує порожній стан і прочерки', () => {
    render(<TelemetryPanel log={[]} status="IDLE" hasPreset={false} onClearLog={noop} />);
    expect(screen.getByText(/Оберіть пресет, щоб почати запис/)).toBeInTheDocument();
    expect(screen.getByTestId('telemetry-time')).toHaveTextContent('-');
    expect(screen.getByTestId('telemetry-energy')).toHaveTextContent('-');
    expect(screen.queryByTestId('telemetry-log')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Очистити журнал' })).toBeDisabled();
  });

  it('з пресетом, але без записів показує «Журнал порожній»', () => {
    render(<TelemetryPanel log={[]} status="READY" hasPreset onClearLog={noop} />);
    expect(screen.getByText('Журнал порожній.')).toBeInTheDocument();
  });

  it('один запис: показники, підпис очікування та один рядок журналу', () => {
    render(<TelemetryPanel log={[snap(0, 0, 80)]} status="READY" hasPreset onClearLog={noop} />);
    expect(screen.getByTestId('telemetry-time')).toHaveTextContent('0.00');
    expect(screen.getByTestId('telemetry-energy')).toHaveTextContent('80.00');
    expect(screen.getByTestId('telemetry-bodies')).toHaveTextContent('1');
    expect(screen.getByTestId('telemetry-log-status')).toHaveTextContent(/Очікування запуску/);
    expect(rowsOf()).toHaveLength(1);
  });

  it('розраховує Ek, Ep, E та частки; смуга має доступний опис', () => {
    render(<TelemetryPanel log={[snap(1.5, 30, 70)]} status="RUNNING" hasPreset onClearLog={noop} />);
    expect(screen.getByTestId('telemetry-ek')).toHaveTextContent('30.00');
    expect(screen.getByTestId('telemetry-ep')).toHaveTextContent('70.00');
    expect(screen.getByTestId('telemetry-energy')).toHaveTextContent('100.00');
    expect(screen.getByTestId('telemetry-ek-share')).toHaveTextContent('30.0 %');
    expect(screen.getByTestId('telemetry-ep-share')).toHaveTextContent('70.0 %');
    expect(screen.getByRole('img', { name: /Частка кінетичної енергії 30\.0 %/ })).toBeInTheDocument();
  });

  it('показує FPS лише під час симуляції', () => {
    const log = [snap(1, 1, 1, 144)];
    const { rerender } = render(<TelemetryPanel log={log} status="RUNNING" hasPreset onClearLog={noop} />);
    expect(screen.getByTestId('telemetry-fps')).toHaveTextContent('144');

    rerender(<TelemetryPanel log={log} status="PAUSED" hasPreset onClearLog={noop} />);
    expect(screen.getByTestId('telemetry-fps')).toHaveTextContent('-');
    expect(screen.getByTestId('telemetry-log-status')).toHaveTextContent(/Пауза/);
  });

  it('показує статистику та дрейф енергії', () => {
    const log = [snap(0, 0, 100), snap(1, 60, 50), snap(2, 40, 50)];
    render(<TelemetryPanel log={log} status="RUNNING" hasPreset onClearLog={noop} />);
    expect(screen.getByTestId('telemetry-max')).toHaveTextContent('110.00');
    expect(screen.getByTestId('telemetry-min')).toHaveTextContent('90.00');
    expect(screen.getByTestId('telemetry-avg')).toHaveTextContent('100.00');
    expect(screen.getByTestId('telemetry-drift')).toHaveTextContent('-10.00 %');
  });

  it('виводить журнал із найновішим записом зверху та унікальними key', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = [snap(0, 1, 1), snap(0.2, 1, 1), snap(0.4, 1, 1), snap(0.6, 1, 1), snap(0.8, 1, 1)];
    render(<TelemetryPanel log={log} status="RUNNING" hasPreset onClearLog={noop} />);

    const rows = rowsOf();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('0.80');
    expect(rows[4]).toHaveTextContent('0.00');
    // React повідомляє про дублікати key через console.error
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('кнопка «Очистити журнал» викликає колбек', () => {
    const onClear = vi.fn();
    render(<TelemetryPanel log={[snap(1, 1, 1)]} status="RUNNING" hasPreset onClearLog={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Очистити журнал' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('useMemo у TelemetryPanel', () => {
  it('агрегація не виконується повторно, поки посилання на log не змінилося', () => {
    const spy = vi.mocked(computeTelemetryStats);
    spy.mockClear();

    const log = [snap(0, 0, 10), snap(0.2, 3, 7)];
    const { rerender } = render(
      <TelemetryPanel log={log} status="RUNNING" hasPreset onClearLog={noop} />,
    );
    expect(spy).toHaveBeenCalledTimes(1);

    // Інший проп (status) -> рендер є, але log той самий: перерахунку немає
    rerender(<TelemetryPanel log={log} status="PAUSED" hasPreset onClearLog={noop} />);
    expect(spy).toHaveBeenCalledTimes(1);

    // Нове посилання (навіть з тим самим вмістом) -> перерахунок
    rerender(<TelemetryPanel log={[...log]} status="PAUSED" hasPreset onClearLog={noop} />);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Інтеграція з App
// ---------------------------------------------------------------------------

describe('Журнал телеметрії в App', () => {
  const startPendulum = () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
  };

  it('до вибору пресету показує порожній стан', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    expect(screen.getByText(/Оберіть пресет, щоб почати запис/)).toBeInTheDocument();
  });

  it('після вибору пресету журнал містить один стартовий запис', () => {
    startPendulum();
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByTestId('telemetry-time')).toHaveTextContent('0.00');
  });

  it('обмежує журнал 40 записами після 50 знімків', () => {
    const runFrame = installManualRaf();
    startPendulum();
    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));

    runFrame(1000);
    for (let i = 1; i <= 50; i++) runFrame(1000 + 250 * i);

    expect(rowsOf()).toHaveLength(MAX_TELEMETRY_LOG_SIZE);
  });

  it('«Очистити журнал» прибирає всі записи', () => {
    const runFrame = installManualRaf();
    startPendulum();
    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    runFrame(1000);
    runFrame(1100);
    runFrame(1250);
    expect(rowsOf().length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Очистити журнал' }));
    expect(screen.queryByTestId('telemetry-log')).not.toBeInTheDocument();
    expect(screen.getByText('Журнал порожній.')).toBeInTheDocument();
    expect(screen.getByTestId('telemetry-time')).toHaveTextContent('-');
  });

  it('«Скидання» повертає журнал до одного стартового запису', () => {
    const runFrame = installManualRaf();
    startPendulum();
    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    runFrame(1000);
    runFrame(1100);
    runFrame(1250);
    expect(rowsOf().length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Скидання' }));
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('READY');
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByTestId('telemetry-time')).toHaveTextContent('0.00');
  });
});