import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { useSession } from '../context/SessionContext';
import {
  STORAGE_KEY,
  isResearcherProfile,
  loadProfile,
  saveProfile,
  validateDisplayName,
} from '../utils/profileStorage';
import { TEST_PROFILE } from './testProfile';

// Допоміжні функції сценаріїв
const getNameInput = () => screen.getByLabelText(/дослідника/i);
const getSubmit = () => screen.getByRole('button', { name: 'Увійти' });

describe('validateDisplayName', () => {
  it('стискає кратні пробіли, обрізає краї та нормалізує апостроф', () => {
    expect(validateDisplayName('  Іван \t  Петренко  ')).toEqual({
      valid: true,
      sanitized: 'Іван Петренко',
    });
    expect(validateDisplayName("Д'Артаньян")).toEqual({ valid: true, sanitized: 'Д’Артаньян' });
  });

  it.each(['Іван Петренко', 'Mary-Jane O’Neil', 'Dr. Smith', 'Researcher 42', 'a'.repeat(40)])(
    'приймає коректне ім’я: %s',
    (name) => {
      expect(validateDisplayName(name).valid).toBe(true);
    },
  );

  it.each([
    '',
    '   ',
    'A',
    'a'.repeat(41),
    '<script>alert(1)</script>',
    'Іван"Петренко',
    'a/b',
    'a\\b',
    'Іван\u0007Петренко',
    'javascript:alert(1)',
  ])('відхиляє небезпечне або некоректне ім’я: %j', (name) => {
    expect(validateDisplayName(name).valid).toBe(false);
  });
});

describe('loadProfile: стійкість до пошкоджених даних', () => {
  it('повертає null, коли запису немає', () => {
    expect(loadProfile()).toBeNull();
  });

  it.each([
    ['битий JSON', '{not json'],
    ['літерал null', 'null'],
    ['масив замість об’єкта', '[]'],
    ['неправильні типи полів', JSON.stringify({ id: 1, displayName: 2 })],
    ['XSS в імені', JSON.stringify({ ...TEST_PROFILE, displayName: '<b>x</b>' })],
    ['невідома тема', JSON.stringify({ ...TEST_PROFILE, theme: 'blue' })],
    ['некоректна дата', JSON.stringify({ ...TEST_PROFILE, createdAt: 'вчора' })],
    ['надмірний розмір', JSON.stringify({ ...TEST_PROFILE, id: 'x'.repeat(5000) })],
  ])('повертає null: %s', (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    expect(loadProfile()).toBeNull();
  });

  it('читає валідний профіль і відкидає зайві поля', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...TEST_PROFILE, isAdmin: true }));
    expect(loadProfile()).toEqual(TEST_PROFILE);
  });

  it('не кидає виняток, якщо localStorage заблоковано', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadProfile()).toBeNull();
    expect(() => saveProfile(TEST_PROFILE)).not.toThrow();
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('type guard приймає валідний профіль', () => {
    expect(isResearcherProfile(TEST_PROFILE)).toBe(true);
  });
});

describe('Екран QuickStartAuth', () => {
  it('показується за порожнього localStorage й ставить фокус на поле імені', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /швидкий старт/i })).toBeInTheDocument();
    expect(getNameInput()).toHaveFocus();
    expect(screen.queryByTestId('workspace-header')).not.toBeInTheDocument();
  });

  it('показується також, якщо у сховищі пошкоджені дані', () => {
    window.localStorage.setItem(STORAGE_KEY, '{bad json');
    render(<App />);
    expect(screen.getByRole('heading', { name: /швидкий старт/i })).toBeInTheDocument();
  });

  it('блокує кнопку входу, поки поле порожнє або містить лише пробіли', () => {
    render(<App />);
    expect(getSubmit()).toBeDisabled();

    fireEvent.change(getNameInput(), { target: { value: '   ' } });
    expect(getSubmit()).toBeDisabled();

    fireEvent.change(getNameInput(), { target: { value: 'Ab' } });
    expect(getSubmit()).toBeEnabled();

    fireEvent.change(getNameInput(), { target: { value: '' } });
    expect(getSubmit()).toBeDisabled();
  });

  it('показує помилку для <script> і нічого не зберігає', () => {
    render(<App />);
    fireEvent.change(getNameInput(), { target: { value: '<script>' } });
    fireEvent.click(getSubmit());

    expect(screen.getByRole('alert')).toHaveTextContent(/недопустимі символи/i);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.queryByTestId('workspace-header')).not.toBeInTheDocument();
  });

  it('показує помилку для занадто короткого імені та ховає її при подальшому вводі', () => {
    render(<App />);
    fireEvent.change(getNameInput(), { target: { value: 'A' } });
    fireEvent.click(getSubmit());
    expect(screen.getByRole('alert')).toHaveTextContent(/від 2 до 40/);

    fireEvent.change(getNameInput(), { target: { value: 'Al' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('виконує вхід, зберігає профіль і показує ім’я в шапці', () => {
    render(<App />);
    fireEvent.change(getNameInput(), { target: { value: '  Іван   Петренко ' } });
    fireEvent.click(getSubmit());

    expect(screen.getByTestId('workspace-header')).toBeInTheDocument();
    expect(screen.getByTestId('session-name')).toHaveTextContent('Іван Петренко');
    expect(screen.queryByRole('heading', { name: /швидкий старт/i })).not.toBeInTheDocument();

    const stored = loadProfile();
    expect(stored?.displayName).toBe('Іван Петренко');
    expect(stored?.theme).toBe('light');
  });

  it('виконує швидкий демо-вхід', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /увійти як куценко артур/i }));
    expect(screen.getByTestId('session-name')).toHaveTextContent('Куценко Артур');
  });
});

describe('Тема оформлення', () => {
  it('перемикає клас dark на <html> і зберігає тему в профілі', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    const toggle = screen.getByRole('button', { name: 'Перемкнути тему' });
    expect(document.documentElement).not.toHaveClass('dark');

    fireEvent.click(toggle);
    expect(document.documentElement).toHaveClass('dark');
    expect(loadProfile()?.theme).toBe('dark');

    fireEvent.click(toggle);
    expect(document.documentElement).not.toHaveClass('dark');
    expect(loadProfile()?.theme).toBe('light');
  });

  it('застосовує збережену темну тему під час старту', () => {
    render(<App initialProfile={{ ...TEST_PROFILE, theme: 'dark' }} />);
    expect(document.documentElement).toHaveClass('dark');
  });
});

describe('Вихід із сесії', () => {
  it('повертає на екран входу та видаляє профіль зі сховища', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    saveProfile(TEST_PROFILE);

    fireEvent.click(screen.getByRole('button', { name: 'Вийти з профілю' }));

    expect(screen.getByRole('heading', { name: /швидкий старт/i })).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-header')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('useSession поза провайдером', () => {
  it('кидає зрозумілу помилку', () => {
    function Probe() {
      useSession();
      return null;
    }
    // React виводить помилку рендера в console.error; глушимо шум у виводі тестів
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/SessionProvider/);
    errorSpy.mockRestore();
  });
});