// Імпорт defineConfig саме з "vitest/config", щоб TypeScript знав про поле `test`
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom емулює DOM у Node, потрібний для тестування React-компонентів
    environment: 'jsdom',
    // describe/it/expect доступні глобально (узгоджено з "vitest/globals" у tsconfig)
    globals: true,
    // Файл підключає матчери jest-dom (toBeInTheDocument тощо)
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/test-setup.ts', 'src/__tests__/**'],
    },
  },
});