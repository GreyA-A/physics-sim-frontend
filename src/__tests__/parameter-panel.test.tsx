import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ParamField } from '../components/ParamField';
import { ParameterPanel } from '../components/ParameterPanel';
import { isInteractiveTarget } from '../hooks/useWorkspaceHotkeys';
import { DEFAULT_SIMULATION_PARAMS } from '../utils/paramValidator';
import { TEST_PROFILE } from './testProfile';

// ---------------------------------------------------------------------------
// Допоміжні функції
// ---------------------------------------------------------------------------

/** Поле вводу за підписом (з перевіркою типу елемента). */
function getInput(label: RegExp): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error('Очікувався <input>');
  return element;
}

const status = () => screen.getByTestId('simulation-status');

/** Рендерить панель окремо з шпигунами-колбеками. */
function renderPanel(overrides: Partial<ComponentProps<typeof ParameterPanel>> = {}) {
  const onUpdateParams = vi.fn();
  const onRestoreDefaults = vi.fn();
  render(
    <ParameterPanel
      params={DEFAULT_SIMULATION_PARAMS}
      validationErrors={{}}
      presetId="PENDULUM"
      onUpdateParams={onUpdateParams}
      onRestoreDefaults={onRestoreDefaults}
      {...overrides}
    />,
  );
  return { onUpdateParams, onRestoreDefaults };
}

/** Входить у робочу область, обирає пресет і відкриває вкладку "Параметри". */
function openParams(presetName: RegExp) {
  render(<App initialProfile={TEST_PROFILE} />);
  fireEvent.click(screen.getByRole('button', { name: presetName }));
  fireEvent.click(screen.getByRole('tab', { name: 'Параметри' }));
}

const BALLISTIC = /балістичний рух/i;
const PENDULUM = /гармонічний маятник/i;

// ---------------------------------------------------------------------------
// ParamField
// ---------------------------------------------------------------------------

describe('ParamField', () => {
  const baseProps = {
    name: 'gravity' as const,
    label: 'Прискорення вільного падіння',
    unit: 'м/с²',
    min: 0,
    max: 100,
    step: 0.1,
    value: '9.81',
    onChange: vi.fn(),
  };

  it('показує підпис, значення та підказку діапазону', () => {
    render(<ParamField {...baseProps} />);
    expect(getInput(/Прискорення вільного падіння/i).value).toBe('9.81');
    expect(screen.getByText('Допустимо: від 0 до 100 м/с²')).toBeInTheDocument();
    expect(getInput(/Прискорення/i)).toHaveAttribute('aria-invalid', 'false');
  });

  it('без одиниці виміру не додає зайвих дужок', () => {
    render(<ParamField {...baseProps} name="timeScale" label="Множник часу" unit="" />);
    expect(screen.getByText('Допустимо: від 0 до 100')).toBeInTheDocument();
  });

  it('з помилкою підсвічує поле й показує текст помилки', () => {
    render(<ParamField {...baseProps} error="Значення поза межами" />);
    const input = getInput(/Прискорення/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Значення поза межами')).toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')).toContain('param-gravity-error');
  });
});

// ---------------------------------------------------------------------------
// ParameterPanel (окремо)
// ---------------------------------------------------------------------------

