'use client'

import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import type { SmmClientContentRowDTO } from '@/lib/actions/smm'
import { SMM_CONTENT_STATUS_LABELS, SMM_SERVICE_TYPE_LABELS, SMM_PUBLICATION_PLATFORM_LABELS } from '@/lib/smm-model'

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

interface Props {
  rows: SmmClientContentRowDTO[]
  onOpen: (id: string) => void
}

// Полноценная рабочая таблица «SMM → Клиенты → проект → Контент» (следующий
// этап после 2B, docs/business/SMM.md, «Views») — тот же SmmContentItem, что
// и в Production (getSmmProjectContentRows, не вторая модель), просто с
// колонками, специфичными именно для карточки клиента (Съёмки/Опубликовано
// X/Y/Просмотры), которых нет в компактной Production-таблице.
export default function SmmProjectContentTable({ rows, onOpen }: Props) {
  if (rows.length === 0) return <p className="text-zinc-500 text-sm px-1 py-6">Контента пока нет</p>

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400">File Code</TableHead>
            <TableHead className="text-zinc-400">Плановая публикация</TableHead>
            <TableHead className="text-zinc-400">Название</TableHead>
            <TableHead className="text-zinc-400">Формат</TableHead>
            <TableHead className="text-zinc-400">Статус</TableHead>
            <TableHead className="text-zinc-400">Площадки</TableHead>
            <TableHead className="text-zinc-400">Съёмки</TableHead>
            <TableHead className="text-zinc-400">Материалы</TableHead>
            <TableHead className="text-zinc-400">Монтажёр</TableHead>
            <TableHead className="text-zinc-400">Монтаж</TableHead>
            <TableHead className="text-zinc-400">Готовый файл</TableHead>
            <TableHead className="text-zinc-400">Опубликовано</TableHead>
            <TableHead className="text-zinc-400">Просмотры</TableHead>
            <TableHead className="text-zinc-400">Внимание</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow
              key={r.id}
              onClick={() => onOpen(r.id)}
              className={`cursor-pointer transition-colors ${r.isOverdue ? 'border-red-700/50 bg-red-500/[0.04] hover:bg-red-500/10' : 'border-zinc-800'}`}
            >
              <TableCell><span className="text-zinc-400 text-xs font-mono">{r.fileCode ?? '—'}</span></TableCell>
              <TableCell><span className="text-zinc-300 text-xs">{formatDate(r.plannedPublishDate)}</span></TableCell>
              <TableCell><p className="text-zinc-200 text-sm truncate max-w-[200px]">{r.title || SMM_SERVICE_TYPE_LABELS[r.serviceType]}</p></TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.serviceType === 'OTHER' ? (r.customServiceType || 'Другое') : SMM_SERVICE_TYPE_LABELS[r.serviceType]}</span></TableCell>
              <TableCell><span className="text-zinc-300 text-xs">{SMM_CONTENT_STATUS_LABELS[r.status]}</span></TableCell>
              <TableCell>
                {r.publicationPlatforms.length > 0 ? (
                  <span className="text-zinc-400 text-xs">{r.publicationPlatforms.map(p => SMM_PUBLICATION_PLATFORM_LABELS[p]).join(', ')}</span>
                ) : <span className="text-zinc-600 text-xs">—</span>}
              </TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.scheduleCount || '—'}</span></TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${r.hasSourceMaterials ? 'border-zinc-700 text-zinc-400' : 'border-amber-700/50 text-amber-400 bg-amber-950/20'}`}>
                    исх. {r.hasSourceMaterials ? 'есть' : 'нет'}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${r.hasMasterMaterial ? 'border-zinc-700 text-zinc-400' : 'border-zinc-800 text-zinc-600'}`}>
                    гот. {r.hasMasterMaterial ? 'есть' : 'нет'}
                  </span>
                </div>
              </TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.editorName ?? '—'}</span></TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.montageShortState}</span></TableCell>
              <TableCell onClick={e => e.stopPropagation()}>
                {r.deliveryUrl ? (
                  <a href={r.deliveryUrl} target="_blank" rel="noopener noreferrer" className="text-[#00c26b] hover:underline inline-flex items-center gap-1 text-xs">
                    <ExternalLink className="w-3 h-3" /> файл
                  </a>
                ) : <span className="text-zinc-600 text-xs">—</span>}
              </TableCell>
              <TableCell><span className="text-zinc-300 text-xs">{r.publishedCount}/{r.totalPublicationsCount}</span></TableCell>
              <TableCell><span className="text-zinc-300 text-xs">{r.latestViewsTotal > 0 ? r.latestViewsTotal.toLocaleString('ru-RU') : '—'}</span></TableCell>
              <TableCell>{r.isOverdue && <AlertTriangle className="w-4 h-4 text-red-400" aria-label="Просрочено" />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
