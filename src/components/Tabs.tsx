import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Властивості універсального компонента вкладок.
 * Патерн «Візуалізація властивостей» (Render Props), Яскевич В. О. [[1]], с. 55-56:
 * компонент не знає, ЩО саме малювати, а делегує це функціям renderTitle / renderContent.
 */
export interface TabsProps<T extends string> {
  /** Ідентифікатори вкладок у порядку відображення. */
  tabIds: readonly T[];
  /** Render prop: як відобразити заголовок вкладки. */
  renderTitle: (id: T) => ReactNode;
  /** Render prop: як відобразити вміст вкладки (викликається лише для активної). */
  renderContent: (id: T) => ReactNode;
  /** Початково активна вкладка (за замовчуванням перша). */
  defaultTabId?: T;
}

export function Tabs<T extends string>({
  tabIds,
  renderTitle,
  renderContent,
  defaultTabId,
}: TabsProps<T>) {
  // Яскевич В. О. [[1]], с. 25, 56: локальний стан обраної вкладки через useState.
  // Ліниве початкове значення: defaultTabId або перший елемент.
  const [activeId, setActiveId] = useState<T | undefined>(defaultTabId ?? tabIds[0]);

  return (
    <div>
      {/* ARIA: контейнер заголовків вкладок */}
      <div role="tablist" className="mb-3 flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {/* Яскевич В. О. [[1]], с. 21-22: список із унікальним key (тут key = id вкладки) */}
        {tabIds.map((id) => {
          const isActive = id === activeId;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={isActive}
              aria-controls={`panel-${id}`}
              onClick={() => setActiveId(id)}
              className={`-mb-px rounded-t px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${
                isActive
                  ? 'border-b-2 border-sky-600 text-sky-700 dark:text-sky-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {/* Render prop для заголовка */}
              {renderTitle(id)}
            </button>
          );
        })}
      </div>

      {/* Яскевич В. О. [[1]], с. 18-19: && гарантує, що renderContent викликається ЛИШЕ для активної вкладки */}
      {activeId !== undefined && (
        <div role="tabpanel" id={`panel-${activeId}`} aria-labelledby={`tab-${activeId}`}>
          {renderContent(activeId)}
        </div>
      )}
    </div>
  );
}