import { useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { Download, Upload } from 'lucide-react';
import type { PresetId, SimulationParams, TelemetrySnapshot } from '../types/simulation';
import {
  MAX_IMPORT_JSON_BYTES,
  buildExportFilename,
  downloadBlob,
  exportCanvasToPng,
  formatTelemetryToCsv,
  parseAndValidateSceneJson,
  readFileAsText,
  serializeSceneToJson,
} from '../utils/exportService';
import { PRESET_CATALOG } from '../utils/presetCatalog';
import { Button } from './Button';

export interface ExportPanelProps {
  /** Обраний пресет або null. */
  presetId: PresetId | null;
  /** Останній валідний набір параметрів. */
  params: SimulationParams;
  /** Журнал телеметрії (джерело для CSV). */
  telemetryLog: readonly TelemetrySnapshot[];
  /** Ref на <canvas> (PNG-знімок); заповнюється в SimulationCanvas. */
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Викликається після успішного імпорту. */
  onImportScene: (presetId: PresetId, params: SimulationParams) => void;
}

/** Результат останньої операції: успіх -> role="status", помилка -> role="alert". */
interface OperationMessage {
  kind: 'success' | 'error';
  text: string;
}

/** Крок 3 User Guide: «Збереження / Експорт». */
export function ExportPanel({
  presetId,
  params,
  telemetryLog,
  canvasRef,
  onImportScene,
}: ExportPanelProps) {
  const [message, setMessage] = useState<OperationMessage | null>(null);

  // useRef, СЦЕНАРІЙ 1 (с. 40 [[1]]), крок 1: посилання на прихований <input type="file">.
  // Крок 2 - атрибут ref у JSX нижче. Крок 3 - fileInputRef.current?.click() в обробнику.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasPreset = presetId !== null;

  const handleExportJson = () => {
    if (presetId === null) return;
    try {
      const json = serializeSceneToJson(presetId, params);
      const filename = buildExportFilename(`scene-${presetId.toLowerCase()}`, 'json');
      downloadBlob(new Blob([json], { type: 'application/json' }), filename);
      setMessage({ kind: 'success', text: `Сцену збережено у файл ${filename}.` });
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося створити файл сцени.' });
    }
  };

  const handleExportCsv = () => {
    if (telemetryLog.length === 0) return;
    try {
      const csv = formatTelemetryToCsv(telemetryLog);
      const filename = buildExportFilename('telemetry', 'csv');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
      setMessage({
        kind: 'success',
        text: `Телеметрію (${telemetryLog.length} зап.) збережено у файл ${filename}.`,
      });
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося створити файл телеметрії.' });
    }
  };

  const handleExportPng = async () => {
    const filename = buildExportFilename('snapshot', 'png');
    const saved = await exportCanvasToPng(canvasRef.current, filename);
    setMessage(
      saved
        ? { kind: 'success', text: `Знімок полотна збережено у файл ${filename}.` }
        : { kind: 'error', text: 'Не вдалося зберегти знімок: полотно недоступне.' },
    );
  };

  /** Крок 3 (с. 40 [[1]]): програмний клік по прихованому полю вибору файлу. */
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    // Скидаємо значення, щоб той самий файл можна було вибрати повторно
    input.value = '';
    if (!file) return;

    // Перевірка розміру ДО читання: гігабайтний файл не потрапляє в пам'ять
    if (file.size > MAX_IMPORT_JSON_BYTES) {
      setMessage({
        kind: 'error',
        text: `Файл завеликий (максимум ${MAX_IMPORT_JSON_BYTES / 1024} КБ).`,
      });
      return;
    }

    try {
      const result = parseAndValidateSceneJson(await readFileAsText(file));
      if (!result.ok) {
        setMessage({ kind: 'error', text: `Імпорт скасовано: ${result.error}` });
        return;
      }
      onImportScene(result.presetId, result.params);
      const title = PRESET_CATALOG.find((preset) => preset.id === result.presetId)?.title;
      setMessage({ kind: 'success', text: `Сцену імпортовано: ${title ?? result.presetId}.` });
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося прочитати файл.' });
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Конфігурація сцени (JSON)</h3>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExportJson} disabled={!hasPreset}>
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Експортувати сцену (JSON)</span>
          </Button>
          <Button onClick={handleImportClick}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Імпортувати сцену (JSON)</span>
          </Button>
        </div>
        {/* Крок 2 (с. 40 [[1]]): прив'язка ref до прихованого поля вибору файлу */}
        <input
          ref={fileInputRef}
          data-testid="import-file-input"
          type="file"
          accept=".json,application/json"
          aria-label="Файл сцени (JSON)"
          tabIndex={-1}
          className="hidden"
          onChange={(e) => {
            void handleFileChange(e);
          }}
        />
        {/* && (с. 18-19 [[1]]): підказка лише без пресету */}
        {!hasPreset && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Оберіть пресет, щоб експортувати сцену.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Журнал телеметрії (CSV)</h3>
        <Button onClick={handleExportCsv} disabled={telemetryLog.length === 0}>
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>Завантажити телеметрію (CSV)</span>
        </Button>
        <p data-testid="export-csv-count" className="text-xs text-slate-500 dark:text-slate-400">
          Доступно записів: {telemetryLog.length}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Знімок полотна (PNG)</h3>
        <Button
          onClick={() => {
            void handleExportPng();
          }}
          disabled={!hasPreset}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>Зберегти знімок (PNG)</span>
        </Button>
      </section>

      {/* Умовний рендеринг статусу операції (с. 18-19 [[1]]) */}
      {message !== null &&
        (message.kind === 'error' ? (
          <p
            role="alert"
            className="rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100"
          >
            {message.text}
          </p>
        ) : (
          <p
            role="status"
            className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
          >
            {message.text}
          </p>
        ))}
    </div>
  );
}