import type { ResearcherProfile, ThemeMode } from '../types/simulation';

/** Ключ сховища; суфікс _v1 дозволяє змінити схему профілю без конфліктів зі старими даними. */
export const STORAGE_KEY = 'physics_sim_researcher_profile_v1';

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 40;

/** Профіль - кілька десятків байтів; усе, що більше, вважаємо підробкою або сміттям. */
const MAX_STORED_LENGTH = 2048;

/** Результат валідації імені: дискримінований union за полем `valid`. */
export type NameValidationResult =
  | { valid: true; sanitized: string }
  | { valid: false; error: string };

/**
 * БІЛИЙ СПИСОК дозволених символів (прапор u потрібен для \p{...}):
 *  \p{L} - літери будь-якої абетки (українські, латинські), \p{M} - діакритика,
 *  \p{N} - цифри, пробіл, крапка, типографський апостроф U+2019, дефіс.
 * Усе інше (< > " / \ керуючі символи тощо) не проходить, тому XSS-вектори
 * та керуючі символи відсікаються без окремого чорного списку.
 */
const ALLOWED_NAME_PATTERN = /^[\p{L}\p{M}\p{N} .\u2019-]+$/u;

/**
 * Валідація та санітизація імені дослідника.
 * Порядок: нормалізація -> перевірка довжини -> перевірка білого списку.
 */
export function validateDisplayName(raw: string): NameValidationResult {
  const sanitized = raw
    // NFC: одна форма запису літер (напр., "й" як один символ, а не "и" + діакритика)
    .normalize('NFC')
    // прямий апостроф і U+02BC -> дозволений U+2019 (прямий ' не потрапляє у збережені дані)
    .replace(/['\u02BC]/g, '\u2019')
    // кратні пробіли/табуляції/переноси -> один пробіл
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length < NAME_MIN_LENGTH || sanitized.length > NAME_MAX_LENGTH) {
    return {
      valid: false,
      error: `Ім’я має містити від ${NAME_MIN_LENGTH} до ${NAME_MAX_LENGTH} символів.`,
    };
  }

  if (!ALLOWED_NAME_PATTERN.test(sanitized)) {
    return {
      valid: false,
      error: 'Ім’я містить недопустимі символи. Дозволено літери, цифри, пробіл, дефіс, крапку та апостроф.',
    };
  }

  return { valid: true, sanitized };
}

/**
 * Type guard: суворо перевіряє схему об'єкта, прочитаного з localStorage.
 * Дані зі сховища - це ЗОВНІШНІЙ ввід (їх міг змінити користувач у DevTools),
 * тому тип `unknown` і перевірка кожного поля.
 */
export function isResearcherProfile(value: unknown): value is ResearcherProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;

  if (typeof v.id !== 'string' || !/^[\w-]{1,64}$/.test(v.id)) return false;

  // Ім'я має бути вже санітизованим: повторна санітизація не повинна його змінювати
  if (typeof v.displayName !== 'string') return false;
  const name = validateDisplayName(v.displayName);
  if (!name.valid || name.sanitized !== v.displayName) return false;

  if (typeof v.createdAt !== 'string' || Number.isNaN(Date.parse(v.createdAt))) return false;
  if (typeof v.lastLoginAt !== 'string' || Number.isNaN(Date.parse(v.lastLoginAt))) return false;

  return v.theme === 'light' || v.theme === 'dark';
}

/** Унікальний id профілю; randomUUID доступний лише у безпечному контексті, тому є запасний варіант. */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Створює новий профіль зі вже санітизованим ім'ям. */
export function createProfile(
  displayName: string,
  theme: ThemeMode,
  now: Date = new Date(),
): ResearcherProfile {
  const iso = now.toISOString();
  return { id: generateId(), displayName, createdAt: iso, lastLoginAt: iso, theme };
}

/**
 * Безпечне читання профілю. Повертає null, якщо запису немає, JSON пошкоджений,
 * схема не збігається або сховище заблоковане. Ніколи не кидає виняток.
 */
export function loadProfile(): ResearcherProfile | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length > MAX_STORED_LENGTH) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isResearcherProfile(parsed)) return null;

    // Повертаємо чисту копію лише відомих полів (зайві поля з сховища відкидаються)
    return {
      id: parsed.id,
      displayName: parsed.displayName,
      createdAt: parsed.createdAt,
      lastLoginAt: parsed.lastLoginAt,
      theme: parsed.theme,
    };
  } catch {
    // SyntaxError (битий JSON) або SecurityError (сховище заблоковане)
    return null;
  }
}

/** Безпечний запис профілю; помилки (переповнення, приватний режим) ігноруються. */
export function saveProfile(profile: ResearcherProfile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Застосунок продовжує працювати з профілем у пам'яті
  }
}

/** Безпечне видалення профілю зі сховища. */
export function clearProfile(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Нічого робити: сховище недоступне
  }
}