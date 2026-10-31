import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { TEST_PROFILE } from './testProfile';
import { Card } from '../components/Card';
import { Tabs } from '../components/Tabs';
import { WorkspaceLayout } from '../components/WorkspaceLayout';

describe('WorkspaceLayout', () => {
  it('рендерить усі 4 робочі зони', () => {
    render(
      <WorkspaceLayout title="Тест" status="IDLE" renderSidebarTab={() => <p>вміст</p>} />,
    );
    expect(screen.getByTestId('workspace-header')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-telemetry')).toBeInTheDocument();
  });

  it('показує слот профілю лише коли він переданий', () => {
    const { rerender } = render(
      <WorkspaceLayout title="Тест" status="IDLE" renderSidebarTab={() => null} />,
    );
    expect(screen.queryByTestId('profile-slot')).not.toBeInTheDocument();

    rerender(
      <WorkspaceLayout
        title="Тест"
        status="IDLE"
        renderSidebarTab={() => null}
        profileSlot={<span>Артур</span>}
      />,
    );
    expect(screen.getByTestId('profile-slot')).toHaveTextContent('Артур');
  });

  it('згортає та розгортає бічну панель кнопкою (мобільний режим)', () => {
    render(<WorkspaceLayout title="Тест" status="IDLE" renderSidebarTab={() => null} />);
    const toggle = screen.getByRole('button', { name: /показати або сховати панель/i });
    // Початково панель відкрита: вкладки в DOM
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    fireEvent.click(toggle);
    // Згортання виконується CSS-класом hidden, тому перевіряємо клас контейнера
    const wrapper = screen.getByRole('tablist').closest('div.hidden, div.block');
    expect(wrapper).toHaveClass('hidden');
  });
});

describe('Tabs (Render Props)', () => {
  it('перемикає вкладки кліком і ставить aria-selected', () => {
    render(
      <Tabs
        tabIds={['a', 'b'] as const}
        renderTitle={(id) => `Вкладка ${id}`}
        renderContent={(id) => <p>Вміст {id}</p>}
      />,
    );
    const tabA = screen.getByRole('tab', { name: 'Вкладка a' });
    const tabB = screen.getByRole('tab', { name: 'Вкладка b' });

    expect(tabA).toHaveAttribute('aria-selected', 'true');
    expect(tabB).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Вміст a');

    fireEvent.click(tabB);
    expect(tabA).toHaveAttribute('aria-selected', 'false');
    expect(tabB).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Вміст b');
  });

  it('викликає renderContent лише для активної вкладки', () => {
    const renderContent = vi.fn((id: string) => <p>Вміст {id}</p>);
    render(
      <Tabs tabIds={['a', 'b', 'c'] as const} renderTitle={(id) => id} renderContent={renderContent} />,
    );
    // Після першого рендера викликано лише для 'a'
    expect(renderContent).toHaveBeenCalledWith('a');
    expect(renderContent).not.toHaveBeenCalledWith('b');
    expect(renderContent).not.toHaveBeenCalledWith('c');

    fireEvent.click(screen.getByRole('tab', { name: 'c' }));
    expect(renderContent).toHaveBeenCalledWith('c');
    expect(renderContent).not.toHaveBeenCalledWith('b');
  });

  it('поважає defaultTabId', () => {
    render(
      <Tabs
        tabIds={['a', 'b'] as const}
        defaultTabId="b"
        renderTitle={(id) => id}
        renderContent={(id) => <p>Вміст {id}</p>}
      />,
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Вміст b');
  });
});

describe('Card (children + умовний рендеринг)', () => {
  it('відображає довільні дочірні елементи', () => {
    render(
      <Card>
        <p data-testid="child">Вміст</p>
      </Card>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('показує підзаголовок лише коли він переданий', () => {
    const { rerender } = render(
      <Card title="Заголовок">
        <span>x</span>
      </Card>,
    );
    expect(screen.queryByText('Підзаголовок')).not.toBeInTheDocument();

    rerender(
      <Card title="Заголовок" subtitle="Підзаголовок">
        <span>x</span>
      </Card>,
    );
    expect(screen.getByText('Підзаголовок')).toBeInTheDocument();
  });

  it('відображає headerAction', () => {
    render(
      <Card title="З" headerAction={<button type="button">Дія</button>}>
        <span>x</span>
      </Card>,
    );
    expect(screen.getByRole('button', { name: 'Дія' })).toBeInTheDocument();
  });
});

describe('Інтеграція App', () => {
  it('дозволяє обрати пресет у вкладці "Пресети"', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('button', { name: /гармонічний маятник/i }));
    expect(screen.getByTestId('selected-preset')).toHaveTextContent('Гармонічний маятник');
  });

  it('показує заглушку у вкладці "Параметри"', () => {
    render(<App initialProfile={TEST_PROFILE} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Параметри' }));
    expect(screen.getByText(/Issue #7/)).toBeInTheDocument();
  });
});