import { useState } from 'react';
import type { SimulationStatus, PresetId, ResearcherProfile } from './types/simulation';
import { PRESET_CATALOG } from './utils/presetCatalog';
import { Card } from './components/Card';
import { HeaderSessionBar } from './components/HeaderSessionBar';
import { QuickStartAuth } from './components/QuickStartAuth';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import type { SidebarTabId } from './components/WorkspaceLayout';
import { SessionProvider, useSession } from './context/SessionContext';

// Початковий стан контролера; у Issue #4 перейде під керування useReducer
const INITIAL_STATUS: SimulationStatus = 'IDLE';

/**
 * Робоча область для авторизованого дослідника.
 * Окремий компонент: при виході він розмонтовується, і локальний стан
 * (обраний пресет) не «просочується» до наступного користувача.
 */
function WorkspaceScreen() {
  const status: SimulationStatus = INITIAL_STATUS;

  // useState (с. 25-27 [[1]]): обраний пресет (null = нічого не обрано)
  const [selectedPreset, setSelectedPreset] = useState<PresetId | null>(null);

  // Render prop для вмісту вкладок бічної панелі
  const renderSidebarTab = (id: SidebarTabId) => {
    if (id === 'presets') {
      return (
        // Список із унікальним key={preset.id} (с. 21-22 [[1]])
        <ul className="space-y-2">
          {PRESET_CATALOG.map((preset) => {
            const isSelected = preset.id === selectedPreset;
            return (
              <li key={preset.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${
                    isSelected
                      ? 'border-sky-600 bg-sky-50 dark:bg-sky-950'
                      : 'border-slate-200 hover:border-slate-400 dark:border-slate-700'
                  }`}
                >
                  <span className="block text-sm font-medium">{preset.title}</span>
                  <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">
                    {preset.description}
                  </span>
                  <code className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    {preset.keyFormula}
                  </code>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }

    // Заглушки для наступних Issues
    if (id === 'params') {
      return (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Панель параметрів з'явиться в Issue #7.
        </p>
      );
    }
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Експорт JSON, CSV та PNG з'явиться в Issue #9.
      </p>
    );
  };

  return (
    <WorkspaceLayout
      title="Симуляція фізичних процесів"
      status={status}
      // Слот профілю: HeaderSessionBar сам бере дані з контексту, пропси не потрібні
      profileSlot={<HeaderSessionBar />}
      renderSidebarTab={renderSidebarTab}
      canvasSlot={
        selectedPreset === null ? undefined : (
          <Card className="border-dashed">
            <p className="text-sm">
              Обрано пресет:{' '}
              <strong data-testid="selected-preset">
                {PRESET_CATALOG.find((p) => p.id === selectedPreset)?.title}
              </strong>
            </p>
          </Card>
        )
      }
    />
  );
}

/** Вибір екрана за станом сесії (умовний рендеринг, с. 19-20 [[1]]). */
function AppContent() {
  const { profile } = useSession();
  return profile === null ? <QuickStartAuth /> : <WorkspaceScreen />;
}

export interface AppProps {
  /** Початковий профіль для тестів: null = гість, undefined = прочитати localStorage. */
  initialProfile?: ResearcherProfile | null;
}

function App({ initialProfile }: AppProps) {
  return (
    <SessionProvider initialProfile={initialProfile}>
      <AppContent />
    </SessionProvider>
  );
}

export default App;