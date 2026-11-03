import { createInitialWorld } from '../engine/physicsEngine';
import type {
  PresetId,
  SceneBody,
  SceneExportPayload,
  SimulationParams,
  TelemetrySnapshot,
} from '../types/simulation';
import { validateBodyMassAndRadius, validateSimulationParams } from './paramValidator';
import type { ParamKey } from './paramValidator';

/**
 * Збереження та експорт: JSON-сцена (зі схемою безпеки), CSV-телеметрія, PNG-знімок.
 * Файл, який завантажує користувач, - це НЕДОВІРЕНИЙ ввід: перевіряємо розмір,
 * структуру, типи, діапазони та заборонені ключі, і лише потім використовуємо.
 */

// ---------------------------------------------------------------------------
// Константи
// ---------------------------------------------------------------------------

/** Максимальний розмір JSON для імпорту (захист від DoS великим файлом). */
export const MAX_IMPORT_JSON_BYTES = 64 * 1024;
/** Максимальна кількість тіл у файлі сцени. */
export const MAX_IMPORT_BODIES = 20;
export const SCENE_SCHEMA_VERSION = 1;
export const SCENE_APP_ID = 'physics-sim-frontend';

const PRESET_IDS: readonly PresetId[] = ['PROJECTILE', 'COLLISIONS', 'PENDULUM'];

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'app',
  'exportedAt',
  'presetId',
  'environment',
  'presetParams',
  'bodies',
] as const;
const ENVIRONMENT_KEYS = ['gravity', 'damping', 'timeScale', 'dt', 'restitutionWall'] as const;
const PRESET_PARAM_KEYS = [
  'launchAngleDeg',
  'initialSpeed',
  'pendulumLength',
  'initialAngleDeg',
] as const;
const BODY_KEYS = [
  'id',
  'label',
  'mass',
  'radius',
  'restitution',
  'color',
  'position',
  'velocity',
] as const;
const VEC_KEYS = ['x', 'y'] as const;

/** Ключі, через які можлива prototype pollution. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_SCAN_DEPTH = 8;

const ID_PATTERN = /^[\w-]{1,64}$/;
const LABEL_PATTERN = /^[\p{L}\p{M}\p{N} .\u2019-]{1,40}$/u;
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const MAX_EXPORTED_AT_LENGTH = 40;

// ---------------------------------------------------------------------------
// Експорт сцени
// ---------------------------------------------------------------------------

/** Формує JSON сцени зі стартового світу пресету (без похідних force і trail). */
export function serializeSceneToJson(
  presetId: PresetId,
  params: SimulationParams,
  now: Date = new Date(),
): string {
  const world = createInitialWorld(presetId, params);

  const payload: SceneExportPayload = {
    schemaVersion: SCENE_SCHEMA_VERSION,
    app: SCENE_APP_ID,
    exportedAt: now.toISOString(),
    presetId,
    environment: {
      gravity: params.gravity,
      damping: params.damping,
      timeScale: params.timeScale,
      dt: params.dt,
      restitutionWall: params.restitutionWall,
    },
    presetParams: {
      launchAngleDeg: params.launchAngleDeg,
      initialSpeed: params.initialSpeed,
      pendulumLength: params.pendulumLength,
      initialAngleDeg: params.initialAngleDeg,
    },
    bodies: world.bodies.map(
      (body): SceneBody => ({
        id: body.id,
        label: body.label,
        mass: body.mass,
        radius: body.radius,
        restitution: body.restitution,
        color: body.color,
        position: { ...body.position },
        velocity: { ...body.velocity },
      }),
    ),
  };

  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// Безпечний імпорт сцени
// ---------------------------------------------------------------------------

export type SceneImportResult =
  | { ok: true; presetId: PresetId; params: SimulationParams; payload: SceneExportPayload }
  | { ok: false; error: string };

const fail = (error: string): SceneImportResult => ({ ok: false, error });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Власні ключі об'єкта збігаються з очікуваним набором точно (без зайвих і відсутніх). */
function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

/** Рекурсивно шукає заборонений ключ; повертає його назву або null. */
function findForbiddenKey(value: unknown, depth = 0): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if (depth > MAX_SCAN_DEPTH) return '(надмірна вкладеність)';

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) return key;
    const found = findForbiddenKey(record[key], depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** Назва першого поля, значення якого не є скінченним числом. */
function firstNonNumber(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (!isFiniteNumber(obj[key])) return key;
  }
  return null;
}

