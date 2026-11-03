import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { SimulationParams, TelemetrySnapshot } from '../types/simulation';
import {
  MAX_IMPORT_JSON_BYTES,
  buildExportFilename,
  downloadBlob,
  exportCanvasToPng,
  formatTelemetryToCsv,
  parseAndValidateSceneJson,
  readFileAsText,
  sanitizeCsvCell,
  serializeSceneToJson,
} from '../utils/exportService';
import { DEFAULT_SIMULATION_PARAMS } from '../utils/paramValidator';
import { exportMocks, installCanvasTestEnvironment } from './canvasMock';
import { TEST_PROFILE } from './testProfile';

beforeEach(() => {
  installCanvasTestEnvironment();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Допоміжні функції
// ---------------------------------------------------------------------------

const PARAMS: SimulationParams = { ...DEFAULT_SIMULATION_PARAMS, gravity: 1.62, launchAngleDeg: 30 };
const NOW = new Date('2026-11-03T10:15:30.000Z');

type Obj = Record<string, unknown>;

const validJson = () => serializeSceneToJson('PROJECTILE', PARAMS, NOW);

/** Бере валідний JSON, змінює його та повертає назад рядком. */
const mutate = (change: (obj: Obj) => void): string => {
  const obj = JSON.parse(validJson()) as Obj;
  change(obj);
  return JSON.stringify(obj);
};

const section = (obj: Obj, key: string): Obj => obj[key] as Obj;

const firstBodyOf = (obj: Obj): Obj => {
  const body = (obj.bodies as Obj[])[0];
  if (!body) throw new Error('Немає тіл');
  return body;
};

const snap = (time: number, ek: number, ep: number, fps = 60): TelemetrySnapshot => ({
  time,
  kineticEnergy: ek,
  potentialEnergy: ep,
  totalEnergy: ek + ep,
  fps,
  activeBodiesCount: 1,
});

// ---------------------------------------------------------------------------
// JSON: серіалізація та round-trip
// ---------------------------------------------------------------------------

describe('serializeSceneToJson / parseAndValidateSceneJson', () => {
  it('round-trip повертає той самий пресет і параметри', () => {
    const result = parseAndValidateSceneJson(validJson());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.presetId).toBe('PROJECTILE');
      expect(result.params).toEqual(PARAMS);
      expect(result.payload.exportedAt).toBe('2026-11-03T10:15:30.000Z');
      expect(result.payload.bodies).toHaveLength(1);
    }
  });

  it('JSON має схему, форматування та не містить force і trail', () => {
    const obj = JSON.parse(validJson()) as Obj;
    expect(obj.schemaVersion).toBe(1);
    expect(obj.app).toBe('physics-sim-frontend');
    expect(validJson()).toContain('\n  "presetId"');
    expect(firstBodyOf(obj)).not.toHaveProperty('force');
    expect(firstBodyOf(obj)).not.toHaveProperty('trail');
  });

  it.each(['PROJECTILE', 'COLLISIONS', 'PENDULUM'] as const)('round-trip для пресету %s', (id) => {
    const result = parseAndValidateSceneJson(serializeSceneToJson(id, PARAMS, NOW));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.presetId).toBe(id);
  });

  it('пресет COLLISIONS експортує три тіла', () => {
    const result = parseAndValidateSceneJson(serializeSceneToJson('COLLISIONS', PARAMS, NOW));
    expect(result.ok && result.payload.bodies.length).toBe(3);
  });
});

