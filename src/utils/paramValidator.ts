import type { SimulationParams } from '../types/simulation';

/**
 * Модуль безпечної валідації фізичних параметрів.
 * Усі функції ЧИСТІ: не мають побічних ефектів і не кидають винятків.
 * Мета - не допустити NaN / Infinity / нефізичних значень до рушія та рендерера.
 */

/** Назва будь-якого параметра, що редагується користувачем. */
export type ParamKey = keyof SimulationParams;

/** Допустимий діапазон та підпис параметра (для повідомлень про помилки). */
export interface ParamBound {
  /** Мінімум (включно). */
  min: number;
  /** Максимум (включно). */
  max: number;
  /** Людиночитна назва. */
  label: string;
  /** Одиниця виміру (може бути порожньою). */
  unit: string;
}

/**
 * Межі допустимих значень. dt обмежено 0.001..0.05 с: більший крок призводить
 * до «вибуху» чисельного інтегратора, а менший - до зависання циклу кадру.
 */
export const PARAM_BOUNDS: Record<ParamKey, ParamBound> = {
  gravity: { min: 0, max: 100, label: 'Прискорення вільного падіння', unit: 'м/с²' },
  damping: { min: 0, max: 5, label: 'Коефіцієнт опору середовища', unit: '1/с' },
  timeScale: { min: 0.1, max: 5, label: 'Множник часу', unit: '' },
  dt: { min: 0.001, max: 0.05, label: 'Крок інтегрування', unit: 'с' },
  restitutionWall: { min: 0, max: 1, label: 'Коефіцієнт відновлення стін', unit: '' },
  launchAngleDeg: { min: 0, max: 90, label: 'Кут пострілу', unit: '°' },
  initialSpeed: { min: 0.1, max: 100, label: 'Початкова швидкість', unit: 'м/с' },
  pendulumLength: { min: 0.2, max: 20, label: 'Довжина підвісу', unit: 'м' },
  initialAngleDeg: { min: -85, max: 85, label: 'Початковий кут відхилення', unit: '°' },
};

/** Перелік ключів параметрів (зручно для циклів і тестів). */
export const PARAM_KEYS = Object.keys(PARAM_BOUNDS) as ParamKey[];

/** Фізично коректні початкові значення. Заморожено, щоб випадково не змінити. */
export const DEFAULT_SIMULATION_PARAMS: SimulationParams = Object.freeze({
  gravity: 9.81,
  damping: 0.02,
  timeScale: 1,
  dt: 0.016,
  restitutionWall: 0.9,
  launchAngleDeg: 45,
  initialSpeed: 15,
  pendulumLength: 2.0,
  initialAngleDeg: 30,
});

/** Повідомлення про помилки за ключами параметрів. */
export type ParamErrors = Partial<Record<ParamKey, string>>;

/** Результат валідації: дискримінований union за полем `valid`. */
export type ParamValidationResult =
  | { valid: true; params: SimulationParams; errors: Record<string, never> }
  | { valid: false; errors: ParamErrors };