/** Перевіряє одне тіло; повертає очищене тіло або текст помилки. */
function validateBody(
  raw: unknown,
  index: number,
): { ok: true; body: SceneBody } | { ok: false; error: string } {
  const label = `Тіло №${index + 1}`;

  if (!isPlainObject(raw) || !hasExactKeys(raw, BODY_KEYS)) {
    return { ok: false, error: `${label} має некоректну структуру.` };
  }
  const { id, label: name, color, position, velocity } = raw;

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return { ok: false, error: `${label}: некоректне поле «id».` };
  }
  if (typeof name !== 'string' || !LABEL_PATTERN.test(name)) {
    return { ok: false, error: `${label}: некоректне поле «label».` };
  }
  if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
    return { ok: false, error: `${label}: некоректне поле «color».` };
  }

  if (!isFiniteNumber(raw.mass) || !isFiniteNumber(raw.radius) || !isFiniteNumber(raw.restitution)) {
    return { ok: false, error: `${label}: «mass», «radius» і «restitution» мають бути скінченними числами.` };
  }
  const physics = validateBodyMassAndRadius(raw.mass, raw.radius, raw.restitution);
  if (!physics.valid) {
    const messages = Object.values(physics.errors).filter((m): m is string => typeof m === 'string');
    return { ok: false, error: `${label}: ${messages.join(' ')}` };
  }

  const vectors: Record<'position' | 'velocity', { x: number; y: number }> = {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
  };
  for (const [key, value] of [
    ['position', position],
    ['velocity', velocity],
  ] as const) {
    if (!isPlainObject(value) || !hasExactKeys(value, VEC_KEYS) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
      return { ok: false, error: `${label}: некоректне поле «${key}».` };
    }
    vectors[key] = { x: value.x, y: value.y };
  }

  return {
    ok: true,
    body: {
      id,
      label: name,
      mass: physics.mass,
      radius: physics.radius,
      restitution: physics.restitution,
      color,
      position: vectors.position,
      velocity: vectors.velocity,
    },
  };
}

/**
 * Безпечний парсинг та валідація JSON-сцени. Чиста функція: не кидає винятків,
 * повертає або очищений результат, або повідомлення про помилку.
 */
export function parseAndValidateSceneJson(rawJson: string): SceneImportResult {
  // 1. Розмір (перевірка до парсингу, щоб великий файл не завантажував процесор)
  if (rawJson.length > MAX_IMPORT_JSON_BYTES) {
    return fail(`Файл завеликий (максимум ${MAX_IMPORT_JSON_BYTES / 1024} КБ).`);
  }

  // 2. Парсинг у try/catch
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return fail('Файл не є коректним JSON.');
  }

  // 3. Корінь - звичайний об'єкт; заборонені ключі на будь-якій глибині
  if (!isPlainObject(parsed)) return fail('Корінь файлу має бути JSON-об’єктом.');
  const forbidden = findForbiddenKey(parsed);
  if (forbidden !== null) return fail(`Файл містить небезпечний ключ «${forbidden}».`);

  // 4. Точний набір ключів верхнього рівня
  if (!hasExactKeys(parsed, TOP_LEVEL_KEYS)) {
    return fail('Файл містить невідомі або відсутні поля верхнього рівня.');
  }

  // 5. Службові поля
  if (parsed.schemaVersion !== SCENE_SCHEMA_VERSION) {
    return fail(`Непідтримувана версія схеми (очікується ${SCENE_SCHEMA_VERSION}).`);
  }
  if (parsed.app !== SCENE_APP_ID) return fail('Файл створено іншим застосунком.');
  if (
    typeof parsed.exportedAt !== 'string' ||
    parsed.exportedAt.length > MAX_EXPORTED_AT_LENGTH ||
    Number.isNaN(Date.parse(parsed.exportedAt))
  ) {
    return fail('Некоректне поле «exportedAt».');
  }
  const presetId = parsed.presetId;
  if (!isPresetId(presetId)) return fail('Невідомий пресет.');

  // 6. Параметри: точні набори ключів і суворі типи (рядки не приймаються)
  const { environment, presetParams } = parsed;
  if (!isPlainObject(environment) || !hasExactKeys(environment, ENVIRONMENT_KEYS)) {
    return fail('Секція «environment» має некоректну структуру.');
  }
  if (!isPlainObject(presetParams) || !hasExactKeys(presetParams, PRESET_PARAM_KEYS)) {
    return fail('Секція «presetParams» має некоректну структуру.');
  }
  const badEnvironment = firstNonNumber(environment, ENVIRONMENT_KEYS);
  if (badEnvironment !== null) {
    return fail(`Поле «environment.${badEnvironment}» має бути скінченним числом.`);
  }
  const badPresetParam = firstNonNumber(presetParams, PRESET_PARAM_KEYS);
  if (badPresetParam !== null) {
    return fail(`Поле «presetParams.${badPresetParam}» має бути скінченним числом.`);
  }

  // 7. Діапазони: той самий валідатор, що й для форми (Issue #4)
  const merged: Partial<Record<ParamKey, unknown>> = {};
  for (const key of ENVIRONMENT_KEYS) merged[key] = environment[key];
  for (const key of PRESET_PARAM_KEYS) merged[key] = presetParams[key];
  const validation = validateSimulationParams(merged);
  if (!validation.valid) {
    const messages = Object.values(validation.errors).filter(
      (message): message is string => typeof message === 'string',
    );
    return fail(`Некоректні параметри: ${messages.join(' ')}`);
  }
  const params = validation.params;

  // 8. Тіла
  const rawBodies = parsed.bodies;
  if (!Array.isArray(rawBodies) || rawBodies.length < 1 || rawBodies.length > MAX_IMPORT_BODIES) {
    return fail(`Масив «bodies» має містити від 1 до ${MAX_IMPORT_BODIES} тіл.`);
  }
  const bodies: SceneBody[] = [];
  const seenIds = new Set<string>();
  for (const [index, rawBody] of rawBodies.entries()) {
    const checked = validateBody(rawBody, index);
    if (!checked.ok) return fail(checked.error);
    if (seenIds.has(checked.body.id)) return fail('Ідентифікатори тіл мають бути унікальними.');
    seenIds.add(checked.body.id);
    bodies.push(checked.body);
  }

  // 9. Чиста копія лише відомих полів
  const payload: SceneExportPayload = {
    schemaVersion: SCENE_SCHEMA_VERSION,
    app: SCENE_APP_ID,
    exportedAt: parsed.exportedAt,
    presetId,
    environment: {
      gravity: params.gravity,
      damping: params.damping,
      timeScale: params.timeScale,
      dt: params.dt,
      restitutionWall: params.restitutionWall,
    },
    presetParams: {
      launchAngleDeg: params.launchAngleDeg,
      initialSpeed: params.initialSpeed,
      pendulumLength: params.pendulumLength,
      initialAngleDeg: params.initialAngleDeg,
    },
    bodies,
  };

  return { ok: true, presetId, params, payload };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Символи, з яких табличні редактори починають формулу. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Звичайне від'ємне число (його не екрануємо): -9.81, -.5, -1e-7. */
