import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { ErrorBanner } from '../components/ErrorBanner';
import {
  actionCreators,
  initialSimulationState,
  simulationReducer,
} from '../reducers/simulationReducer';
import type { SimulationAction, SimulationState } from '../reducers/simulationReducer';
import type { SimulationParams } from '../types/simulation';
import {
  DEFAULT_SIMULATION_PARAMS,
  PARAM_BOUNDS,
  PARAM_KEYS,
  parseFiniteNumber,
  validateBodyMassAndRadius,
  validateSimulationParams,
} from '../utils/paramValidator';
import { TEST_PROFILE } from './testProfile';

// ---------------------------------------------------------------------------
// Валідація параметрів симуляції
// ---------------------------------------------------------------------------

describe('parseFiniteNumber', () => {
  it('приймає числа та числові рядки (в т.ч. з комою)', () => {
    expect(parseFiniteNumber(5)).toBe(5);
    expect(parseFiniteNumber(' 5 ')).toBe(5);
    expect(parseFiniteNumber('9,81')).toBe(9.81);
    expect(parseFiniteNumber('1e2')).toBe(100);
  });

  it('повертає null для нескінченних і нечислових значень', () => {
    for (const bad of [NaN, Infinity, -Infinity, '', '  ', 'abc', '0x10', '1,2,3', '1e999', null, undefined]) {
      expect(parseFiniteNumber(bad)).toBeNull();
    }
  });
});

describe('validateSimulationParams', () => {
  it('приймає значення за замовчуванням', () => {
    const result = validateSimulationParams(DEFAULT_SIMULATION_PARAMS);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.params).toEqual(DEFAULT_SIMULATION_PARAMS);
      expect(result.errors).toEqual({});
    }
  });

  it('перетворює числові рядки на числа', () => {
    const result = validateSimulationParams({ ...DEFAULT_SIMULATION_PARAMS, gravity: '1,62' });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.params.gravity).toBe(1.62);
  });

  it('відхиляє NaN, Infinity, порожні та нечислові значення без винятків', () => {
    const badValues: unknown[] = [
      NaN, Infinity, -Infinity, '', '   ', 'abc', '1e999', '0x10',
      null, undefined, true, {}, [], Symbol('x'), BigInt(10),
    ];
    for (const key of ['gravity', 'dt', 'initialAngleDeg'] as const) {
      for (const bad of badValues) {
        const result = validateSimulationParams({ ...DEFAULT_SIMULATION_PARAMS, [key]: bad });
        expect(result.valid, `${key}: ${typeof bad}`).toBe(false);
        expect(result.errors[key]).toBeDefined();
      }
    }
  });

  const OUT_OF_RANGE: Array<[keyof SimulationParams, number]> = [
    ['dt', 0.0005], ['dt', 0.5], ['dt', -0.01],
    ['gravity', -1], ['gravity', 101],
    ['damping', -0.1], ['damping', 5.1],
    ['timeScale', 0.05], ['timeScale', 5.5],
    ['restitutionWall', -0.01], ['restitutionWall', 1.01],
    ['launchAngleDeg', -1], ['launchAngleDeg', 91],
    ['initialSpeed', 0], ['initialSpeed', 101],
    ['pendulumLength', 0.1], ['pendulumLength', 21],
    ['initialAngleDeg', -86], ['initialAngleDeg', 86],
  ];

  it.each(OUT_OF_RANGE)('відхиляє %s = %d (поза межами)', (key, value) => {
    const result = validateSimulationParams({ ...DEFAULT_SIMULATION_PARAMS, [key]: value });
    expect(result.valid).toBe(false);
    expect(result.errors[key]).toMatch(/межах/);
  });

  it('межі діапазонів включені (min і max допустимі)', () => {
    for (const key of PARAM_KEYS) {
      for (const edge of [PARAM_BOUNDS[key].min, PARAM_BOUNDS[key].max]) {
        const result = validateSimulationParams({ ...DEFAULT_SIMULATION_PARAMS, [key]: edge });
        expect(result.valid, `${key} = ${edge}`).toBe(true);
      }
    }
  });

  it('збирає помилки для кількох полів одразу', () => {
    const result = validateSimulationParams({ ...DEFAULT_SIMULATION_PARAMS, dt: 5, gravity: NaN });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['dt', 'gravity']);
  });

  it('вважає відсутній ключ помилкою', () => {
    const withoutDt: Partial<SimulationParams> = { ...DEFAULT_SIMULATION_PARAMS };
    delete withoutDt.dt;
    const result = validateSimulationParams(withoutDt);
    expect(result.valid).toBe(false);
    expect(result.errors.dt).toMatch(/відсутнє/);
  });
});

