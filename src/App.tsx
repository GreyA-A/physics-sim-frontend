import { useState } from 'react';
import type { SimulationStatus, PresetId } from './types/simulation';
import { PRESET_CATALOG } from './utils/presetCatalog';
import { Card } from './components/Card';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import type { SidebarTabId } from './components/WorkspaceLayout';

// Початковий стан контролера; у Issue #4 перейде під керування useReducer
const INITIAL_STATUS: SimulationStatus = 'IDLE';

function App() {
  const status: SimulationStatus = INITIAL_STATUS;

  // Яскевич В. О. [[1]], с. 25-27: useState для обраного пресету (null = нічого не обрано)
  const [selectedPreset, setSelectedPreset] = useState<PresetId | null>(null);

  // Render prop для вмісту вкладок бічної панелі
  const renderSidebarTab = (id: SidebarTabId) => {
    if (id === 'presets') {
      return (
        // Яскевич В. О. [[1]], с. 21-22: список з унікальним key={preset.id}
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
      renderSidebarTab={renderSidebarTab}
      canvasSlot={
        // Тернарний оператор: підказка до вибору пресету або назва обраного
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

export default App;