/** Рядок має бути десятковим числом (опційно з експонентою); це відсікає "0x10", "Infinity", "" тощо. */
const NUMERIC_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Перетворює довільне значення на СКІНЧЕННЕ число або повертає null.
 * Приймає number та рядки ("9.81", "9,81", " 5 "). Усе інше (null, boolean,
 * об'єкти, Symbol, BigInt, порожні рядки, NaN, ±Infinity) -> null.
 */
export function parseFiniteNumber(value: unknown): number | null {
  let candidate: number;

  if (typeof value === 'number') {
    candidate = value;
  } else if (typeof value === 'string') {
    // Кома як десятковий роздільник (звична для українського вводу); лише перша кома
    const text = value.trim().replace(',', '.');
    if (!NUMERIC_PATTERN.test(text)) return null;
    candidate = Number(text);
  } else {
    // Number() не викликається для Symbol/BigInt/об'єктів, тому виняток неможливий
    return null;
  }

  // Number.isFinite відхиляє NaN, Infinity, -Infinity (на відміну від глобального isFinite)
  return Number.isFinite(candidate) ? candidate : null;
}

/** Текст діапазону для повідомлення, напр. "від 0.001 до 0.05 с". */
function describeRange(bound: ParamBound): string {
  const unit = bound.unit === '' ? '' : ` ${bound.unit}`;
  return `від ${bound.min} до ${bound.max}${unit}`;
}

/**
 * Перевіряє повний набір параметрів симуляції.
 * Повертає або санітизовані числові значення, або повідомлення про помилки
 * для КОЖНОГО некоректного поля (не лише для першого).
 */
export function validateSimulationParams(
  raw: Partial<Record<ParamKey, unknown>>,
): ParamValidationResult {
  const errors: ParamErrors = {};
  const parsed: Partial<SimulationParams> = {};

  for (const key of PARAM_KEYS) {
    const bound = PARAM_BOUNDS[key];
    const value = raw[key];

    if (value === undefined) {
      errors[key] = `${bound.label}: значення відсутнє.`;
      continue;
    }

    const num = parseFiniteNumber(value);
    if (num === null) {
      errors[key] = `${bound.label}: введіть скінченне число.`;
      continue;
    }

    if (num < bound.min || num > bound.max) {
      errors[key] = `${bound.label}: значення має бути в межах ${describeRange(bound)}.`;
      continue;
    }

    parsed[key] = num;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  // Усі ключі пройшли перевірку, тому Partial -> повний SimulationParams
  return { valid: true, params: parsed as SimulationParams, errors: {} };
}

// ---------------------------------------------------------------------------
// Параметри фізичного тіла
// ---------------------------------------------------------------------------

/** Межі параметрів тіла. Нижня межа маси > 0: ділення на нуль у a = F / m неможливе. */
export const BODY_BOUNDS = {
  mass: { min: 0.01, max: 1000 },
  radius: { min: 0.01, max: 10 },
  restitution: { min: 0, max: 1 },
} as const;

export interface BodyValidationErrors {
  mass?: string;
  radius?: string;
  restitution?: string;
}

export type BodyValidationResult =
  | { valid: true; mass: number; radius: number; restitution: number; errors: Record<string, never> }
  | { valid: false; errors: BodyValidationErrors };

/** Перевіряє одне числове поле тіла; повертає число або текст помилки. */
function checkBodyField(
  value: unknown,
  label: string,
  min: number,
  max: number,
  unit: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const num = parseFiniteNumber(value);
  if (num === null) {
    return { ok: false, error: `${label}: введіть скінченне число.` };
  }
  if (num < min || num > max) {
    return { ok: false, error: `${label}: значення має бути в межах від ${min} до ${max}${unit}.` };
  }
  return { ok: true, value: num };
}

/**
 * Захист від нульової/від'ємної маси (ділення на нуль у другому законі Ньютона),
 * від'ємного радіуса та некоректного коефіцієнта відновлення.
 */
export function validateBodyMassAndRadius(
  mass: unknown,
  radius: unknown,
  restitution: unknown,
): BodyValidationResult {
  const m = checkBodyField(mass, 'Маса', BODY_BOUNDS.mass.min, BODY_BOUNDS.mass.max, ' кг');
  const r = checkBodyField(radius, 'Радіус', BODY_BOUNDS.radius.min, BODY_BOUNDS.radius.max, ' м');
  const e = checkBodyField(
    restitution,
    'Коефіцієнт відновлення',
    BODY_BOUNDS.restitution.min,
    BODY_BOUNDS.restitution.max,
    '',
  );

  if (m.ok && r.ok && e.ok) {
    return { valid: true, mass: m.value, radius: r.value, restitution: e.value, errors: {} };
  }

  const errors: BodyValidationErrors = {};
  if (!m.ok) errors.mass = m.error;
  if (!r.ok) errors.radius = r.error;
  if (!e.ok) errors.restitution = e.error;
  return { valid: false, errors };
}