describe('validateBodyMassAndRadius', () => {
  it('приймає коректне тіло', () => {
    const result = validateBodyMassAndRadius(2, '0,5', 0.9);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.mass).toBe(2);
      expect(result.radius).toBe(0.5);
      expect(result.restitution).toBe(0.9);
    }
  });

  it.each([0, -1, -0.001, NaN, Infinity, '', 'abc', null])('відхиляє масу %s', (mass) => {
    const result = validateBodyMassAndRadius(mass, 1, 0.5);
    expect(result.valid).toBe(false);
    expect(result.errors.mass).toBeDefined();
  });

  it.each([0, -1, NaN, 11])('відхиляє радіус %s', (radius) => {
    const result = validateBodyMassAndRadius(1, radius, 0.5);
    expect(result.valid).toBe(false);
    expect(result.errors.radius).toBeDefined();
  });

  it.each([-0.1, 1.5, NaN])('відхиляє коефіцієнт відновлення %s', (restitution) => {
    const result = validateBodyMassAndRadius(1, 1, restitution);
    expect(result.valid).toBe(false);
    expect(result.errors.restitution).toBeDefined();
  });

  it('повертає помилки одразу для всіх некоректних полів', () => {
    const result = validateBodyMassAndRadius(0, -1, 2);
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['mass', 'radius', 'restitution']);
  });
});

// ---------------------------------------------------------------------------
// Редуктор станів
// ---------------------------------------------------------------------------

/** Послідовно застосовує дії до початкового стану. */
const run = (...actions: SimulationAction[]): SimulationState =>
  actions.reduce(simulationReducer, initialSimulationState);

const select = actionCreators.selectPreset('PENDULUM');

describe('simulationReducer: допустимі переходи', () => {
  it('починає зі стану IDLE', () => {
    expect(initialSimulationState.status).toBe('IDLE');
    expect(initialSimulationState.selectedPreset).toBeNull();
  });

  it('проходить шлях IDLE -> READY -> RUNNING -> PAUSED -> RUNNING -> READY', () => {
    let state = initialSimulationState;

    state = simulationReducer(state, select);
    expect(state.status).toBe('READY');
    expect(state.selectedPreset).toBe('PENDULUM');

    state = simulationReducer(state, actionCreators.start());
    expect(state.status).toBe('RUNNING');

    state = simulationReducer(state, actionCreators.pause());
    expect(state.status).toBe('PAUSED');

    state = simulationReducer(state, actionCreators.resume());
    expect(state.status).toBe('RUNNING');

    state = simulationReducer(state, actionCreators.reset());
    expect(state.status).toBe('READY');
    expect(state.selectedPreset).toBe('PENDULUM');
    expect(state.params).toEqual(DEFAULT_SIMULATION_PARAMS);
  });

  it('SELECT_PRESET працює з будь-якого стану й міняє пресет', () => {
    const state = run(select, actionCreators.start(), actionCreators.selectPreset('PROJECTILE'));
    expect(state.status).toBe('READY');
    expect(state.selectedPreset).toBe('PROJECTILE');
  });

  it('SELECT_PRESET виводить зі стану ERROR і очищує помилки', () => {
    const state = run(actionCreators.setError('збій'), select);
    expect(state.status).toBe('READY');
    expect(state.errorMessage).toBeNull();
    expect(state.validationErrors).toEqual({});
  });

  it('SELECT_PRESET відновлює параметри за замовчуванням, якщо поточні невалідні', () => {
    const corrupted: SimulationState = {
      ...initialSimulationState,
      params: { ...DEFAULT_SIMULATION_PARAMS, dt: NaN },
    };
    const state = simulationReducer(corrupted, select);
    expect(state.params).toEqual(DEFAULT_SIMULATION_PARAMS);
  });

  it('SELECT_PRESET зберігає валідні параметри користувача', () => {
    const state = run(actionCreators.updateParams({ gravity: 3 }), select);
    expect(state.params.gravity).toBe(3);
  });

  it('RESET без пресету повертає IDLE', () => {
    const state = run(actionCreators.setError('збій'), actionCreators.reset());
    expect(state.status).toBe('IDLE');
    expect(state.errorMessage).toBeNull();
  });

  it('SET_ERROR переводить у ERROR із повідомленням (навіть із RUNNING)', () => {
    const state = run(select, actionCreators.start(), actionCreators.setError('збій рендерера'));
    expect(state.status).toBe('ERROR');
    expect(state.errorMessage).toBe('збій рендерера');
  });
});

describe('simulationReducer: недопустимі переходи ігноруються', () => {
  const idle = initialSimulationState;
  const ready = run(select);
  const running = run(select, actionCreators.start());
  const paused = run(select, actionCreators.start(), actionCreators.pause());
  const error = run(actionCreators.setError('збій'));

  const IGNORED: Array<[string, SimulationState, SimulationAction]> = [
    ['START у IDLE', idle, actionCreators.start()],
    ['PAUSE у IDLE', idle, actionCreators.pause()],
    ['RESUME у IDLE', idle, actionCreators.resume()],
    ['PAUSE у READY', ready, actionCreators.pause()],
    ['RESUME у READY', ready, actionCreators.resume()],
    ['START у RUNNING', running, actionCreators.start()],
    ['RESUME у RUNNING', running, actionCreators.resume()],
    ['START у PAUSED', paused, actionCreators.start()],
    ['PAUSE у PAUSED', paused, actionCreators.pause()],
    ['START у ERROR', error, actionCreators.start()],
    ['PAUSE у ERROR', error, actionCreators.pause()],
    ['RESUME у ERROR', error, actionCreators.resume()],
  ];

  it.each(IGNORED)('%s', (_name, state, action) => {
    // Той самий об'єкт: React не перерендерюється
    expect(simulationReducer(state, action)).toBe(state);
  });

  it('невідома дія не змінює стан', () => {
    const unknown = { type: 'UNKNOWN' } as unknown as SimulationAction;
    expect(simulationReducer(ready, unknown)).toBe(ready);
  });
});

