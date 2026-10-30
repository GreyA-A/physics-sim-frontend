import type { PresetMeta } from '../types/simulation';

/**
 * Каталог пресетів: єдине джерело правди для списків вибору в UI.
 * `readonly` забороняє випадкове мутування масиву з компонентів.
 */
export const PRESET_CATALOG: readonly PresetMeta[] = [
  {
    id: 'PROJECTILE',
    title: 'Балістичний рух у полі тяжіння',
    description: 'Політ тіла, кинутого під кутом до горизонту, з урахуванням тяжіння та опору середовища.',
    keyFormula: 'y(t) = y0 + v0y*t - g*t^2/2',
    bodiesCount: 1,
  },
  {
    id: 'COLLISIONS',
    title: 'Пружні зіткнення кульок',
    description: 'Зіткнення кількох кульок різної маси з відбиттям від стін; перевірка законів збереження.',
    keyFormula: 'm1*v1 + m2*v2 = const',
    bodiesCount: 3,
  },
  {
    id: 'PENDULUM',
    title: 'Гармонічний маятник',
    description: 'Коливання математичного маятника; порівняння з аналітичним періодом.',
    keyFormula: 'T = 2*pi*sqrt(L/g)',
    bodiesCount: 1,
  },
];