describe('ParameterPanel', () => {
  it('для маятника показує спільні поля та його специфічні параметри', () => {
    renderPanel({ presetId: 'PENDULUM' });
    expect(getInput(/Прискорення вільного падіння/i)).toBeInTheDocument();
    expect(getInput(/Крок інтегрування/i)).toBeInTheDocument();
    expect(getInput(/Довжина підвісу/i)).toBeInTheDocument();
    expect(getInput(/Початковий кут відхилення/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Кут пострілу/i)).not.toBeInTheDocument();
  });

  it('для балістики та зіткнень показує відповідні специфічні параметри', () => {
    const { unmount } = render(
      <ParameterPanel
        params={DEFAULT_SIMULATION_PARAMS}
        validationErrors={{}}
        presetId="PROJECTILE"
        onUpdateParams={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
    );
    expect(getInput(/Кут пострілу/i)).toBeInTheDocument();
    expect(getInput(/Початкова швидкість/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Довжина підвісу/i)).not.toBeInTheDocument();
    unmount();

    renderPanel({ presetId: 'COLLISIONS' });
    expect(getInput(/Початкова швидкість/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Кут пострілу/i)).not.toBeInTheDocument();
  });

  it('без пресету показує всі специфічні параметри', () => {
    renderPanel({ presetId: null });
    expect(getInput(/Кут пострілу/i)).toBeInTheDocument();
    expect(getInput(/Довжина підвісу/i)).toBeInTheDocument();
  });

  it('заповнює поля значеннями params', () => {
    renderPanel();
    expect(getInput(/Прискорення/i).value).toBe('9.81');
    expect(getInput(/Крок інтегрування/i).value).toBe('0.016');
  });

  it('передає в onUpdateParams сире значення за ключем [e.target.name]', () => {
    const { onUpdateParams } = renderPanel();
    const gravity = getInput(/Прискорення/i);

    fireEvent.change(gravity, { target: { value: '1.62' } });
    expect(onUpdateParams).toHaveBeenLastCalledWith({ gravity: '1.62' });
    expect(gravity.value).toBe('1.62');

    // Нечислове значення теж доходить до редуктора: валідація - його відповідальність
    fireEvent.change(gravity, { target: { value: 'abc' } });
    expect(onUpdateParams).toHaveBeenLastCalledWith({ gravity: 'abc' });
    expect(gravity.value).toBe('abc');
  });

  it('підсвічує лише ті поля, для яких є помилка', () => {
    renderPanel({ validationErrors: { dt: 'Крок інтегрування: поза межами.' } });
    expect(getInput(/Крок інтегрування/i)).toHaveAttribute('aria-invalid', 'true');
    expect(getInput(/Прискорення/i)).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByText('Крок інтегрування: поза межами.')).toBeInTheDocument();
  });

  it('кнопка «Відновити типові значення» викликає onRestoreDefaults', () => {
    const { onRestoreDefaults } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /відновити типові значення/i }));
    expect(onRestoreDefaults).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Наскрізна валідація з інтерфейсу
// ---------------------------------------------------------------------------

describe('Вкладка «Параметри» в App', () => {
  it('валідна зміна не змінює статус і зберігається між вкладками', () => {
    openParams(BALLISTIC);
    expect(status()).toHaveTextContent('READY');

    fireEvent.change(getInput(/Прискорення/i), { target: { value: '1.62' } });
    expect(status()).toHaveTextContent('READY');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Пресети' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Параметри' }));
    expect(getInput(/Прискорення/i).value).toBe('1.62');
  });

  it('dt = 5 переводить у ERROR, показує ErrorBanner; виправлення повертає READY', () => {
    openParams(BALLISTIC);

    fireEvent.change(getInput(/Крок інтегрування/i), { target: { value: '5' } });
    expect(status()).toHaveTextContent('ERROR');
    expect(screen.getByRole('alert')).toHaveTextContent(/Некоректні параметри/);
    expect(getInput(/Крок інтегрування/i)).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(getInput(/Крок інтегрування/i), { target: { value: '0.016' } });
    expect(status()).toHaveTextContent('READY');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getInput(/Крок інтегрування/i)).toHaveAttribute('aria-invalid', 'false');
  });

  it('нечислове значення gravity = abc переводить у ERROR', () => {
    openParams(BALLISTIC);
    fireEvent.change(getInput(/Прискорення/i), { target: { value: 'abc' } });
    expect(status()).toHaveTextContent('ERROR');
    expect(getInput(/Прискорення/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('у стані ERROR кнопка «Старт» недоступна', () => {
    openParams(BALLISTIC);
    fireEvent.change(getInput(/Крок інтегрування/i), { target: { value: '5' } });
    expect(screen.getByRole('button', { name: 'Старт' })).toBeDisabled();
  });

  it('«Відновити типові значення» виводить із ERROR і повертає початкові значення', () => {
    openParams(BALLISTIC);
    fireEvent.change(getInput(/Прискорення/i), { target: { value: 'abc' } });
    expect(status()).toHaveTextContent('ERROR');

    fireEvent.click(screen.getByRole('button', { name: /відновити типові значення/i }));
    expect(status()).toHaveTextContent('READY');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getInput(/Прискорення/i).value).toBe('9.81');
  });

  it('«Скидання» повертає поля до значень за замовчуванням', () => {
    openParams(BALLISTIC);
    fireEvent.change(getInput(/Прискорення/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скидання' }));
    expect(getInput(/Прискорення/i).value).toBe('9.81');
  });

  it('показує підказку про гарячі клавіші після вибору пресету', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    expect(screen.queryByTestId('hotkeys-hint')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: PENDULUM }));
    expect(screen.getByTestId('hotkeys-hint')).toHaveTextContent(/Space/);
  });
});

