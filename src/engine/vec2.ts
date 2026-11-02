import type { Vec2 } from '../types/simulation';

/**
 * Векторна математика для двовимірної фізики.
 * Усі функції ЧИСТІ: не змінюють аргументи, завжди повертають НОВИЙ об'єкт.
 */

/** Сума векторів a + b. */
export function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Різниця векторів a - b. */
export function vecSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Множення вектора на скаляр. */
export function vecScale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

/** Скалярний добуток a · b. */
export function vecDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Довжина (модуль) вектора. Math.hypot стійкий до переповнення проміжних квадратів. */
export function vecLength(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Відстань між двома точками. */
export function vecDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Одиничний вектор того ж напрямку. Для нульового вектора повертає (0, 0), а не NaN. */
export function vecNormalize(v: Vec2): Vec2 {
  const length = vecLength(v);
  if (length === 0 || !Number.isFinite(length)) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / length, y: v.y / length };
}

/**
 * Обмежує ДОВЖИНУ вектора значенням maxLength, зберігаючи напрямок.
 * Нескінченний вектор або некоректний maxLength (<= 0, NaN, Infinity) -> нульовий вектор.
 */
export function vecClamp(v: Vec2, maxLength: number): Vec2 {
  const length = vecLength(v);
  if (!Number.isFinite(length) || !Number.isFinite(maxLength) || maxLength <= 0) {
    return { x: 0, y: 0 };
  }
  if (length <= maxLength) {
    return { x: v.x, y: v.y };
  }
  return vecScale(v, maxLength / length);
}

/** Обмеження скаляра діапазоном [min, max]. */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}