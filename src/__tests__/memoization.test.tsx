import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ParameterPanel } from '../components/ParameterPanel';
import { DEFAULT_SIMULATION_PARAMS } from '../utils/paramValidator';
import { installCanvasTestEnvironment } from './canvasMock';
import { TEST_PROFILE } from './testProfile';

/**
 * Лічильники рендерів. vi.hoisted створює об'єкт ДО підняття vi.mock.
 * Обгортка Counted теж memo, тому її лічильник збільшується лише тоді, коли
 * пропси справді змінилися: тест перевіряє стабільність пропсів, які передає
 * наш код (useCallback, незмінні посилання зі стану).
 */
const counters = vi.hoisted(() => ({ panel: 0, field: 0 }));

vi.mock('../components/ParamField', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ParamField')>();
  const { memo, createElement: h } = await import('react');
  const Counted = memo(function CountedParamField(props: ComponentProps<typeof actual.ParamField>) {
    counters.field += 1;
    return h(actual.ParamField, props);
  });
  return { ...actual, ParamField: Counted };
});

vi.mock('../components/ParameterPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ParameterPanel')>();
  const { memo, createElement: h } = await import('react');
  const Counted = memo(function CountedParameterPanel(
    props: ComponentProps<typeof actual.ParameterPanel>,
  ) {
    counters.panel += 1;
    return h(actual.ParameterPanel, props);
  });
  return { ...actual, ParameterPanel: Counted };
});

beforeEach(() => {
  counters.panel = 0;
  counters.field = 0;
});

afterEach(() => {
  installCanvasTestEnvironment();
});

/** Підміна requestAnimationFrame: кадри запускаються вручну. */
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

// Стабільні посилання поза компонентом (як useCallback у реальному батькові)
const NO_ERRORS = {};
const onUpdateParams = vi.fn();
const onRestoreDefaults = vi.fn();

function Parent() {
  const [ticks, setTicks] = useState(0);
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', onClick: () => setTicks((t) => t + 1) }, `tick ${ticks}`),
    createElement(ParameterPanel, {
      params: DEFAULT_SIMULATION_PARAMS,
      validationErrors: NO_ERRORS,
      presetId: 'PENDULUM',
      onUpdateParams,
      onRestoreDefaults,
    }),
  );
}

describe('React.memo + useCallback', () => {
  it('повторний рендер батька з тими самими пропсами не рендерить панель і поля', () => {
    render(<Parent />);
    const panelBefore = counters.panel;
    const fieldsBefore = counters.field;
    expect(panelBefore).toBeGreaterThan(0);
    expect(fieldsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /tick/ }));
    expect(screen.getByRole('button', { name: 'tick 1' })).toBeInTheDocument();

    expect(counters.panel).toBe(panelBefore);
    expect(counters.field).toBe(fieldsBefore);
  });

  it('введення в одне поле перерендерює лише це поле', () => {
    render(<Parent />);
    const fieldsBefore = counters.field;

    fireEvent.change(screen.getByLabelText(/Прискорення вільного падіння/i), {
      target: { value: '1.62' },
    });
    expect(counters.field).toBe(fieldsBefore + 1);
  });

  it('оновлення телеметрії у WorkspaceScreen не перерендерює панель параметрів', () => {
    const runFrame = installManualRaf();
    render(<App initialProfile={TEST_PROFILE} />);

    fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Параметри' }));
    const panelBefore = counters.panel;
    expect(panelBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    runFrame(1000);
    runFrame(1100);
    runFrame(1250); // 250 мс від початку вікна: надсилається телеметрія

    // Телеметрія справді оновилась і перерендерила батька...
    expect(screen.getByTestId('telemetry-time')).not.toHaveTextContent('0.00');
    // ...а панель параметрів - ні
    expect(counters.panel).toBe(panelBefore);
  });
});