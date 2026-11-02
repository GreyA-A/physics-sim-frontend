import type { Body, ThemeMode, Vec2 } from '../types/simulation';
import { WORLD_BOUNDS } from './physicsEngine';
import type { WorldState } from './physicsEngine';
import { vecAdd, vecClamp, vecScale } from './vec2';

/**
 * Чистий модуль 2D-відмальовування: єдине місце, яке знає про CanvasRenderingContext2D.
 * Не містить React, таймерів і стану: лише (ctx, world, options, розміри) -> пікселі.
 * Усі координати контексту задано в CSS-пікселях; масштаб за devicePixelRatio
 * виставляє компонент через ctx.setTransform.
 */

// ---------------------------------------------------------------------------
// Опції та палітра
// ---------------------------------------------------------------------------

/** Перемикачі візуальних шарів. */
export interface LayerOptions {
  showGrid: boolean;
  showVelocityVectors: boolean;
  showForceVectors: boolean;
  showTrails: boolean;
}

/** Повні опції кадру: шари + тема. */
export interface RenderOptions extends LayerOptions {
  theme: ThemeMode;
}

export interface ThemePalette {
  background: string;
  gridLine: string;
  axisText: string;
  bodyLabel: string;
  outline: string;
  velocity: string;
  force: string;
}

/** Палітри світлої та темної теми (кольори з контрастом для обох фонів). */
export const THEME_PALETTE: Record<ThemeMode, ThemePalette> = {
  light: {
    background: '#f8fafc',
    gridLine: 'rgba(148, 163, 184, 0.35)',
    axisText: '#64748b',
    bodyLabel: '#0f172a',
    outline: '#475569',
    velocity: '#0891b2',
    force: '#ea580c',
  },
  dark: {
    background: '#0f172a',
    gridLine: 'rgba(100, 116, 139, 0.35)',
    axisText: '#94a3b8',
    bodyLabel: '#e2e8f0',
    outline: '#94a3b8',
    velocity: '#22d3ee',
    force: '#fb923c',
  },
};

// ---------------------------------------------------------------------------
// Константи візуалізації
// ---------------------------------------------------------------------------

/** Довжина стрілки швидкості: метрів на 1 м/с. */
const VELOCITY_SCALE = 0.25;
/** Довжина стрілки сили: метрів на 1 Н. */
const FORCE_SCALE = 0.1;
/** Верхня межа довжини стрілки, м (щоб вектор не виходив за межі полотна). */
const MAX_VECTOR_LENGTH_M = 5;
/** Мінімальний радіус тіла на екрані, px (щоб мале тіло не зникало). */
const MIN_BODY_RADIUS_PX = 2;
/** Якщо на 1 м припадає менше пікселів, сітку розріджують до кроку 2 м. */
const DENSE_GRID_THRESHOLD_PX_PER_M = 32;

// ---------------------------------------------------------------------------
// Координати
// ---------------------------------------------------------------------------

/**
 * Метри -> пікселі. У світі y = 0 внизу, а в Canvas вісь OY спрямована вниз,
 * тому вертикальна координата віддзеркалюється.
 */
export function worldToCanvas(pos: Vec2, canvasWidth: number, canvasHeight: number): Vec2 {
  return {
    x: (pos.x / WORLD_BOUNDS.width) * canvasWidth,
    y: canvasHeight - (pos.y / WORLD_BOUNDS.height) * canvasHeight,
  };
}

/** Крок сітки, м: 1 для широких полотен, 2 для вузьких (мобільні). */
export function getGridStepMeters(cssWidth: number): number {
  return cssWidth / WORLD_BOUNDS.width >= DENSE_GRID_THRESHOLD_PX_PER_M ? 1 : 2;
}

function isFiniteVec(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

// ---------------------------------------------------------------------------
// Примітиви
// ---------------------------------------------------------------------------

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: ThemePalette,
): void {
  const step = getGridStepMeters(w);
  ctx.save();

  // Усі лінії сітки - один шлях і один виклик stroke (економія викликів на кадр)
  ctx.strokeStyle = palette.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WORLD_BOUNDS.width; x += step) {
    const p = worldToCanvas({ x, y: 0 }, w, h);
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, h);
  }
  for (let y = 0; y <= WORLD_BOUNDS.height; y += step) {
    const p = worldToCanvas({ x: 0, y }, w, h);
    ctx.moveTo(0, p.y);
    ctx.lineTo(w, p.y);
  }
  ctx.stroke();

  // Підписи осей кожні 2 м
  ctx.fillStyle = palette.axisText;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (let x = 2; x < WORLD_BOUNDS.width; x += 2) {
    const p = worldToCanvas({ x, y: 0 }, w, h);
    ctx.fillText(String(x), p.x + 2, h - 2);
  }
  ctx.textBaseline = 'top';
  for (let y = 2; y <= WORLD_BOUNDS.height; y += 2) {
    const p = worldToCanvas({ x: 0, y }, w, h);
    ctx.fillText(String(y), 2, p.y + 2);
  }
  // Назви осей з одиницями виміру
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('x, м', w - 4, h - 14);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('y, м', 22, 2);

  ctx.restore();
}

