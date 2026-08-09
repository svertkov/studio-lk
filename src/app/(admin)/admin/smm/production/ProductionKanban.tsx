'use client'

import { AlertTriangle } from 'lucide-react'
import type { SmmProductionRowDTO } from '@/lib/actions/smm'
import { SMM_CONTENT_STATUS_LABELS, SMM_CONTENT_STATUS_ORDER, SMM_SERVICE_TYPE_LABELS } from '@/lib/smm-model'

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'
}

interface Props {
  items: SmmProductionRowDTO[]
  onOpen: (id: string) => void
}

// Канбан без drag & drop (ТЗ 2B, п.33: "если DnD существенно увеличивает
// scope — сначала канбан без него"). Смена статуса на этом виде делается
// через открытие карточки/quick-select таблицы, не перетаскиванием.
export default function ProductionKanban({ items, onOpen }: Props) {
  const columns = SMM_CONTENT_STATUS_ORDER.map(status => ({
    status,
    rows: items.filter(r => r.status === status),
  }))

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map(col => (
        <div key={col.status} className="flex-shrink-0 w-64 bg-zinc-900/60 border border-zinc-800 rounded-xl p-2.5 space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-zinc-300 text-xs font-semibold">{SMM_CONTENT_STATUS_LABELS[col.status]}</p>
            <span className="text-zinc-500 text-xs">{col.rows.length}</span>
          </div>
          <div className="space-y-1.5 max-h-[65vh] overflow-y-auto">
            {col.rows.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpen(r.id)}
                className={`w-full text-left bg-zinc-900 border rounded-lg p-2.5 transition-colors hover:border-zinc-600 ${r.isOverdue ? 'border-red-700/50 bg-red-500/[0.04]' : 'border-zinc-800'}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-zinc-500 text-[10px] font-mono truncate">{r.contentCode ?? '—'}</span>
                  {r.isOverdue && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                </div>
                <p className="text-zinc-200 text-xs truncate mt-0.5">{r.title || SMM_SERVICE_TYPE_LABELS[r.serviceType]}</p>
                <p className="text-zinc-500 text-[11px] truncate mt-0.5">{r.clientName ?? '—'}</p>
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500">
                  <span>{r.editorName ?? '—'}</span>
                  <span>{formatDate(r.deadline ?? r.nearestPublicationDate)}</span>
                </div>
              </button>
            ))}
            {col.rows.length === 0 && <p className="text-zinc-700 text-xs px-1 py-2">Пусто</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
