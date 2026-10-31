import type { PresetId, SimulationParams, SimulationStatus } from '../types/simulation';
import {
  DEFAULT_SIMULATION_PARAMS,
  PARAM_BOUNDS,
  validateSimulationParams,
} from '../utils/paramValidator';
import type { ParamErrors, ParamKey } from '../utils/paramValidator';

/**
 * Скінченний автомат контролера симуляції на основі useReducer.
 * Шаблон Яскевич В. О. [[1]], с. 28-31: об'єкт констант `types`, об'єкт фабрик
 * `actionCreators`, чиста функція `reducer(state, action)`; дія має форму { type, payload }.
 */

// ---------------------------------------------------------------------------
// Стан
// ---------------------------------------------------------------------------

export interface SimulationState {
  /** Поточний стан автомата. */
  status: SimulationStatus;
  /** Обраний пресет або null. */
  selectedPreset: PresetId | null;
  /** Останній ВАЛІДНИЙ набір параметрів (невалідні сюди не потрапляють). */
  params: SimulationParams;
  /** Помилки валідації за полями (для підсвітки у формі, Issue #7). */
  validationErrors: ParamErrors;
  /** Загальне повідомлення про помилку для стану ERROR. */
  errorMessage: string | null;
}

export const initialSimulationState: SimulationState = {
  status: 'IDLE',
  selectedPreset: null,
  params: { ...DEFAULT_SIMULATION_PARAMS },
  validationErrors: {},
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// Типи дій (с. 30-31 [[1]])
// ---------------------------------------------------------------------------

/** Константи типів дій; `as const` дає літеральні типи замість string. */
export const types = {
  SELECT_PRESET: 'SELECT_PRESET',
  START: 'START',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  RESET: 'RESET',
  UPDATE_PARAMS: 'UPDATE_PARAMS',
  SET_ERROR: 'SET_ERROR',
} as const;

/** Патч параметрів: значення довільні (unknown), бо з форм приходять рядки. */
export type ParamPatch = Partial<Record<ParamKey, unknown>>;

/** Дискримінований union усіх дій: компілятор знає тип payload у кожній гілці switch. */
export type SimulationAction =
  | { type: typeof types.SELECT_PRESET; payload: PresetId }
  | { type: typeof types.START }
  | { type: typeof types.PAUSE }
  | { type: typeof types.RESUME }
  | { type: typeof types.RESET }
  | { type: typeof types.UPDATE_PARAMS; payload: ParamPatch }
  | { type: typeof types.SET_ERROR; payload: string };

/** Фабрики дій (с. 30-31 [[1]]): єдине місце, де формується структура дії. */
export const actionCreators = {
  selectPreset: (presetId: PresetId): SimulationAction => ({
    type: types.SELECT_PRESET,
    payload: presetId,
  }),
  start: (): SimulationAction => ({ type: types.START }),
  pause: (): SimulationAction => ({ type: types.PAUSE }),
  resume: (): SimulationAction => ({ type: types.RESUME }),
  reset: (): SimulationAction => ({ type: types.RESET }),
  updateParams: (patch: ParamPatch): SimulationAction => ({
    type: types.UPDATE_PARAMS,
    payload: patch,
  }),
  setError: (message: string): SimulationAction => ({ type: types.SET_ERROR, payload: message }),
};

// ---------------------------------------------------------------------------
// Допоміжні функції
// ---------------------------------------------------------------------------

/** Верхня межа довжини повідомлення, щоб довільний текст не роздував інтерфейс. */
const MAX_ERROR_MESSAGE_LENGTH = 300;

/** Куди повертаємось зі стану помилки/скидання: READY, якщо пресет обрано, інакше IDLE. */
function restingStatus(state: SimulationState): SimulationStatus {
  return state.selectedPreset !== null ? 'READY' : 'IDLE';
}

/** Загальне повідомлення про помилки валідації (перелік назв полів). */
function describeValidationErrors(errors: ParamErrors): string {
  const labels = (Object.keys(errors) as ParamKey[]).map((key) => PARAM_BOUNDS[key].label);
  return `Некоректні параметри: ${labels.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Редуктор (с. 28-31 [[1]])
// ---------------------------------------------------------------------------

/**
 * Чиста функція: (state, action) -> новий state. Без побічних ефектів і винятків.
 * Недопустимий перехід повертає ТОЙ САМИЙ об'єкт state, тому React не перерендерюється.
 *
 * Таблиця переходів (для Діаграми станів, Розділ 1):
 *  SELECT_PRESET : будь-який -> READY
 *  START         : READY     -> RUNNING
 *  PAUSE         : RUNNING   -> PAUSED
 *  RESUME        : PAUSED    -> RUNNING
 *  RESET         : будь-який -> READY (пресет обрано) або IDLE (пресету немає)
 *  UPDATE_PARAMS : валідні   -> статус зберігається (ERROR -> READY/IDLE);
 *                  невалідні -> ERROR
 *  SET_ERROR     : будь-який -> ERROR
 */
export function simulationReducer(state: SimulationState, action: SimulationAction): SimulationState {
  switch (action.type) {
    case types.SELECT_PRESET: {
      // Якщо поточні параметри чомусь невалідні, відновлюємо значення за замовчуванням
      const paramsAreValid = validateSimulationParams(state.params).valid;
      return {
        ...state,
        status: 'READY',
        selectedPreset: action.payload,
        params: paramsAreValid ? state.params : { ...DEFAULT_SIMULATION_PARAMS },
        validationErrors: {},
        errorMessage: null,
      };
    }

    case types.START:
      return state.status === 'READY' ? { ...state, status: 'RUNNING' } : state;

    case types.PAUSE:
      return state.status === 'RUNNING' ? { ...state, status: 'PAUSED' } : state;

    case types.RESUME:
      return state.status === 'PAUSED' ? { ...state, status: 'RUNNING' } : state;

    case types.RESET:
      return {
        ...state,
        status: restingStatus(state),
        params: { ...DEFAULT_SIMULATION_PARAMS },
        validationErrors: {},
        errorMessage: null,
      };

    case types.UPDATE_PARAMS: {
      // Патч накладається на поточні параметри, і ПОВНИЙ набір проходить валідацію
      const result = validateSimulationParams({ ...state.params, ...action.payload });

      if (result.valid) {
        return {
          ...state,
          status: state.status === 'ERROR' ? restingStatus(state) : state.status,
          params: result.params,
          validationErrors: {},
          errorMessage: null,
        };
      }

      // params НЕ змінюємо: у стані лишається останній валідний набір
      return {
        ...state,
        status: 'ERROR',
        validationErrors: result.errors,
        errorMessage: describeValidationErrors(result.errors),
      };
    }

    case types.SET_ERROR:
      return {
        ...state,
        status: 'ERROR',
        validationErrors: {},
        errorMessage: action.payload.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      };

    default:
      // Невідома дія (наприклад, з іншого редуктора): стан не змінюється
      return state;
  }
}