/** Перекладина, точка підвісу та нитка маятника. */
function drawPendulumRig(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  w: number,
  h: number,
  palette: ThemePalette,
): void {
  const anchor = worldToCanvas(world.pendulumAnchor, w, h);
  const scale = w / WORLD_BOUNDS.width;

  ctx.save();
  ctx.strokeStyle = palette.outline;
  ctx.fillStyle = palette.outline;
  ctx.lineWidth = 2;

  // Перекладина над точкою підвісу
  ctx.beginPath();
  ctx.moveTo(anchor.x - 0.6 * scale, anchor.y);
  ctx.lineTo(anchor.x + 0.6 * scale, anchor.y);
  ctx.stroke();

  // Нитка до центра вантажу
  const bob = world.bodies[0];
  if (bob && isFiniteVec(bob.position)) {
    const bobPx = worldToCanvas(bob.position, w, h);
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(bobPx.x, bobPx.y);
    ctx.stroke();
  }

  // Точка підвісу
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Слід траєкторії напівпрозорою лінією. */
function drawTrail(ctx: CanvasRenderingContext2D, body: Body, w: number, h: number): void {
  const points = body.trail.filter(isFiniteVec);
  const first = points[0];
  if (!first || points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = body.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const start = worldToCanvas(first, w, h);
  ctx.moveTo(start.x, start.y);
  for (const point of points.slice(1)) {
    const p = worldToCanvas(point, w, h);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  body: Body,
  w: number,
  h: number,
  palette: ThemePalette,
): void {
  const center = worldToCanvas(body.position, w, h);
  const radiusPx = Math.max(MIN_BODY_RADIUS_PX, body.radius * (w / WORLD_BOUNDS.width));

  ctx.save();
  ctx.fillStyle = body.color;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.bodyLabel;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(body.label, center.x, center.y - radiusPx - 4);
  ctx.restore();
}

/** Лінія зі стрілкою (піксельні координати). Дуже короткі вектори не малюються. */
function drawArrow(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, color: string): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 2)) return;

  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(10, length * 0.4);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  // Наконечник: трикутник, повернутий уздовж напрямку вектора
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - ux * head - uy * head * 0.5, to.y - uy * head + ux * head * 0.5);
  ctx.lineTo(to.x - ux * head + uy * head * 0.5, to.y - uy * head - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Вектор у метрах світу, прикладений до центра тіла. Нескінченні вектори дають нульову стрілку. */
function drawVector(
  ctx: CanvasRenderingContext2D,
  body: Body,
  vectorMeters: Vec2,
  color: string,
  w: number,
  h: number,
): void {
  const tip = vecAdd(body.position, vecClamp(vectorMeters, MAX_VECTOR_LENGTH_M));
  drawArrow(ctx, worldToCanvas(body.position, w, h), worldToCanvas(tip, w, h), color);
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

/**
 * Малює один кадр: фон -> сітка -> маятник -> сліди -> тіла -> вектори.
 * Тіла з нескінченними координатами пропускаються, щоб один збій не ламав усю сцену.
 */
export function renderWorldToCanvas(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  options: RenderOptions,
  cssWidth: number,
  cssHeight: number,
): void {
  if (!(cssWidth > 0) || !(cssHeight > 0)) return;

  const palette = THEME_PALETTE[options.theme];
  const bodies = world.bodies.filter((b) => isFiniteVec(b.position));

  ctx.save();

  // Очищення та фон за темою
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  if (options.showGrid) drawGrid(ctx, cssWidth, cssHeight, palette);
  if (world.presetId === 'PENDULUM') drawPendulumRig(ctx, world, cssWidth, cssHeight, palette);

  if (options.showTrails) {
    for (const body of bodies) drawTrail(ctx, body, cssWidth, cssHeight);
  }
  for (const body of bodies) drawBody(ctx, body, cssWidth, cssHeight, palette);

  if (options.showVelocityVectors) {
    for (const body of bodies) {
      drawVector(ctx, body, vecScale(body.velocity, VELOCITY_SCALE), palette.velocity, cssWidth, cssHeight);
    }
  }
  if (options.showForceVectors) {
    for (const body of bodies) {
      drawVector(ctx, body, vecScale(body.force, FORCE_SCALE), palette.force, cssWidth, cssHeight);
    }
  }

  ctx.restore();
}