// ---------------------------------------------------------------------------
// Гарячі клавіші
// ---------------------------------------------------------------------------

describe('Гарячі клавіші', () => {
  const press = (code: string, target: Element = document.body, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(target, { code, ...init });

  it('Space проходить READY -> RUNNING -> PAUSED -> RUNNING', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: PENDULUM }));
    expect(status()).toHaveTextContent('READY');

    press('Space');
    expect(status()).toHaveTextContent('RUNNING');
    press('Space');
    expect(status()).toHaveTextContent('PAUSED');
    press('Space');
    expect(status()).toHaveTextContent('RUNNING');
  });

  it('R скидає симуляцію в READY', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: PENDULUM }));
    press('Space');
    expect(status()).toHaveTextContent('RUNNING');

    press('KeyR');
    expect(status()).toHaveTextContent('READY');
  });

  it('у стані IDLE гарячі клавіші нічого не роблять', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    press('Space');
    press('KeyR');
    expect(status()).toHaveTextContent('IDLE');
  });

  it('ігнорує Space і R, коли фокус у полі вводу', () => {
    openParams(PENDULUM);
    const gravity = getInput(/Прискорення/i);

    press('Space', gravity);
    expect(status()).toHaveTextContent('READY');

    press('Space'); // з body працює
    expect(status()).toHaveTextContent('RUNNING');

    press('KeyR', gravity);
    expect(status()).toHaveTextContent('RUNNING');

    press('KeyR');
    expect(status()).toHaveTextContent('READY');
  });

  it('ігнорує Space на кнопці (щоб не було подвійного спрацьовування)', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: PENDULUM }));
    press('Space', screen.getByRole('button', { name: 'Старт' }));
    expect(status()).toHaveTextContent('READY');
  });

  it('ігнорує комбінації з Ctrl та автоповтор', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: PENDULUM }));
    press('Space');
    expect(status()).toHaveTextContent('RUNNING');

    press('KeyR', document.body, { ctrlKey: true });
    expect(status()).toHaveTextContent('RUNNING');

    press('Space', document.body, { repeat: true });
    expect(status()).toHaveTextContent('RUNNING');
  });

  it('у стані ERROR Space не запускає симуляцію', () => {
    openParams(BALLISTIC);
    fireEvent.change(getInput(/Крок інтегрування/i), { target: { value: '5' } });
    press('Space');
    expect(status()).toHaveTextContent('ERROR');
  });
});

describe('isInteractiveTarget', () => {
  it('розпізнає елементи вводу та кнопки', () => {
    for (const tag of ['input', 'textarea', 'select', 'button']) {
      expect(isInteractiveTarget(document.createElement(tag))).toBe(true);
    }
  });

  it('звичайні елементи та window не є інтерактивними', () => {
    expect(isInteractiveTarget(document.createElement('div'))).toBe(false);
    expect(isInteractiveTarget(document.body)).toBe(false);
    expect(isInteractiveTarget(window)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });

  it('розпізнає contenteditable (jsdom не реалізує isContentEditable, тому задаємо вручну)', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isInteractiveTarget(div)).toBe(true);
  });
});