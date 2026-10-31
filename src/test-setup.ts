// Підключає DOM-матчери (toBeInTheDocument, toHaveFocus...) до expect у Vitest
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});