describe('simulationReducer: UPDATE_PARAMS', () => {
  it('застосовує валідний патч і зберігає статус', () => {
    const state = run(select, actionCreators.start(), actionCreators.updateParams({ gravity: 1.62 }));
    expect(state.status).toBe('RUNNING');
    expect(state.params.gravity).toBe(1.62);
    expect(state.validationErrors).toEqual({});
  });

  it('приймає рядкові значення з форми', () => {
    const state = run(actionCreators.updateParams({ gravity: '1,62' }));
    expect(state.params.gravity).toBe(1.62);
  });

  it('невалідний патч переводить у ERROR і не змінює params', () => {
    const state = run(select, actionCreators.updateParams({ dt: 5, gravity: NaN }));
    expect(state.status).toBe('ERROR');
    expect(state.params).toEqual(DEFAULT_SIMULATION_PARAMS);
    expect(Object.keys(state.validationErrors).sort()).toEqual(['dt', 'gravity']);
    expect(state.errorMessage).toMatch(/Некоректні параметри/);
  });

  it('виходить із ERROR у READY після виправлення параметрів', () => {
    const state = run(select, actionCreators.updateParams({ dt: 5 }), actionCreators.updateParams({ dt: 0.02 }));
    expect(state.status).toBe('READY');
    expect(state.params.dt).toBe(0.02);
    expect(state.errorMessage).toBeNull();
    expect(state.validationErrors).toEqual({});
  });

  it('виходить із ERROR в IDLE, якщо пресет ще не обрано', () => {
    const state = run(actionCreators.updateParams({ dt: 5 }), actionCreators.updateParams({ dt: 0.02 }));
    expect(state.status).toBe('IDLE');
  });

  it('виходить із ERROR у READY через RESET і відновлює значення за замовчуванням', () => {
    const state = run(select, actionCreators.updateParams({ dt: 5 }), actionCreators.reset());
    expect(state.status).toBe('READY');
    expect(state.params).toEqual(DEFAULT_SIMULATION_PARAMS);
    expect(state.errorMessage).toBeNull();
  });

  it('редуктор чистий: вхідний стан не мутується', () => {
    const state = run(select);
    const before = JSON.stringify(state);
    simulationReducer(state, actionCreators.updateParams({ dt: 99 }));
    simulationReducer(state, actionCreators.updateParams({ gravity: 3 }));
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// ErrorBanner
// ---------------------------------------------------------------------------

describe('ErrorBanner', () => {
  it('показує повідомлення з role="alert" та список деталей', () => {
    render(<ErrorBanner message="Помилка" details={['Деталь А', 'Деталь Б']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Помилка');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('не рендерить список без деталей', () => {
    render(<ErrorBanner message="Помилка" />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Інтеграція з App
// ---------------------------------------------------------------------------

describe('Інтеграція автомата з App', () => {
  const status = () => screen.getByTestId('simulation-status');

  it('проходить IDLE -> READY -> RUNNING -> PAUSED -> RUNNING -> READY через кнопки', () => {
    render(<App initialProfile={TEST_PROFILE} />);

    // IDLE: кнопки керування неактивні, помилки немає
    expect(status()).toHaveTextContent('IDLE');
    expect(screen.getByRole('button', { name: 'Старт' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скидання' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Вибір пресету: READY, "Старт" доступна
    fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
    expect(status()).toHaveTextContent('READY');
    expect(screen.getByTestId('selected-preset')).toHaveTextContent('Гармонічний маятник');
    expect(screen.getByRole('button', { name: 'Старт' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeDisabled();

    // Старт: RUNNING
    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    expect(status()).toHaveTextContent('RUNNING');
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Старт' })).toBeDisabled();

    // Пауза: PAUSED, перша кнопка стає "Продовжити"
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(status()).toHaveTextContent('PAUSED');
    expect(screen.getByRole('button', { name: 'Продовжити' })).toBeEnabled();

    // Продовжити: RUNNING
    fireEvent.click(screen.getByRole('button', { name: 'Продовжити' }));
    expect(status()).toHaveTextContent('RUNNING');

    // Скидання: READY
    fireEvent.click(screen.getByRole('button', { name: 'Скидання' }));
    expect(status()).toHaveTextContent('READY');
    expect(screen.getByRole('button', { name: 'Старт' })).toBeEnabled();
  });

  it('вибір іншого пресету під час симуляції повертає READY', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Старт' }));
    expect(status()).toHaveTextContent('RUNNING');

    fireEvent.click(screen.getByRole('button', { name: /пружні зіткнення/i }));
    expect(status()).toHaveTextContent('READY');
    expect(screen.getByTestId('selected-preset')).toHaveTextContent('Пружні зіткнення кульок');
  });
});