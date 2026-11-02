import { describe, expect, it } from 'vitest';
import {
  MAX_TRAIL_LENGTH,
  PENDULUM_ANCHOR,
  WORLD_BOUNDS,
  advanceWorldByFrameDelta,
  computeSystemEnergy,
  createInitialWorld,
  isWorldFinite,
  makeBody,
  stepPhysicsWorld,
} from '../engine/physicsEngine';
import type { WorldState } from '../engine/physicsEngine';
import {
  clampNumber,
  vecAdd,
  vecClamp,
  vecDistance,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub,
} from '../engine/vec2';
import type { Body, SimulationParams, Vec2 } from '../types/simulation';
import { DEFAULT_SIMULATION_PARAMS } from '../utils/paramValidator';

// ---------------------------------------------------------------------------
// Допоміжні функції тестів
// ---------------------------------------------------------------------------

/** Повний набір параметрів із перевизначеннями. */
const P = (override: Partial<SimulationParams> = {}): SimulationParams => ({
  ...DEFAULT_SIMULATION_PARAMS,
  ...override,
});

/** Перше тіло світу (кидає помилку, якщо його немає, - без небезпечних `!`). */
const firstBody = (world: WorldState): Body => {
  const body = world.bodies[0];
  if (!body) throw new Error('У світі немає тіл');
  return body;
};

/** Елемент масиву за індексом із перевіркою (noUncheckedIndexedAccess). */
const at = (array: readonly number[], index: number): number => {
  const value = array[index];
  if (value === undefined) throw new Error(`Немає елемента з індексом ${index}`);
  return value;
};

const stepN = (world: WorldState, params: SimulationParams, n: number): WorldState => {
  let current = world;
  for (let i = 0; i < n; i++) current = stepPhysicsWorld(current, params);
  return current;
};

const totalMomentum = (world: WorldState): Vec2 =>
  world.bodies.reduce<Vec2>(
    (sum, b) => ({ x: sum.x + b.mass * b.velocity.x, y: sum.y + b.mass * b.velocity.y }),
    { x: 0, y: 0 },
  );

// ---------------------------------------------------------------------------
// Векторна математика
// ---------------------------------------------------------------------------

