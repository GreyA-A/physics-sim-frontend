import { useReducer } from 'react';
import type { ResearcherProfile } from './types/simulation';
import { PRESET_CATALOG } from './utils/presetCatalog';
import { Card } from './components/Card';
import { ErrorBanner } from './components/ErrorBanner';
import { HeaderSessionBar } from './components/HeaderSessionBar';
import { QuickStartAuth } from './components/QuickStartAuth';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import type { SidebarTabId } from './components/WorkspaceLayout';
import { SessionProvider, useSession } from './context/SessionContext';
import {
  actionCreators,
  initialSimulationState,
  simulationReducer,
} from './reducers/simulationReducer';

/**
 * Робоча область для авторизованого дослідника.
 * Окремий компонент: при виході він розмонтовується, і стан симуляції
 * не «просочується» до наступного користувача.
 */
function WorkspaceScreen() {
  // useReducer (с. 28, 31 [[1]]): стан автомата змінюється лише через dispatch(дія)
  const [simState, dispatch] = useReducer(simulationReducer, initialSimulationState);
  const { status, selectedPreset, errorMessage, validationErrors } = simState;

  const isPaused = status === 'PAUSED';
  const selectedMeta = PRESET_CATALOG.find((preset) => preset.id === selectedPreset);

  // Кнопка "Старт" у стані PAUSED працює як "Продовжити"
  const handleStartOrResume = () =>
    dispatch(isPaused ? actionCreators.resume() : actionCreators.start());

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
                  onClick={() => dispatch(actionCreators.selectPreset(preset.id))}
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

  // Слот полотна потрібен, якщо є що показати: помилка або обраний пресет
  const hasCanvasContent = status === 'ERROR' || selectedMeta !== undefined;

  return (
    <WorkspaceLayout
      title="Симуляція фізичних процесів"
      status={status}
      profileSlot={<HeaderSessionBar />}
      renderSidebarTab={renderSidebarTab}
      // Доступність кнопок виводиться зі стану автомата
      canStart={status === 'READY' || status === 'PAUSED'}
      canPause={status === 'RUNNING'}
      canReset={status !== 'IDLE'}
      startLabel={isPaused ? 'Продовжити' : 'Старт'}
      onStartOrResume={handleStartOrResume}
      onPause={() => dispatch(actionCreators.pause())}
      onReset={() => dispatch(actionCreators.reset())}
      canvasSlot={
        hasCanvasContent ? (
          <div className="space-y-3">
            {/* с. 18-19 [[1]]: блок помилки лише у стані ERROR */}
            {status === 'ERROR' && errorMessage !== null && (
              <ErrorBanner
                message={errorMessage}
                details={Object.values(validationErrors).filter(
                  (message): message is string => typeof message === 'string',
                )}
              />
            )}
            {selectedMeta !== undefined && (
              <Card className="border-dashed">
                <p className="text-sm">
                  Обрано пресет:{' '}
                  <strong data-testid="selected-preset">{selectedMeta.title}</strong>
                </p>
              </Card>
            )}
          </div>
        ) : undefined
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