import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { PRESET_CATALOG } from '../utils/presetCatalog';

describe('Smoke-тест каркаса застосунку', () => {
  it('відображає заголовок проєкту', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /симуляція фізичних процесів/i,
    );
  });

  it('показує початковий статус IDLE', () => {
    render(<App />);
    expect(screen.getByTestId('simulation-status')).toHaveTextContent('IDLE');
  });

  it('виводить рівно 3 пресети з унікальними id', () => {
    render(<App />);
    // Пресети відображаються як кнопки aria-pressed у вкладці "Пресети"
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(3);

    // Унікальність id важлива, бо вони використовуються як React key
    const ids = PRESET_CATALOG.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});