describe('parseAndValidateSceneJson: відхилення', () => {
  it('відхиляє пошкоджений JSON та порожній рядок', () => {
    for (const raw of ['{not json', '']) {
      const result = parseAndValidateSceneJson(raw);
      expect(result).toEqual({ ok: false, error: 'Файл не є коректним JSON.' });
    }
  });

  it('відхиляє файл понад 64 КБ', () => {
    const result = parseAndValidateSceneJson('x'.repeat(MAX_IMPORT_JSON_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/завеликий/);
  });

  it.each(['null', '[]', '"str"', '42'])('відхиляє корінь, що не є об’єктом: %s', (raw) => {
    const result = parseAndValidateSceneJson(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON-об/);
  });

  const CASES: Array<[string, () => string, RegExp]> = [
    ['schemaVersion = 2', () => mutate((o) => { o.schemaVersion = 2; }), /версія схеми/],
    ['чужий app', () => mutate((o) => { o.app = 'other'; }), /іншим застосунком/],
    ['зайве поле верхнього рівня', () => mutate((o) => { o.extra = 1; }), /поля верхнього рівня/],
    ['відсутнє поле bodies', () => mutate((o) => { delete o.bodies; }), /поля верхнього рівня/],
    ['невідомий пресет', () => mutate((o) => { o.presetId = 'FOO'; }), /пресет/],
    ['некоректний exportedAt', () => mutate((o) => { o.exportedAt = 'вчора'; }), /exportedAt/],
    ['dt = 99', () => mutate((o) => { section(o, 'environment').dt = 99; }), /Крок інтегрування/],
    ['gravity рядком "NaN"', () => mutate((o) => { section(o, 'environment').gravity = 'NaN'; }), /gravity/],
    ['gravity рядком "9.81"', () => mutate((o) => { section(o, 'environment').gravity = '9.81'; }), /gravity/],
    ['gravity = 1e999 (Infinity)', () => validJson().replace('"gravity": 1.62', '"gravity": 1e999'), /gravity/],
    ['зайвий ключ у environment', () => mutate((o) => { section(o, 'environment').extra = 1; }), /environment/],
    ['відсутній ключ у presetParams', () => mutate((o) => { delete section(o, 'presetParams').initialSpeed; }), /presetParams/],
    ['маса = 0', () => mutate((o) => { firstBodyOf(o).mass = 0; }), /Маса/],
    ['від’ємна маса', () => mutate((o) => { firstBodyOf(o).mass = -5; }), /Маса/],
    ['від’ємний радіус', () => mutate((o) => { firstBodyOf(o).radius = -1; }), /Радіус/],
    ['restitution = 2', () => mutate((o) => { firstBodyOf(o).restitution = 2; }), /відновлення/],
    ['порожній bodies', () => mutate((o) => { o.bodies = []; }), /тіл/],
    [
      '21 тіло',
      () => mutate((o) => {
        const body = firstBodyOf(o);
        o.bodies = Array.from({ length: 21 }, (_, i) => ({ ...body, id: `b${i}` }));
      }),
      /тіл/,
    ],
    ['null замість тіла', () => mutate((o) => { o.bodies = [null]; }), /структуру/],
    ['зайвий ключ у тілі', () => mutate((o) => { firstBodyOf(o).force = { x: 0, y: 0 }; }), /структуру/],
    ['небезпечний label', () => mutate((o) => { firstBodyOf(o).label = '<img onerror=x>'; }), /label/],
    ['небезпечний color', () => mutate((o) => { firstBodyOf(o).color = 'red;background:url(x)'; }), /color/],
    ['id з пробілом', () => mutate((o) => { firstBodyOf(o).id = 'a b'; }), /id/],
    ['position.x рядком', () => mutate((o) => { section(firstBodyOf(o), 'position').x = '1'; }), /position/],
    [
      'дубльований id',
      () => mutate((o) => {
        const body = firstBodyOf(o);
        o.bodies = [body, { ...body }];
      }),
      /унікальними/,
    ],
  ];

  it.each(CASES)('відхиляє: %s', (_name, build, expected) => {
    const result = parseAndValidateSceneJson(build());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(expected);
  });

  it('відхиляє __proto__ на верхньому рівні й не забруднює прототип', () => {
    const raw = validJson().replace('{', '{"__proto__": {"polluted": true},');
    const result = parseAndValidateSceneJson(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/небезпечний ключ/);
    expect(({} as Obj).polluted).toBeUndefined();
  });

  it('відхиляє constructor у вкладеній секції', () => {
    const raw = mutate((o) => {
      // Прямий запис .constructor = 1 суперечить типу Function з Object, тому defineProperty
      Object.defineProperty(section(o, 'environment'), 'constructor', {
        value: 1,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    });
    const result = parseAndValidateSceneJson(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/небезпечний ключ/);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('sanitizeCsvCell', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+cmd', "'+cmd"],
    ['@evil', "'@evil"],
    ['-cmd', "'-cmd"],
    ['-1+2', "'-1+2"],
    ['+5', "'+5"],
    ['\tx', "'\tx"],
  ])('екранує формулу %j', (raw, expected) => {
    expect(sanitizeCsvCell(raw)).toBe(expected);
  });

  it('екранує провідний \\r і береться в лапки', () => {
    expect(sanitizeCsvCell('\rx')).toBe('"\'\rx"');
  });

  it('зберігає від’ємні числа без змін', () => {
    expect(sanitizeCsvCell('-9.81')).toBe('-9.81');
    expect(sanitizeCsvCell('-1e-7')).toBe('-1e-7');
    expect(sanitizeCsvCell(-9.81)).toBe('-9.81');
  });

  it('екранує коми, лапки та переноси за RFC 4180', () => {
    expect(sanitizeCsvCell('a,b')).toBe('"a,b"');
    expect(sanitizeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(sanitizeCsvCell('рядок1\nрядок2')).toBe('"рядок1\nрядок2"');
    expect(sanitizeCsvCell('=1,2')).toBe('"\'=1,2"');
  });

  it('звичайний текст і числа лишаються без змін; нескінченні числа дають порожню клітинку', () => {
    expect(sanitizeCsvCell('hello')).toBe('hello');
    expect(sanitizeCsvCell(9.81)).toBe('9.81');
    expect(sanitizeCsvCell(NaN)).toBe('');
    expect(sanitizeCsvCell(Infinity)).toBe('');
  });
});

describe('formatTelemetryToCsv', () => {
  it('порожній журнал дає лише заголовок', () => {
    const lines = formatTelemetryToCsv([]).split('\r\n');
    expect(lines).toEqual(['time_s,kinetic_energy_j,potential_energy_j,total_energy_j,fps,active_bodies', '']);
  });

  it('формує заголовок і округлені рядки з CRLF', () => {
    const csv = formatTelemetryToCsv([snap(0, 0, 80), snap(0.2, 1.23456, 10, 59.6)]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('time_s,kinetic_energy_j,potential_energy_j,total_energy_j,fps,active_bodies');
    expect(lines[1]).toBe('0,0,80,80,60,1');
    expect(lines[2]).toBe('0.2,1.2346,10,11.2346,60,1');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('нескінченні значення стають порожніми клітинками', () => {
    const lines = formatTelemetryToCsv([snap(1, NaN, 5)]).split('\r\n');
    expect(lines[1]).toBe('1,,5,,60,1');
  });
});

// ---------------------------------------------------------------------------
// Завантаження файлів
// ---------------------------------------------------------------------------

describe('buildExportFilename', () => {
  it('формує ім’я з датою й часом UTC', () => {
    expect(buildExportFilename('scene-pendulum', 'json', NOW)).toBe('scene-pendulum-20261103-101530.json');
  });
});

describe('downloadBlob', () => {
  it('клікає по <a download> і звільняє blob-URL', () => {
    vi.useFakeTimers();
    const blob = new Blob(['x'], { type: 'text/plain' });

    downloadBlob(blob, 'a.txt');

    expect(exportMocks.createObjectURL).toHaveBeenCalledWith(blob);
    expect(exportMocks.downloads).toEqual([{ filename: 'a.txt', href: 'blob:mock-url' }]);
    expect(document.querySelector('a[download]')).toBeNull();

    vi.runAllTimers();
    expect(exportMocks.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('exportCanvasToPng', () => {
  it('повертає false, якщо полотна немає', async () => {
    expect(await exportCanvasToPng(null, 'x.png')).toBe(false);
    expect(exportMocks.downloads).toHaveLength(0);
  });

  it('зберігає PNG через toBlob', async () => {
    const canvas = document.createElement('canvas');
    expect(await exportCanvasToPng(canvas, 'shot.png')).toBe(true);
    expect(exportMocks.toBlob).toHaveBeenCalled();
    expect(exportMocks.downloads[0]?.filename).toBe('shot.png');
  });

  it('якщо toBlob повернув null, використовує toDataURL', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = ((callback: BlobCallback) => callback(null)) as HTMLCanvasElement['toBlob'];
    expect(await exportCanvasToPng(canvas, 'shot.png')).toBe(true);
    expect(exportMocks.toDataURL).toHaveBeenCalledWith('image/png');
    expect(exportMocks.downloads).toHaveLength(1);
  });

  it('повертає false, якщо обидва шляхи не спрацювали', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = ((callback: BlobCallback) => callback(null)) as HTMLCanvasElement['toBlob'];
    canvas.toDataURL = (() => 'data:,') as HTMLCanvasElement['toDataURL'];
    expect(await exportCanvasToPng(canvas, 'shot.png')).toBe(false);
    expect(exportMocks.downloads).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ExportPanel в App
// ---------------------------------------------------------------------------

const BTN_JSON = 'Експортувати сцену (JSON)';
const BTN_CSV = 'Завантажити телеметрію (CSV)';
const BTN_PNG = 'Зберегти знімок (PNG)';

function openExportTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Експорт' }));
}

/** Входить у робочу область, обирає маятник і відкриває вкладку «Експорт». */
function renderWithPendulum() {
  render(<App initialProfile={TEST_PROFILE} />);
  fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
  openExportTab();
}

function importFile(content: string | BlobPart[], name = 'scene.json') {
  const input = screen.getByTestId('import-file-input');
  const file = new File(Array.isArray(content) ? content : [content], name, { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ExportPanel: доступність кнопок', () => {
  it('до вибору пресету доступний лише імпорт', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    openExportTab();

    expect(screen.getByRole('button', { name: BTN_JSON })).toBeDisabled();
    expect(screen.getByRole('button', { name: BTN_CSV })).toBeDisabled();
    expect(screen.getByRole('button', { name: BTN_PNG })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Імпортувати сцену (JSON)' })).toBeEnabled();
    expect(screen.getByTestId('export-csv-count')).toHaveTextContent('0');
  });

  it('після вибору пресету всі експорти доступні', () => {
    renderWithPendulum();
    expect(screen.getByRole('button', { name: BTN_JSON })).toBeEnabled();
    expect(screen.getByRole('button', { name: BTN_CSV })).toBeEnabled();
    expect(screen.getByRole('button', { name: BTN_PNG })).toBeEnabled();
    expect(screen.getByTestId('export-csv-count')).toHaveTextContent('1');
  });
});

describe('ExportPanel: експорт', () => {
  it('JSON: завантажує файл, який проходить власну валідацію', async () => {
    renderWithPendulum();
    fireEvent.click(screen.getByRole('button', { name: BTN_JSON }));

    expect(await screen.findByRole('status')).toHaveTextContent(/збережено/);
    expect(exportMocks.downloads[0]?.filename).toMatch(/^scene-pendulum-\d{8}-\d{6}\.json$/);

    const blob = exportMocks.createObjectURL.mock.calls[0]?.[0];
    if (!blob) throw new Error('Blob не створено');
    const parsed = parseAndValidateSceneJson(await readFileAsText(blob));
    expect(parsed.ok && parsed.presetId).toBe('PENDULUM');
  });

  it('CSV: завантажує файл із заголовком і стартовим записом', async () => {
    renderWithPendulum();
    fireEvent.click(screen.getByRole('button', { name: BTN_CSV }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Телеметрію/);
    expect(exportMocks.downloads[0]?.filename).toMatch(/^telemetry-\d{8}-\d{6}\.csv$/);

    const blob = exportMocks.createObjectURL.mock.calls[0]?.[0];
    if (!blob) throw new Error('Blob не створено');
    const lines = (await readFileAsText(blob)).split('\r\n');
    expect(lines[0]).toBe('time_s,kinetic_energy_j,potential_energy_j,total_energy_j,fps,active_bodies');
    expect(lines[1]).toMatch(/^0,/);
  });

  it('PNG: завантажує знімок полотна', async () => {
    renderWithPendulum();
    fireEvent.click(screen.getByRole('button', { name: BTN_PNG }));

    await waitFor(() => expect(exportMocks.downloads).toHaveLength(1));
    expect(exportMocks.downloads[0]?.filename).toMatch(/^snapshot-\d{8}-\d{6}\.png$/);
    expect(await screen.findByRole('status')).toHaveTextContent(/Знімок/);
  });
});

describe('ExportPanel: імпорт', () => {
  it('валідна сцена вибирає пресет, застосовує параметри й скидає в READY', async () => {
    render(<App initialProfile={TEST_PROFILE} />);
    openExportTab();

    importFile(serializeSceneToJson('COLLISIONS', { ...DEFAULT_SIMULATION_PARAMS, gravity: 3 }, NOW));

    expect(await screen.findByRole('status')).toHaveTextContent(/імпортовано/);
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('READY');
    expect(screen.getByTestId('selected-preset')).toHaveTextContent('Пружні зіткнення кульок');

    fireEvent.click(screen.getByRole('tab', { name: 'Параметри' }));
    const gravity = screen.getByLabelText(/Прискорення вільного падіння/i);
    expect(gravity).toHaveValue('3');
  });

  it('пошкоджений JSON показує помилку й не змінює стан', async () => {
    render(<App initialProfile={TEST_PROFILE} />);
    openExportTab();

    importFile('{not json');

    expect(await screen.findByRole('alert')).toHaveTextContent(/Імпорт скасовано.*JSON/);
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('IDLE');
  });

  it('файл з неправильною схемою відхиляється', async () => {
    render(<App initialProfile={TEST_PROFILE} />);
    openExportTab();

    importFile(mutate((o) => { o.schemaVersion = 2; }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/версія схеми/);
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('IDLE');
  });

  it('занадто великий файл відхиляється ще до читання', async () => {
    render(<App initialProfile={TEST_PROFILE} />);
    openExportTab();

    importFile('x'.repeat(MAX_IMPORT_JSON_BYTES + 1));

    expect(await screen.findByRole('alert')).toHaveTextContent(/завеликий/);
  });

  it('кнопка імпорту відкриває приховане поле вибору файлу', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    openExportTab();

    const input = screen.getByTestId('import-file-input');
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Імпортувати сцену (JSON)' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});