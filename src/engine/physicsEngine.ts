import type { Body, PresetId, SimulationParams, Vec2 } from '../types/simulation';
import { vecAdd, vecDistance, vecDot, vecNormalize, vecScale, vecSub } from './vec2';

/**
 * Математичне ядро симулятора. Чисте: без React, DOM та глобального стану.
 * Система координат (SI): x вправо, y ВГОРУ, y = 0 - підлога. Для Canvas (Issue #6)
 * достатньо перевернути вісь y при перетворенні метрів у пікселі.
 * Інтегрування: напівнеявний (симплектичний) метод Ейлера:
 *   v(n+1) = v(n) + a(n) * dt;  x(n+1) = x(n) + v(n+1) * dt.
 */

// ---------------------------------------------------------------------------
// Константи
// ---------------------------------------------------------------------------

/** Розміри світу, м: x in [0, 20], y in [0, 12]. */
export const WORLD_BOUNDS = { width: 20, height: 12 } as const;

/** Точка підвісу маятника, м. */
export const PENDULUM_ANCHOR: Vec2 = Object.freeze({ x: 10, y: 10 });

/** Максимальна довжина сліду траєкторії (кільцевий буфер). */
export const MAX_TRAIL_LENGTH = 120;

/** Верхня межа часу кадру, с: захист від «спіралі смерті» після неактивної вкладки. */
export const MAX_FRAME_DELTA_SEC = 0.1;

/** Запобіжник: максимум кроків інтегрування за один виклик advanceWorldByFrameDelta. */
export const MAX_STEPS_PER_ADVANCE = 1000;

const DEG_TO_RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Типи
// ---------------------------------------------------------------------------

/** Повний стан фізичного світу. Кожен крок повертає НОВИЙ об'єкт. */
export interface WorldState {
  presetId: PresetId;
  bodies: Body[];
  /** Симуляційний час, с. */
  time: number;
  /** Залишок часу між кадрами для фіксованого кроку dt, с. */
  accumulator: number;
  /** Точка підвісу (використовується в PENDULUM). */
  pendulumAnchor: Vec2;
  /** Кут відхилення від вертикалі, рад (PENDULUM). */
  pendulumAngleRad: number;
  /** Кутова швидкість, рад/с (PENDULUM). */
  pendulumAngularVel: number;
}

export interface SystemEnergy {
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
}

/** Поля, які потрібні для створення тіла; решта (force, trail) ініціалізується тут. */
export type BodyInit = Pick<
  Body,
  'id' | 'label' | 'mass' | 'radius' | 'restitution' | 'color' | 'position' | 'velocity'
>;

// ---------------------------------------------------------------------------
// Допоміжні функції
// ---------------------------------------------------------------------------

/** Створює тіло з нульовою силою та слідом із початкової точки. Вхідні вектори копіюються. */
export function makeBody(init: BodyInit): Body {
  return {
    ...init,
    position: { ...init.position },
    velocity: { ...init.velocity },
    force: { x: 0, y: 0 },
    trail: [{ ...init.position }],
  };
}

/** Копія тіла (вектори копіюються; trail не мутується, а замінюється новим масивом). */
function cloneBody(body: Body): Body {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    force: { ...body.force },
  };
}

/** Додає точку в слід і обрізає його до MAX_TRAIL_LENGTH (кільцевий буфер). */
function appendTrail(trail: Vec2[], point: Vec2): Vec2[] {
  return [...trail, { x: point.x, y: point.y }].slice(-MAX_TRAIL_LENGTH);
}

/** Сила для вільного тіла: тяжіння (0, -m g) + лінійний опір -c m v. */
function particleForce(body: Body, params: SimulationParams): Vec2 {
  const gravity: Vec2 = { x: 0, y: -body.mass * params.gravity };
  const drag = vecScale(body.velocity, -params.damping * body.mass);
  return vecAdd(gravity, drag);
}

/** Параметри, без яких крок виконувати небезпечно (NaN, dt <= 0, L <= 0). */
function hasValidStepParams(params: SimulationParams): boolean {
  return (
    Number.isFinite(params.dt) &&
    params.dt > 0 &&
    Number.isFinite(params.pendulumLength) &&
    params.pendulumLength > 0 &&
    Number.isFinite(params.gravity) &&
    Number.isFinite(params.damping)
  );
}