const PLAIN_NEGATIVE_NUMBER = /^-(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Захист від CSV-ін'єкцій (Formula Injection) та екранування за RFC 4180.
 * Нескінченні числа дають порожню клітинку.
 */
export function sanitizeCsvCell(raw: string | number): string {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return '';
    text = String(raw);
  } else {
    text = raw;
  }

  const isPlainNegative = PLAIN_NEGATIVE_NUMBER.test(text) && Number.isFinite(Number(text));
  if (FORMULA_START.test(text) && !isPlainNegative) {
    text = `'${text}`;
  }

  // RFC 4180: поле з комою, лапкою або переносом рядка береться в лапки, лапки подвоюються
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_HEADER = 'time_s,kinetic_energy_j,potential_energy_j,total_energy_j,fps,active_bodies';

/** Округлення до digits знаків; нескінченні значення лишаються NaN (порожня клітинка). */
const round = (value: number, digits: number): number =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : NaN;

/** Формує CSV журналу телеметрії (рядки розділено CRLF за RFC 4180). */
export function formatTelemetryToCsv(log: readonly TelemetrySnapshot[]): string {
  const rows = log.map((entry) =>
    [
      round(entry.time, 3),
      round(entry.kineticEnergy, 4),
      round(entry.potentialEnergy, 4),
      round(entry.kineticEnergy + entry.potentialEnergy, 4),
      round(entry.fps, 0),
      round(entry.activeBodiesCount, 0),
    ]
      .map(sanitizeCsvCell)
      .join(','),
  );
  return [CSV_HEADER, ...rows].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Завантаження файлів у браузері
// ---------------------------------------------------------------------------

/** Ім'я файлу: префікс-РРРРММДД-ГГххсс.розширення (час UTC, лише безпечні символи). */
export function buildExportFilename(prefix: string, extension: string, now: Date = new Date()): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replace(/-/g, '');
  const time = iso.slice(11, 19).replace(/:/g, '');
  return `${prefix}-${date}-${time}.${extension}`;
}

/** Затримка перед звільненням URL: деякі браузери починають завантаження асинхронно. */
const REVOKE_DELAY_MS = 0;

/** Завантаження Blob через тимчасове посилання <a download>. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Звільняємо пам'ять, яку тримає blob-URL
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** data:image/png;base64,... -> Blob або null, якщо рядок некоректний. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[1] === undefined) return null;
  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  } catch {
    return null;
  }
}

/**
 * Зберігає знімок полотна у PNG. Спершу toBlob (без проміжного base64-рядка),
 * запасний шлях - toDataURL. Повертає true, якщо файл передано на завантаження.
 */
export async function exportCanvasToPng(
  canvas: HTMLCanvasElement | null,
  filename: string,
): Promise<boolean> {
  if (canvas === null) return false;

  let blob: Blob | null = await new Promise<Blob | null>((resolve) => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((result) => resolve(result), 'image/png');
        return;
      }
    } catch {
      // перейдемо до запасного шляху
    }
    resolve(null);
  });

  if (blob === null) {
    try {
      blob = dataUrlToBlob(canvas.toDataURL('image/png'));
    } catch {
      blob = null; // напр., SecurityError для «забрудненого» полотна
    }
  }
  if (blob === null) return false;

  downloadBlob(blob, filename);
  return true;
}

/** Читає Blob / File як текст (FileReader працює і в браузері, і в jsdom). */
export function readFileAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Не вдалося прочитати файл.'));
    reader.readAsText(file);
  });
}