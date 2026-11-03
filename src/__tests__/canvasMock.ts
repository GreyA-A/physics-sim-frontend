import { vi } from 'vitest';

/**
 * jsdom не реалізує CanvasRenderingContext2D, тому тести працюють зі стабом.
 * Усі методи - vi.fn(), тож тести перевіряють кількість і аргументи викликів.
 * fillStyle записує історію присвоєнь (для перевірки кольору фону за темою).
 */
export function createMockContext2D() {
  const fillStyleHistory: string[] = [];
  let currentFillStyle = '';

  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: '' as string,
    lineWidth: 1,
    font: '',
    textAlign: 'start' as string,
    textBaseline: 'alphabetic' as string,
    globalAlpha: 1,
    get fillStyle(): string {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      fillStyleHistory.push(value);
    },
    fillStyleHistory,
  };
}

export type MockContext2D = ReturnType<typeof createMockContext2D>;

// Один контекст на один <canvas>, як у справжньому браузері
const contexts = new WeakMap<HTMLCanvasElement, MockContext2D>();

/** Повертає (або створює) мок-контекст конкретного полотна. */
export function getMockContext(canvas: HTMLCanvasElement): MockContext2D {
  let context = contexts.get(canvas);
  if (!context) {
    context = createMockContext2D();
    contexts.set(canvas, context);
  }
  return context;
}

// ---------------------------------------------------------------------------
// Стаби для експорту файлів (Issue #9)
// ---------------------------------------------------------------------------

/** Записи про «завантаження»: ім'я файлу та href посилання, по якому клікнули. */
const downloads: { filename: string; href: string }[] = [];

/**
 * jsdom не вміє навігацію для <a download> і не має URL.createObjectURL / toBlob.
 * exportMocks дозволяє тестам перевірити, що саме було «завантажено».
 */
export const exportMocks = {
  createObjectURL: vi.fn<(blob: Blob) => string>(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn<(url: string) => void>(),
  toBlob: vi.fn((callback: BlobCallback, type?: string) => {
    callback(new Blob(['png-bytes'], { type: type ?? 'image/png' }));
  }),
  toDataURL: vi.fn(() => 'data:image/png;base64,iVBORw0KGgo='),
  anchorClick: vi.fn(function (this: HTMLAnchorElement) {
    downloads.push({ filename: this.download, href: this.href });
  }),
  downloads,
};

/**
 * Встановлює безпечне тестове середовище:
 *  - getContext('2d') повертає мок;
 *  - requestAnimationFrame / cancelAnimationFrame нічого не запускають
 *    (цикл кадрів у тестах не стартує, поки тест сам не підмінить їх);
 *  - ResizeObserver - порожня заглушка;
 *  - URL.createObjectURL / revokeObjectURL, canvas.toBlob / toDataURL та клік
 *    по <a> замінено стабами; лічильники exportMocks скидаються.
 * Викликається з test-setup.ts та повторно після тестів, що підміняють ці API.
 */
export function installCanvasTestEnvironment(): void {
  const getContext = function (this: HTMLCanvasElement, contextId: string) {
    return contextId === '2d' ? (getMockContext(this) as unknown as CanvasRenderingContext2D) : null;
  };
  HTMLCanvasElement.prototype.getContext = getContext as unknown as HTMLCanvasElement['getContext'];

  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );

  exportMocks.createObjectURL.mockClear();
  exportMocks.revokeObjectURL.mockClear();
  exportMocks.toBlob.mockClear();
  exportMocks.toDataURL.mockClear();
  exportMocks.anchorClick.mockClear();
  downloads.length = 0;

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: exportMocks.createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: exportMocks.revokeObjectURL,
  });
  HTMLCanvasElement.prototype.toBlob = exportMocks.toBlob as unknown as HTMLCanvasElement['toBlob'];
  HTMLCanvasElement.prototype.toDataURL =
    exportMocks.toDataURL as unknown as HTMLCanvasElement['toDataURL'];
  HTMLAnchorElement.prototype.click = exportMocks.anchorClick as unknown as () => void;
}