// ---------------------------------------------------------------------------
// Маятник: узагальнені координати theta, omega
// ---------------------------------------------------------------------------

/** Кутове прискорення: alpha = -(g / L) sin(theta) - gamma * omega. */
function pendulumAngularAcceleration(theta: number, omega: number, params: SimulationParams): number {
  return -(params.gravity / params.pendulumLength) * Math.sin(theta) - params.damping * omega;
}

/** Декартові координати та швидкість вантажу за (theta, omega). */
function pendulumKinematics(
  anchor: Vec2,
  theta: number,
  omega: number,
  length: number,
): { position: Vec2; velocity: Vec2 } {
  return {
    position: { x: anchor.x + length * Math.sin(theta), y: anchor.y - length * Math.cos(theta) },
    velocity: { x: length * omega * Math.cos(theta), y: length * omega * Math.sin(theta) },
  };
}

/**
 * Рівнодійна сили тяжіння та натягу нитки (для вектора сили на Canvas):
 * F = m * ( L*alpha * t + L*omega^2 * c ), де t = (cos, sin) - дотична,
 * c = (-sin, cos) - напрямок до точки підвісу (доцентровий).
 */
function pendulumResultantForce(
  mass: number,
  theta: number,
  omega: number,
  params: SimulationParams,
): Vec2 {
  const length = params.pendulumLength;
  const alpha = pendulumAngularAcceleration(theta, omega, params);
  const tangent: Vec2 = { x: Math.cos(theta), y: Math.sin(theta) };
  const towardAnchor: Vec2 = { x: -Math.sin(theta), y: Math.cos(theta) };
  const acceleration = vecAdd(
    vecScale(tangent, length * alpha),
    vecScale(towardAnchor, length * omega * omega),
  );
  return vecScale(acceleration, mass);
}

// ---------------------------------------------------------------------------
// Ініціалізація сцени
// ---------------------------------------------------------------------------

