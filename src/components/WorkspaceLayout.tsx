import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { Pause, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { SimulationStatus } from '../types/simulation';
import { Button } from './Button';
import { Card } from './Card';
import { Tabs } from './Tabs';

/** Ідентифікатори вкладок бічної панелі. */
export type SidebarTabId = 'presets' | 'params' | 'export';

const SIDEBAR_TABS: readonly SidebarTabId[] = ['presets', 'params', 'export'];

const TAB_LABELS: Record<SidebarTabId, string> = {
  presets: 'Пресети',
  params: 'Параметри',
  export: 'Експорт',
};

export interface WorkspaceLayoutProps {
  /** Назва застосунку в шапці. */
  title: string;
  /** Поточний стан контролера симуляції. */
  status: SimulationStatus;
  /** Слот під профіль/тему (Issue #3). */
  profileSlot?: ReactNode;
  /** Render prop для вмісту вкладок бічної панелі. */
  renderSidebarTab: (id: SidebarTabId) => ReactNode;
  /** Слот під HTML5 Canvas (Issue #6). */
  canvasSlot?: ReactNode;
  /** Слот під телеметрію (Issue #8). */
  telemetrySlot?: ReactNode;
  /** Кнопка "Старт" / "Продовжити". */
  onStartOrResume?: () => void;
  onPause?: () => void;
  onReset?: () => void;
  /**
   * Прапорці доступності кнопок. За замовчуванням false, тому без цих пропсів
   * усі кнопки неактивні (зворотна сумісність із попередніми тестами).
   */
  canStart?: boolean;
  canPause?: boolean;
  canReset?: boolean;
  /** Напис першої кнопки: "Старт" або "Продовжити". */
  startLabel?: string;
}

// Стилі бейджа статусу за станом автомата
const STATUS_CLASSES: Record<SimulationStatus, string> = {
  IDLE: 'bg-slate-200 text-slate-700',
  READY: 'bg-sky-200 text-sky-800',
  RUNNING: 'bg-emerald-200 text-emerald-800',
  PAUSED: 'bg-amber-200 text-amber-800',
  ERROR: 'bg-rose-200 text-rose-800',
};

export function WorkspaceLayout({
  title,
  status,
  profileSlot,
  renderSidebarTab,
  canvasSlot,
  telemetrySlot,
  onStartOrResume,
  onPause,
  onReset,
  canStart = false,
  canPause = false,
  canReset = false,
  startLabel = 'Старт',
}: WorkspaceLayoutProps) {
  // Стан згортання бічної панелі; діє лише на мобільних (на md+ панель завжди видима)
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    // Яскевич В. О. [[1]], с. 50-51: повний синтаксис React.Fragment
    <React.Fragment>
      {/* ---------- Зона 1: верхня панель ---------- */}
      <header
        data-testid="workspace-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700"
      >
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold sm:text-lg">{title}</h1>
          <span
            data-testid="simulation-status"
            className={`rounded px-2 py-0.5 font-mono text-xs ${STATUS_CLASSES[status]}`}
          >
            {status}
          </span>
        </div>
        {/* Яскевич В. О. [[1]], с. 50-51: скорочений синтаксис <>...</> без зайвого вузла DOM */}
        <>
          <div className="flex items-center gap-2">
            {/* Слот профілю/теми з'являється лише коли переданий (Issue #3) */}
            {profileSlot && <div data-testid="profile-slot">{profileSlot}</div>}
          </div>
        </>
      </header>

      {/*
        Адаптивна сітка:
        - мобільні: 1 колонка;
        - md: 2 колонки (сайдбар + canvas), телеметрія на всю ширину нижче;
        - xl: 3 колонки (сайдбар | canvas | телеметрія).
      */}
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[18rem_1fr] xl:grid-cols-[20rem_1fr_18rem]">
        {/* ---------- Зона 2: бічна панель керування ---------- */}
        <aside data-testid="workspace-sidebar" className="space-y-2">
          {/* Кнопка згортання видима лише на мобільних (md:hidden) */}
          <div className="md:hidden">
            <Button
              variant="secondary"
              ariaLabel="Показати або сховати панель керування"
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              <span>{sidebarOpen ? 'Сховати панель' : 'Показати панель'}</span>
            </Button>
          </div>
          {/* На мобільних видимість залежить від стану, на md+ панель завжди показана */}
          <div className={`${sidebarOpen ? 'block' : 'hidden'} md:block`}>
            <Card title="Керування" subtitle="Пресети, параметри, експорт">
              <Tabs<SidebarTabId>
                tabIds={SIDEBAR_TABS}
                renderTitle={(id) => TAB_LABELS[id]}
                renderContent={renderSidebarTab}
                defaultTabId="presets"
              />
            </Card>
          </div>
        </aside>

        {/* ---------- Зона 3: візуалізація ---------- */}
        <main data-testid="workspace-canvas" className="space-y-3">
          <Card
            title="Полотно симуляції"
            headerAction={
              // flex-wrap: кнопки переносяться на вузьких екранах (360 px)
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  ariaLabel={startLabel}
                  disabled={!canStart}
                  onClick={onStartOrResume}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  <span>{startLabel}</span>
                </Button>
                <Button ariaLabel="Пауза" disabled={!canPause} onClick={onPause}>
                  <Pause className="h-4 w-4" aria-hidden="true" />
                  <span>Пауза</span>
                </Button>
                <Button ariaLabel="Скидання" disabled={!canReset} onClick={onReset}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>Скидання</span>
                </Button>
              </div>
            }
          >
            {/* Тернарний оператор: або реальний вміст, або плейсхолдер сітки */}
            {canvasSlot ? (
              canvasSlot
            ) : (
              <div
                className="flex aspect-video w-full items-center justify-center rounded border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(148,163,184,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              >
                Тут буде HTML5 Canvas (Issue #6)
              </div>
            )}
          </Card>
        </main>

        {/* ---------- Зона 4: телеметрія ---------- */}
        <section data-testid="workspace-telemetry" className="md:col-span-2 xl:col-span-1">
          <Card title="Телеметрія" subtitle="Час, FPS, енергія">
            {telemetrySlot ?? (
              <dl className="grid grid-cols-3 gap-2 text-sm xl:grid-cols-1">
                <div>
                  <dt className="text-xs text-slate-500">Час, с</dt>
                  <dd className="font-mono">0.00</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">FPS</dt>
                  <dd className="font-mono">-</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">E, Дж</dt>
                  <dd className="font-mono">-</dd>
                </div>
              </dl>
            )}
          </Card>
        </section>
      </div>
    </React.Fragment>
  );
}