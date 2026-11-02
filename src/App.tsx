import { useCallback, useReducer, useState } from 'react';
import type { ResearcherProfile, TelemetrySnapshot } from './types/simulation';
import { PRESET_CATALOG } from './utils/presetCatalog';
import { DEFAULT_SIMULATION_PARAMS } from './utils/paramValidator';
import { ErrorBanner } from './components/ErrorBanner';
import { HeaderSessionBar } from './components/HeaderSessionBar';
import { LiveTelemetry } from './components/LiveTelemetry';
import { ParameterPanel } from './components/ParameterPanel';
import { QuickStartAuth } from './components/QuickStartAuth';
import { SimulationCanvas } from './components/SimulationCanvas';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import type { SidebarTabId } from './components/WorkspaceLayout';
import { SessionProvider, useSession } from './context/SessionContext';
import { useWorkspaceHotkeys } from './hooks/useWorkspaceHotkeys';
import {
  actionCreators,
  initialSimulationState,
  simulationReducer,
} from './reducers/simulationReducer';
import type { ParamPatch } from './reducers/simulationReducer';

/**
 * Робоча область для авторизованого дослідника.
 * Окремий компонент: при виході він розмонтовується, і стан симуляції
 * не «просочується» до наступного користувача.
 */
function WorkspaceScreen() {
  // useReducer (с. 28, 31 [[1]]): стан автомата змінюється лише через dispatch(дія)
  const [simState, dispatch] = useReducer(simulationReducer, initialSimulationState);
  const { status, selectedPreset, errorMessage, validationErrors, params } = simState;

  // Тема з контексту (useContext, с. 41-44 [[1]])
  const { theme } = useSession();

  // Лічильник скидань: змушує Canvas перестворити сцену, а панель параметрів
  // (через key) заново прочитати params у чернетку
  const [resetVersion, setResetVersion] = useState(0);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);

  // useCallback (с. 36-37 [[1]]): стабільні посилання на колбеки, що йдуть у
  // мемоізовані дочірні компоненти. dispatch і set-функції стабільні за гарантією React.
  const handleTelemetry = useCallback((snapshot: TelemetrySnapshot) => setTelemetry(snapshot), []);

  const handleDiverged = useCallback(
    (message: string) => dispatch(actionCreators.setError(message)),
    [],
  );

  // Кнопка "Старт" у стані PAUSED працює як "Продовжити": колбек залежить від status
  const handleStartOrResume = useCallback(() => {
    dispatch(status === 'PAUSED' ? actionCreators.resume() : actionCreators.start());
  }, [status]);

  const handlePause = useCallback(() => dispatch(actionCreators.pause()), []);

  const handleReset = useCallback(() => {
    dispatch(actionCreators.reset());
    setResetVersion((version) => version + 1);
  }, []);

  const handleUpdateParams = useCallback(
    (patch: ParamPatch) => dispatch(actionCreators.updateParams(patch)),
    [],
  );

  const handleRestoreDefaults = useCallback(() => {
    dispatch(actionCreators.updateParams({ ...DEFAULT_SIMULATION_PARAMS }));
    setResetVersion((version) => version + 1);
  }, []);

  // Глобальні гарячі клавіші: Space, R
  useWorkspaceHotkeys({
    status,
    onStartOrResume: handleStartOrResume,
    onPause: handlePause,
    onReset: handleReset,
  });

  const isPaused = status === 'PAUSED';
  const selectedMeta = PRESET_CATALOG.find((preset) => preset.id === selectedPreset);

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

    if (id === 'params') {
      return (
        <ParameterPanel
          // key: після скидання, відновлення типових значень або зміни пресету
          // панель перемонтується й чернетка знову збігається з params
          key={`${selectedPreset ?? 'none'}-${resetVersion}`}
          params={params}
          validationErrors={validationErrors}
          presetId={selectedPreset}
          onUpdateParams={handleUpdateParams}
          onRestoreDefaults={handleRestoreDefaults}
        />
      );
    }

    // Заглушка для Issue #9
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
      onPause={handlePause}
      onReset={handleReset}
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
            {selectedMeta !== undefined && selectedPreset !== null && (
              <>
                <p className="text-sm">
                  Обрано пресет:{' '}
                  <strong data-testid="selected-preset">{selectedMeta.title}</strong>
                </p>
                <SimulationCanvas
                  presetId={selectedPreset}
                  params={params}
                  status={status}
                  theme={theme}
                  resetVersion={resetVersion}
                  onTelemetryUpdate={handleTelemetry}
                  onSimulationDiverged={handleDiverged}
                />
                {/* Підказка про гарячі клавіші (UX) */}
                <p
                  data-testid="hotkeys-hint"
                  className="text-xs text-slate-500 dark:text-slate-400"
                >
                  Гарячі клавіші:{' '}
                  <kbd className="rounded border border-slate-300 px-1 font-mono dark:border-slate-600">
                    Space
                  </kbd>{' '}
                  - старт / пауза,{' '}
                  <kbd className="rounded border border-slate-300 px-1 font-mono dark:border-slate-600">
                    R
                  </kbd>{' '}
                  - скидання (не працюють під час вводу в полі).
                </p>
              </>
            )}
          </div>
        ) : undefined
      }
      // Живі значення лише коли пресет обрано; інакше показується типова заглушка Layout
      telemetrySlot={
        selectedPreset !== null ? (
          <LiveTelemetry telemetry={telemetry} isRunning={status === 'RUNNING'} />
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