describe('vec2', () => {
  it('виконує базові операції та не мутує аргументи', () => {
    const a: Vec2 = { x: 1, y: 2 };
    const b: Vec2 = { x: 3, y: 4 };
    expect(vecAdd(a, b)).toEqual({ x: 4, y: 6 });
    expect(vecSub(b, a)).toEqual({ x: 2, y: 2 });
    expect(vecScale(a, 3)).toEqual({ x: 3, y: 6 });
    expect(vecDot(a, b)).toBe(11);
    expect(a).toEqual({ x: 1, y: 2 });
    expect(b).toEqual({ x: 3, y: 4 });
  });

  it('обчислює довжину та відстань', () => {
    expect(vecLength({ x: 3, y: 4 })).toBe(5);
    expect(vecDistance({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5);
  });

  it('нормалізує вектор; нульовий вектор дає (0, 0), а не NaN', () => {
    const n = vecNormalize({ x: 3, y: 4 });
    expect(n.x).toBeCloseTo(0.6, 12);
    expect(n.y).toBeCloseTo(0.8, 12);
    expect(vecNormalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('vecClamp обмежує довжину та зберігає напрямок', () => {
    const clamped = vecClamp({ x: 3, y: 4 }, 2);
    expect(vecLength(clamped)).toBeCloseTo(2, 12);
    expect(clamped.x / clamped.y).toBeCloseTo(0.75, 12);
    expect(vecClamp({ x: 0.3, y: 0.4 }, 2)).toEqual({ x: 0.3, y: 0.4 });
  });

  it('vecClamp повертає нульовий вектор для некоректних даних', () => {
    expect(vecClamp({ x: 1, y: 1 }, 0)).toEqual({ x: 0, y: 0 });
    expect(vecClamp({ x: 1, y: 1 }, NaN)).toEqual({ x: 0, y: 0 });
    expect(vecClamp({ x: Infinity, y: 0 }, 5)).toEqual({ x: 0, y: 0 });
  });

  it('clampNumber обмежує скаляр', () => {
    expect(clampNumber(5, 0, 3)).toBe(3);
    expect(clampNumber(-1, 0, 3)).toBe(0);
    expect(clampNumber(2, 0, 3)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Ініціалізація сцен
// ---------------------------------------------------------------------------

describe('createInitialWorld', () => {
  it('PROJECTILE: розкладає початкову швидкість за кутом', () => {
    const world = createInitialWorld('PROJECTILE', P({ launchAngleDeg: 45, initialSpeed: 15 }));
    const body = firstBody(world);
    expect(world.bodies).toHaveLength(1);
    expect(body.position).toEqual({ x: 1.5, y: 1.0 });
    expect(body.velocity.x).toBeCloseTo(15 * Math.cos(Math.PI / 4), 9);
    expect(body.velocity.y).toBeCloseTo(15 * Math.sin(Math.PI / 4), 9);
    expect(world.time).toBe(0);
    expect(world.accumulator).toBe(0);
  });

  it('COLLISIONS: три різні кульки всередині світу без початкового перекриття', () => {
    const world = createInitialWorld('COLLISIONS', P());
    expect(world.bodies).toHaveLength(3);
    expect(new Set(world.bodies.map((b) => b.id)).size).toBe(3);
    expect(new Set(world.bodies.map((b) => b.mass)).size).toBe(3);

    for (const b of world.bodies) {
      expect(b.position.x).toBeGreaterThanOrEqual(b.radius);
      expect(b.position.x).toBeLessThanOrEqual(WORLD_BOUNDS.width - b.radius);
      expect(b.position.y).toBeGreaterThanOrEqual(b.radius);
      expect(b.position.y).toBeLessThanOrEqual(WORLD_BOUNDS.height - b.radius);
    }
    for (let i = 0; i < world.bodies.length; i++) {
      for (let k = i + 1; k < world.bodies.length; k++) {
        const a = world.bodies[i];
        const b = world.bodies[k];
        if (!a || !b) throw new Error('Некоректний індекс');
        expect(vecDistance(a.position, b.position)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it('PENDULUM: вантаж розташований за формулою (x0 + L sin θ, y0 - L cos θ)', () => {
    const params = P({ initialAngleDeg: 30, pendulumLength: 2 });
    const world = createInitialWorld('PENDULUM', params);
    const body = firstBody(world);
    expect(world.pendulumAnchor).toEqual(PENDULUM_ANCHOR);
    expect(world.pendulumAngleRad).toBeCloseTo(Math.PI / 6, 12);
    expect(world.pendulumAngularVel).toBe(0);
    expect(body.position.x).toBeCloseTo(10 + 2 * Math.sin(Math.PI / 6), 9);
    expect(body.position.y).toBeCloseTo(10 - 2 * Math.cos(Math.PI / 6), 9);
    // У спокої сила дорівнює дотичній складовій тяжіння: m g sin θ
    expect(Math.hypot(body.force.x, body.force.y)).toBeCloseTo(9.81 * Math.sin(Math.PI / 6), 6);
  });
});

// ---------------------------------------------------------------------------
// Балістика
// ---------------------------------------------------------------------------

describe('Балістика (PROJECTILE)', () => {
  it('піднімається, досягає вершини, падає й відбивається від підлоги', () => {
    const params = P({ damping: 0, restitutionWall: 0.9 });
    let world = createInitialWorld('PROJECTILE', params);
    const radius = firstBody(world).radius;
    const ys: number[] = [firstBody(world).position.y];
    const vys: number[] = [firstBody(world).velocity.y];

    for (let i = 0; i < 250; i++) {
      world = stepPhysicsWorld(world, params);
      ys.push(firstBody(world).position.y);
      vys.push(firstBody(world).velocity.y);
    }

    // Підйом
    expect(at(ys, 5)).toBeGreaterThan(at(ys, 0));

    // Вершина: y0 + (v0 sin α)^2 / (2g) ≈ 1 + 5.73 = 6.73 м (допуск на дискретизацію)
    const apexY = Math.max(...ys);
    const apexIndex = ys.indexOf(apexY);
    expect(apexIndex).toBeGreaterThan(30);
    expect(apexIndex).toBeLessThan(120);
    expect(Math.abs(apexY - 6.73)).toBeLessThan(0.2);

    // Падіння після вершини
    expect(at(ys, apexIndex + 20)).toBeLessThan(apexY);

    // Тіло ніколи не провалюється крізь підлогу
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(radius - 1e-9);

    // Перший контакт з підлогою: швидкість змінює знак (відбиття)
    const floorIndex = ys.findIndex((y, i) => i > 0 && y <= radius + 1e-9);
    expect(floorIndex).toBeGreaterThan(apexIndex);
    expect(at(vys, floorIndex)).toBeGreaterThan(0);
  });

  it('без опору горизонтальна швидкість стала до зіткнення зі стіною', () => {
    const params = P({ damping: 0 });
    const world = stepN(createInitialWorld('PROJECTILE', params), params, 20);
    expect(firstBody(world).velocity.x).toBeCloseTo(15 * Math.cos(Math.PI / 4), 9);
  });

  it('відбивається від правої стіни з коефіцієнтом restitutionWall', () => {
    const params = P({ gravity: 0, damping: 0, restitutionWall: 0.5 });
    const base = createInitialWorld('PROJECTILE', params);
    const world: WorldState = {
      ...base,
      bodies: [
        makeBody({
          id: 'p', label: 'p', mass: 1, radius: 0.5, restitution: 1, color: '#000',
          position: { x: 19, y: 6 }, velocity: { x: 5, y: 0 },
        }),
      ],
    };
    const after = stepN(world, params, 20);
    expect(firstBody(after).velocity.x).toBeCloseTo(-2.5, 9);
    expect(firstBody(after).position.x).toBeLessThanOrEqual(WORLD_BOUNDS.width - 0.5);
  });

  it('енергія на старті: E_k = m v^2 / 2, E_p = m g (y - r)', () => {
    const params = P({ initialSpeed: 15 });
    const energy = computeSystemEnergy(createInitialWorld('PROJECTILE', params), params);
    expect(energy.kineticEnergy).toBeCloseTo(0.5 * 15 * 15, 9);
    expect(energy.potentialEnergy).toBeCloseTo(9.81 * (1.0 - 0.3), 9);
    expect(energy.totalEnergy).toBeCloseTo(energy.kineticEnergy + energy.potentialEnergy, 12);
  });

  it('слід траєкторії обмежений MAX_TRAIL_LENGTH', () => {
    const params = P();
    const world = stepN(createInitialWorld('PROJECTILE', params), params, MAX_TRAIL_LENGTH + 100);
    expect(firstBody(world).trail).toHaveLength(MAX_TRAIL_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// Пружні зіткнення
// ---------------------------------------------------------------------------

describe('Пружні зіткнення (COLLISIONS)', () => {
  const params = P({ gravity: 0, damping: 0, restitutionWall: 1 });

  const twoBalls = (massA: number, massB: number, restitution: number): WorldState => ({
    ...createInitialWorld('COLLISIONS', params),
    bodies: [
      makeBody({
        id: 'a', label: 'A', mass: massA, radius: 0.5, restitution, color: '#f00',
        position: { x: 8, y: 6 }, velocity: { x: 3, y: 0 },
      }),
      makeBody({
        id: 'b', label: 'B', mass: massB, radius: 0.5, restitution, color: '#00f',
        position: { x: 10, y: 6 }, velocity: { x: -1, y: 0 },
      }),
    ],
  });

  it('лобове пружне зіткнення рівних мас: кульки обмінюються швидкостями', () => {
    const before = twoBalls(1, 1, 1);
    const after = stepN(before, params, 60);
    const [a, b] = after.bodies;
    if (!a || !b) throw new Error('Немає тіл');

    expect(a.velocity.x).toBeCloseTo(-1, 9);
    expect(b.velocity.x).toBeCloseTo(3, 9);
    expect(a.velocity.y).toBeCloseTo(0, 9);

    // Закони збереження
    const p0 = totalMomentum(before);
    const p1 = totalMomentum(after);
    expect(p1.x).toBeCloseTo(p0.x, 9);
    expect(p1.y).toBeCloseTo(p0.y, 9);
    expect(computeSystemEnergy(after, params).totalEnergy).toBeCloseTo(
      computeSystemEnergy(before, params).totalEnergy,
      9,
    );
  });

  it('різні маси (e = 1): імпульс і кінетична енергія зберігаються', () => {
    const before = twoBalls(1, 3, 1);
    const after = stepN(before, params, 60);
    expect(totalMomentum(after).x).toBeCloseTo(totalMomentum(before).x, 9);
    expect(computeSystemEnergy(after, params).kineticEnergy).toBeCloseTo(
      computeSystemEnergy(before, params).kineticEnergy,
      9,
    );
  });

  it('непружне зіткнення (e = 0.5): імпульс зберігається, енергія зменшується', () => {
    const before = twoBalls(1, 1, 0.5);
    const after = stepN(before, params, 60);
    expect(totalMomentum(after).x).toBeCloseTo(totalMomentum(before).x, 9);
    expect(computeSystemEnergy(after, params).kineticEnergy).toBeLessThan(
      computeSystemEnergy(before, params).kineticEnergy,
    );
  });

  it('збіжні центри не дають NaN', () => {
    const world: WorldState = {
      ...createInitialWorld('COLLISIONS', params),
      bodies: [
        makeBody({
          id: 'a', label: 'A', mass: 1, radius: 0.5, restitution: 1, color: '#f00',
          position: { x: 5, y: 5 }, velocity: { x: 1, y: 0 },
        }),
        makeBody({
          id: 'b', label: 'B', mass: 2, radius: 0.5, restitution: 1, color: '#00f',
          position: { x: 5, y: 5 }, velocity: { x: -1, y: 0 },
        }),
      ],
    };
    expect(isWorldFinite(stepN(world, params, 5))).toBe(true);
  });

  it('типова сцена за стандартних параметрів лишається скінченною та всередині світу', () => {
    const defaults = P();
    let world = createInitialWorld('COLLISIONS', defaults);
    for (let i = 0; i < 1000; i++) world = stepPhysicsWorld(world, defaults);

    expect(isWorldFinite(world)).toBe(true);
    for (const b of world.bodies) {
      expect(b.position.x).toBeGreaterThanOrEqual(b.radius - 1e-9);
      expect(b.position.x).toBeLessThanOrEqual(WORLD_BOUNDS.width - b.radius + 1e-9);
      expect(b.position.y).toBeGreaterThanOrEqual(b.radius - 1e-9);
      expect(b.position.y).toBeLessThanOrEqual(WORLD_BOUNDS.height - b.radius + 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Гармонічний маятник
// ---------------------------------------------------------------------------

describe('Гармонічний маятник (PENDULUM)', () => {
  // dt = 0.01: відхилення симплектичного Ейлера ~ ω0·dt/2 ≈ 1.1 % (при dt = 0.016 було б ≈ 1.8 %)
  const params = P({ damping: 0, initialAngleDeg: 5, pendulumLength: 2, dt: 0.01 });

  it('повна механічна енергія зберігається в межах 2 % за 100 кроків', () => {
    let world = createInitialWorld('PENDULUM', params);
    const e0 = computeSystemEnergy(world, params).totalEnergy;
    expect(e0).toBeGreaterThan(0);

    let maxDeviation = 0;
    for (let i = 0; i < 100; i++) {
      world = stepPhysicsWorld(world, params);
      const e = computeSystemEnergy(world, params).totalEnergy;
      maxDeviation = Math.max(maxDeviation, Math.abs(e - e0) / e0);
    }
    expect(maxDeviation).toBeLessThan(0.02);
  });

  it('змінює знак кута після половини теоретичного періоду T = 2π√(L/g)', () => {
    const theta0 = (5 * Math.PI) / 180;
    const period = 2 * Math.PI * Math.sqrt(params.pendulumLength / params.gravity);
    const halfPeriodSteps = Math.round(period / 2 / params.dt);

    const start = createInitialWorld('PENDULUM', params);
    expect(start.pendulumAngleRad).toBeGreaterThan(0);

    const half = stepN(start, params, halfPeriodSteps);
    expect(half.pendulumAngleRad).toBeLessThan(0);
    // Для малих кутів θ(T/2) ≈ -θ0 (допуск 0.005 рад)
    expect(half.pendulumAngleRad).toBeCloseTo(-theta0, 2);
  });

  it('вантаж лишається на відстані L від точки підвісу', () => {
    const world = stepN(createInitialWorld('PENDULUM', params), params, 77);
    const body = firstBody(world);
    expect(vecDistance(body.position, world.pendulumAnchor)).toBeCloseTo(params.pendulumLength, 9);
  });

  it('з опором повна енергія зменшується', () => {
    const damped = P({ damping: 0.5, initialAngleDeg: 30, dt: 0.01 });
    const start = createInitialWorld('PENDULUM', damped);
    const after = stepN(start, damped, 300);
    expect(computeSystemEnergy(after, damped).totalEnergy).toBeLessThan(
      computeSystemEnergy(start, damped).totalEnergy,
    );
  });
});

// ---------------------------------------------------------------------------
// Акумулятор часу та захист
// ---------------------------------------------------------------------------

describe('advanceWorldByFrameDelta', () => {
  const params = P({ dt: 0.016, timeScale: 1 });

  it('робить рівно стільки кроків dt, скільки вміщується в кадр, і зберігає залишок', () => {
    const start = createInitialWorld('PROJECTILE', params);

    // 0.05 / 0.016 = 3.125 -> 3 кроки, залишок 0.002
    const first = advanceWorldByFrameDelta(start, params, 0.05);
    expect(first.time).toBeCloseTo(3 * 0.016, 9);
    expect(first.accumulator).toBeCloseTo(0.002, 9);

    // Залишок переноситься: 0.002 + 0.015 = 0.017 -> ще 1 крок, залишок 0.001
    const second = advanceWorldByFrameDelta(first, params, 0.015);
    expect(second.time).toBeCloseTo(4 * 0.016, 9);
    expect(second.accumulator).toBeCloseTo(0.001, 9);
  });

  it('кадр коротший за dt не змінює положення, а лише накопичує час', () => {
    const start = createInitialWorld('PROJECTILE', params);
    const after = advanceWorldByFrameDelta(start, params, 0.01);
    expect(after.time).toBe(0);
    expect(after.accumulator).toBeCloseTo(0.01, 12);
    expect(firstBody(after).position).toEqual(firstBody(start).position);
  });

  it('обрізає занадто великий кадр до 0.1 с (захист від зависання вкладки)', () => {
    const start = createInitialWorld('PROJECTILE', params);
    const after = advanceWorldByFrameDelta(start, params, 5);
    // 0.1 / 0.016 = 6.25 -> 6 кроків
    expect(after.time).toBeCloseTo(6 * 0.016, 9);
    expect(after.accumulator).toBeCloseTo(0.004, 9);
  });

  it('множить час кадру на timeScale', () => {
    const fast = P({ dt: 0.016, timeScale: 2 });
    const after = advanceWorldByFrameDelta(createInitialWorld('PROJECTILE', fast), fast, 0.05);
    // 0.05 * 2 = 0.1 -> 6 кроків
    expect(after.time).toBeCloseTo(6 * 0.016, 9);
  });

  it('ігнорує некоректний час кадру та некоректні параметри', () => {
    const start = createInitialWorld('PROJECTILE', params);
    for (const bad of [NaN, -1, 0, Infinity]) {
      expect(advanceWorldByFrameDelta(start, params, bad)).toBe(start);
    }
    expect(advanceWorldByFrameDelta(start, P({ dt: NaN }), 0.05)).toBe(start);
    expect(advanceWorldByFrameDelta(start, P({ dt: 0 }), 0.05)).toBe(start);
  });
});

describe('Захист від некоректних даних', () => {
  it('stepPhysicsWorld повертає той самий world за некоректного dt', () => {
    const world = createInitialWorld('PROJECTILE', P());
    expect(stepPhysicsWorld(world, P({ dt: NaN }))).toBe(world);
    expect(stepPhysicsWorld(world, P({ dt: -0.01 }))).toBe(world);
    expect(stepPhysicsWorld(world, P({ pendulumLength: 0 }))).toBe(world);
  });

  it('isWorldFinite виявляє NaN та Infinity', () => {
    const world = createInitialWorld('PROJECTILE', P());
    expect(isWorldFinite(world)).toBe(true);

    const body = firstBody(world);
    const withNaN: WorldState = {
      ...world,
      bodies: [{ ...body, position: { x: NaN, y: 1 } }],
    };
    const withInfinity: WorldState = {
      ...world,
      bodies: [{ ...body, velocity: { x: Infinity, y: 0 } }],
    };
    expect(isWorldFinite(withNaN)).toBe(false);
    expect(isWorldFinite(withInfinity)).toBe(false);
  });

  it('крок не мутує вхідний world', () => {
    const params = P();
    const world = createInitialWorld('COLLISIONS', params);
    const snapshot = JSON.stringify(world);
    stepPhysicsWorld(world, params);
    expect(JSON.stringify(world)).toBe(snapshot);
  });
});