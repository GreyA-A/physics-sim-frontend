import { memo, useCallback, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ParamPatch } from '../reducers/simulationReducer';
import type { PresetId, SimulationParams } from '../types/simulation';
import { PARAM_BOUNDS, PARAM_KEYS } from '../utils/paramValidator';
import type { ParamErrors, ParamKey } from '../utils/paramValidator';
import { Button } from './Button';
import { ParamField } from './ParamField';

export interface ParameterPanelProps {
  /** Останній ВАЛІДНИЙ набір параметрів зі стану редуктора. */
  params: SimulationParams;
  /** Помилки валідації за полями. */
  validationErrors: ParamErrors;
  /** Обраний пресет або null. */
  presetId: PresetId | null;
  /** Передає патч у редуктор (стабільний useCallback у батька). */
  onUpdateParams: (patch: ParamPatch) => void;
  /** Відновлення типових значень (стабільний useCallback у батька). */
  onRestoreDefaults: () => void;
}

/** Рекомендований крок для кожного параметра (тільки для підказки). */
const FIELD_STEP: Record<ParamKey, number> = {
  gravity: 0.1,
  damping: 0.01,
  timeScale: 0.1,
  dt: 0.001,
  restitutionWall: 0.05,
  launchAngleDeg: 1,
  initialSpeed: 1,
  pendulumLength: 0.1,
  initialAngleDeg: 1,
};

/** Спільні параметри середовища. */
const ENVIRONMENT_KEYS: readonly ParamKey[] = [
  'gravity',
  'damping',
  'timeScale',
  'dt',
  'restitutionWall',
];

/** Параметри, специфічні для пресету. */
const PRESET_KEYS: Record<PresetId, readonly ParamKey[]> = {
  PROJECTILE: ['launchAngleDeg', 'initialSpeed'],
  COLLISIONS: ['initialSpeed'],
  PENDULUM: ['pendulumLength', 'initialAngleDeg'],
};

/** Якщо пресет ще не обрано, показуємо всі специфічні параметри. */
const ALL_PRESET_KEYS: readonly ParamKey[] = [
  'launchAngleDeg',
  'initialSpeed',
  'pendulumLength',
  'initialAngleDeg',
];

/** Перетворює числові параметри на рядкову чернетку для полів вводу. */
function toDraft(params: SimulationParams): Record<ParamKey, string> {
  const draft = {} as Record<ParamKey, string>;
  for (const key of PARAM_KEYS) {
    draft[key] = String(params[key]);
  }
  return draft;
}

/** Type guard: name з події - рядок, а нам потрібен ParamKey. */
function isParamKey(name: string): name is ParamKey {
  return (PARAM_KEYS as readonly string[]).includes(name);
}

/**
 * Контрольована форма параметрів.
 * React.memo (с. 36-37 [[1]]): телеметрія оновлюється кожні 200 мс і перерендерює
 * WorkspaceScreen, але панель отримує ті самі пропси й не перемальовується.
 */
export const ParameterPanel = memo(function ParameterPanel({
  params,
  validationErrors,
  presetId,
  onUpdateParams,
  onRestoreDefaults,
}: ParameterPanelProps) {
  // Чернетка рядкових значень: користувач може вводити "1." чи "-", поки значення
  // ще не є коректним числом. Початкове значення береться з params (ліниво).
  // Повернення до params при скиданні забезпечує key у батьківському компоненті.
  const [draft, setDraft] = useState<Record<ParamKey, string>>(() => toDraft(params));

  // useCallback (с. 36-37 [[1]]): стабільний колбек, тож мемоізовані ParamField
  // не отримують нову функцію на кожному рендері.
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;
      if (!isParamKey(name)) return;

      // Обчислювана властивість [e.target.name]: e.target.value (с. 57-58 [[1]]):
      // один обробник на всі поля; іммутабельне оновлення об'єкта (с. 27-28 [[1]])
      setDraft((prev) => ({ ...prev, [name]: value }));

      // Сире значення одразу йде в редуктор: він валідує ввід і за потреби
      // переводить автомат у ERROR (Issue #4)
      onUpdateParams({ [name]: value });
    },
    [onUpdateParams],
  );

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    // Enter у полі не повинен перезавантажувати сторінку (с. 16-17 [[1]])
    e.preventDefault();
  };

  /** Список полів: один key на поле (с. 21-22 [[1]]); пропси передаються явно, без {...bound}. */
  const renderFields = (keys: readonly ParamKey[]) =>
    keys.map((key) => {
      const bound = PARAM_BOUNDS[key];
      return (
        <ParamField
          key={key}
          name={key}
          label={bound.label}
          unit={bound.unit}
          min={bound.min}
          max={bound.max}
          step={FIELD_STEP[key]}
          value={draft[key]}
          error={validationErrors[key]}
          onChange={handleInputChange}
        />
      );
    });

  const presetKeys = presetId === null ? ALL_PRESET_KEYS : PRESET_KEYS[presetId];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">Середовище</legend>
        {renderFields(ENVIRONMENT_KEYS)}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">
          {/* Тернарний оператор (с. 19-20 [[1]]) */}
          {presetId === null ? 'Параметри пресетів' : 'Параметри обраного пресету'}
        </legend>
        {renderFields(presetKeys)}
      </fieldset>

      <Button onClick={onRestoreDefaults}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        <span>Відновити типові значення</span>
      </Button>
    </form>
  );
});