'use client'

import { useMemo, useState } from 'react'
import { Plus, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'

function formatMoney(v: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

type SortKey = 'name' | 'earned' | 'profit' | 'projects'

interface Props {
  editors: EditorProfileListItemDTO[]
  onOpenEditor: (id: string) => void
  onCreateEditor: () => void
}

// Вынесено на уровень модуля — компонент не должен создаваться заново при
// каждом рендере родителя (см. правило react-hooks/static-components).
function SortButton({ column, label, active, dir, onToggle }: {
  column: SortKey; label: string; active: boolean; dir: 'asc' | 'desc'; onToggle: (column: SortKey) => void
}) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <button type="button" onClick={() => onToggle(column)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
      {label} <Icon className="w-3 h-3" />
    </button>
  )
}

// Список монтажёров, отсортированный по любой из финансовых колонок,
// одновременно служит "рейтингом монтажёров" (ТЗ п.13) — отдельный график не
// заводим, сортировка по прибыли/заработку даёт тот же результат без
// дублирующего виджета на дашборде.
export default function EditorsPanel({ editors, onOpenEditor, onCreateEditor }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('profit')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showInactive, setShowInactive] = useState(false)

  const sorted = useMemo(() => {
    const arr = editors.filter(e => showInactive || e.active)
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.displayName.localeCompare(b.displayName, 'ru')
      else if (sortKey === 'earned') cmp = a.summary.totalEarned - b.summary.totalEarned
      else if (sortKey === 'profit') cmp = a.summary.studioProfit - b.summary.studioProfit
      else if (sortKey === 'projects') cmp = a.summary.totalProjects - b.summary.totalProjects
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [editors, sortKey, sortDir, showInactive])

  function toggleSort(key: SortKey) {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'name' ? 'asc' : 'desc')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <SortButton column="name" label="Имя" active={sortKey === 'name'} dir={sortDir} onToggle={toggleSort} />
          <SortButton column="projects" label="Проектов" active={sortKey === 'projects'} dir={sortDir} onToggle={toggleSort} />
          <SortButton column="earned" label="Заработок" active={sortKey === 'earned'} dir={sortDir} onToggle={toggleSort} />
          <SortButton column="profit" label="Прибыль студии" active={sortKey === 'profit'} dir={sortDir} onToggle={toggleSort} />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-[#00c26b]" />
            Показывать неактивных
          </label>
          <button type="button" onClick={onCreateEditor} className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Монтажёр
          </button>
        </div>
      </div>

      {sorted.length === 0 && <p className="text-zinc-500 text-sm text-center py-10">Монтажёров пока нет</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map(ed => (
          <button
            key={ed.id}
            type="button"
            onClick={() => onOpenEditor(ed.id)}
            className="text-left bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/40 rounded-xl p-5 transition-colors"
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-white font-semibold text-sm truncate">{ed.displayName}</p>
              {!ed.active && <span className="text-[11px] text-zinc-500 bg-zinc-800 rounded-full px-2 py-0.5 flex-shrink-0">Неактивен</span>}
            </div>
            {ed.specialization && <p className="text-zinc-500 text-xs mb-3">{ed.specialization}</p>}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-zinc-500">Проектов</p>
                <p className="text-zinc-200 font-medium">{ed.summary.totalProjects} ({ed.summary.activeProjects} в работе)</p>
              </div>
              <div>
                <p className="text-zinc-500">Сдано</p>
                <p className="text-zinc-200 font-medium">{ed.summary.deliveredProjects}</p>
              </div>
              <div>
                <p className="text-zinc-500">Заработал</p>
                <p className="text-zinc-200 font-medium">{formatMoney(ed.summary.totalEarned)}</p>
              </div>
              <div>
                <p className="text-zinc-500">Прибыль студии</p>
                <p className="text-zinc-200 font-medium">{formatMoney(ed.summary.studioProfit)}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