/** Створює початковий стан світу для обраного пресету. */
export function createInitialWorld(presetId: PresetId, params: SimulationParams): WorldState {
  const base = {
    time: 0,
    accumulator: 0,
    pendulumAnchor: { ...PENDULUM_ANCHOR },
    pendulumAngleRad: 0,
    pendulumAngularVel: 0,
  };

  switch (presetId) {
    case 'PROJECTILE': {
      const angle = params.launchAngleDeg * DEG_TO_RAD;
      const projectile = makeBody({
        id: 'projectile',
        label: 'Снаряд',
        mass: 1,
        radius: 0.3,
        restitution: 0.8,
        color: '#0ea5e9',
        position: { x: 1.5, y: 1.0 },
        velocity: {
          x: params.initialSpeed * Math.cos(angle),
          y: params.initialSpeed * Math.sin(angle),
        },
      });
      return {
        ...base,
        presetId,
        bodies: [{ ...projectile, force: particleForce(projectile, params) }],
      };
    }

    case 'COLLISIONS': {
      const s = params.initialSpeed;
      // Три кульки різної маси та радіуса; швидкості пропорційні initialSpeed
      const balls = [
        makeBody({
          id: 'ball-1', label: 'Куля 1', mass: 1, radius: 0.5, restitution: 1, color: '#ef4444',
          position: { x: 4, y: 6 }, velocity: { x: s, y: 0.15 * s },
        }),
        makeBody({
          id: 'ball-2', label: 'Куля 2', mass: 2, radius: 0.7, restitution: 1, color: '#22c55e',
          position: { x: 10, y: 6.5 }, velocity: { x: -0.5 * s, y: 0 },
        }),
        makeBody({
          id: 'ball-3', label: 'Куля 3', mass: 0.5, radius: 0.4, restitution: 1, color: '#3b82f6',
          position: { x: 16, y: 4 }, velocity: { x: -0.8 * s, y: 0.3 * s },
        }),
      ];
      return {
        ...base,
        presetId,
        bodies: balls.map((ball) => ({ ...ball, force: particleForce(ball, params) })),
      };
    }

    case 'PENDULUM': {
      const theta0 = params.initialAngleDeg * DEG_TO_RAD;
      const { position, velocity } = pendulumKinematics(
        base.pendulumAnchor,
        theta0,
        0,
        params.pendulumLength,
      );
      const bob = makeBody({
        id: 'bob',
        label: 'Вантаж',
        mass: 1,
        radius: 0.3,
        restitution: 1,
        color: '#a855f7',
        position,
        velocity,
      });
      return {
        ...base,
        presetId,
        pendulumAngleRad: theta0,
        pendulumAngularVel: 0,
        bodies: [{ ...bob, force: pendulumResultantForce(bob.mass, theta0, 0, params) }],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Зіткнення та стіни
// ---------------------------------------------------------------------------

/** Відбиття від чотирьох стін світу з позиційною корекцією (тіло не провалюється). */
function resolveWalls(body: Body, wallRestitution: number): void {
  const r = body.radius;
  let { x, y } = body.position;
  let { x: vx, y: vy } = body.velocity;

  if (x < r) {
    x = r;
    if (vx < 0) vx = -wallRestitution * vx;
  } else if (x > WORLD_BOUNDS.width - r) {
    x = WORLD_BOUNDS.width - r;
    if (vx > 0) vx = -wallRestitution * vx;
  }

  if (y < r) {
    y = r;
    if (vy < 0) vy = -wallRestitution * vy;
  } else if (y > WORLD_BOUNDS.height - r) {
    y = WORLD_BOUNDS.height - r;
    if (vy > 0) vy = -wallRestitution * vy;
  }

  body.position = { x, y };
  body.velocity = { x: vx, y: vy };
}

/**
 * Попарне розв'язання зіткнень кіл (мутує ЛОКАЛЬНІ копії тіл, створені кроком).
 * Імпульс: j = -(1 + e) (v_rel · n) / (1/m1 + 1/m2); корекція позицій - пропорційно 1/m.
 */
function resolveBodyCollisions(bodies: Body[]): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let k = i + 1; k < bodies.length; k++) {
      const a = bodies[i];
      const b = bodies[k];
      if (!a || !b || !(a.mass > 0) || !(b.mass > 0)) continue;

      const minDist = a.radius + b.radius;
      const dist = vecDistance(a.position, b.position);
      if (dist >= minDist) continue;

      // Нормаль від a до b; для збіжних центрів - довільна (1, 0), щоб уникнути NaN
      const normal: Vec2 =
        dist > 1e-12 ? vecNormalize(vecSub(b.position, a.position)) : { x: 1, y: 0 };

      const invA = 1 / a.mass;
      const invB = 1 / b.mass;
      const invSum = invA + invB;

      // Позиційне розштовхування: легше тіло зміщується більше
      const overlap = minDist - dist;
      a.position = vecSub(a.position, vecScale(normal, (overlap * invA) / invSum));
      b.position = vecAdd(b.position, vecScale(normal, (overlap * invB) / invSum));

      // Імпульс лише якщо тіла зближуються (v_rel · n < 0)
      const normalSpeed = vecDot(vecSub(b.velocity, a.velocity), normal);
      if (normalSpeed >= 0) continue;

      const e = Math.min(a.restitution, b.restitution);
      const j = (-(1 + e) * normalSpeed) / invSum;
      a.velocity = vecSub(a.velocity, vecScale(normal, j * invA));
      b.velocity = vecAdd(b.velocity, vecScale(normal, j * invB));
    }
  }
}

// ---------------------------------------------------------------------------
// Один фіксований крок
// ---------------------------------------------------------------------------

/** Крок для вільних тіл (PROJECTILE, COLLISIONS). */
function stepParticles(world: WorldState, params: SimulationParams): WorldState {
  const dt = params.dt;
  const next = world.bodies.map(cloneBody);

  for (const body of next) {
    if (!(body.mass > 0)) continue;
    const force = particleForce(body, params);
    const acceleration = vecScale(force, 1 / body.mass);
    // Напівнеявний Ейлер: спочатку швидкість, потім положення за НОВОЮ швидкістю
    body.velocity = vecAdd(body.velocity, vecScale(acceleration, dt));
    body.position = vecAdd(body.position, vecScale(body.velocity, dt));
    body.force = force;
  }

  if (world.presetId === 'COLLISIONS') {
    resolveBodyCollisions(next);
  }

  // Стіни - останніми: після кроку жодне тіло не виходить за межі світу
  for (const body of next) {
    resolveWalls(body, params.restitutionWall);
    body.trail = appendTrail(body.trail, body.position);
  }

  return { ...world, time: world.time + dt, bodies: next };
}

/** Крок для маятника: інтегрується кут theta, а не декартові координати. */
function stepPendulum(world: WorldState, params: SimulationParams): WorldState {
  const body = world.bodies[0];
  if (!body) return world;

  const dt = params.dt;
  const alpha = pendulumAngularAcceleration(world.pendulumAngleRad, world.pendulumAngularVel, params);
  const omega = world.pendulumAngularVel + alpha * dt;
  const theta = world.pendulumAngleRad + omega * dt;

  const { position, velocity } = pendulumKinematics(
    world.pendulumAnchor,
    theta,
    omega,
    params.pendulumLength,
  );

  const nextBody: Body = {
    ...body,
    position,
    velocity,
    force: pendulumResultantForce(body.mass, theta, omega, params),
    trail: appendTrail(body.trail, position),
  };

  return {
    ...world,
    time: world.time + dt,
    bodies: [nextBody],
    pendulumAngleRad: theta,
    pendulumAngularVel: omega,
  };
}

/** Один фіксований крок інтегрування (params.dt). За некоректних параметрів повертає той самий world. */
export function stepPhysicsWorld(world: WorldState, params: SimulationParams): WorldState {
  if (!hasValidStepParams(params)) return world;
  return world.presetId === 'PENDULUM' ? stepPendulum(world, params) : stepParticles(world, params);
}

// ---------------------------------------------------------------------------
// Просування за часом кадру (фіксований крок + акумулятор)
// ---------------------------------------------------------------------------

/**
 * Перетворює реальний час кадру на ціле число кроків dt.
 * frameDeltaSec обрізається до MAX_FRAME_DELTA_SEC, потім множиться на timeScale.
 * Залишок менший за dt зберігається в accumulator до наступного кадру.
 */
export function advanceWorldByFrameDelta(
  world: WorldState,
  params: SimulationParams,
  frameDeltaSec: number,
): WorldState {
  if (!Number.isFinite(frameDeltaSec) || frameDeltaSec <= 0) return world;
  if (!hasValidStepParams(params)) return world;

  const timeScale = Number.isFinite(params.timeScale) && params.timeScale > 0 ? params.timeScale : 1;
  const clampedDelta = Math.min(frameDeltaSec, MAX_FRAME_DELTA_SEC);

  let accumulator = world.accumulator + clampedDelta * timeScale;
  let current = world;
  let steps = 0;

  while (accumulator >= params.dt && steps < MAX_STEPS_PER_ADVANCE) {
    current = stepPhysicsWorld(current, params);
    accumulator -= params.dt;
    steps += 1;
  }

  // Якщо спрацював запобіжник, відкидаємо «борг» часу, щоб не накопичувати його вічно
  if (steps === MAX_STEPS_PER_ADVANCE) accumulator = 0;

  return { ...current, accumulator };
}

// ---------------------------------------------------------------------------
// Енергія та перевірка скінченності
// ---------------------------------------------------------------------------

/**
 * E_k = sum(m v^2 / 2).
 * PENDULUM: E_p = m g L (1 - cos theta) (відносно найнижчої точки);
 * інші пресети: E_p = sum m g max(0, y - r) (відносно підлоги).
 */
export function computeSystemEnergy(world: WorldState, params: SimulationParams): SystemEnergy {
  let kineticEnergy = 0;
  let potentialEnergy = 0;

  for (const body of world.bodies) {
    kineticEnergy += 0.5 * body.mass * vecDot(body.velocity, body.velocity);

    if (world.presetId === 'PENDULUM') {
      potentialEnergy +=
        body.mass * params.gravity * params.pendulumLength * (1 - Math.cos(world.pendulumAngleRad));
    } else {
      potentialEnergy += body.mass * params.gravity * Math.max(0, body.position.y - body.radius);
    }
  }

  return { kineticEnergy, potentialEnergy, totalEnergy: kineticEnergy + potentialEnergy };
}

/** true, якщо всі числові поля світу скінченні (ознака стабільності інтегратора). */
export function isWorldFinite(world: WorldState): boolean {
  const vecOk = (v: Vec2): boolean => Number.isFinite(v.x) && Number.isFinite(v.y);

  if (
    !Number.isFinite(world.time) ||
    !Number.isFinite(world.accumulator) ||
    !Number.isFinite(world.pendulumAngleRad) ||
    !Number.isFinite(world.pendulumAngularVel)
  ) {
    return false;
  }
  return world.bodies.every((b) => vecOk(b.position) && vecOk(b.velocity) && vecOk(b.force));
}