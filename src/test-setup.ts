// Підключає DOM-матчери (toBeInTheDocument, toHaveFocus...) до expect у Vitest
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { installCanvasTestEnvironment } from './__tests__/canvasMock';

// jsdom не має Canvas 2D, requestAnimationFrame-циклу та ResizeObserver: ставимо стаби
installCanvasTestEnvironment();

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});