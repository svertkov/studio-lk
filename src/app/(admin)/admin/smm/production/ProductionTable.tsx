'use client'

import { useState } from 'react'
import { AlertTriangle, Copy, Check } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import type { SmmProductionRowDTO } from '@/lib/actions/smm'
import { SMM_CONTENT_STATUS_LABELS, SMM_SERVICE_TYPE_LABELS } from '@/lib/smm-model'
import type { SmmContentStatus } from '@prisma/client'

const SELECT = 'h-8 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-2 text-xs outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

// Копирование File Code прямо из таблицы (docs/business/SMM.md, «File
// Code») — по клику, без открытия карточки.
function FileCodeCell({ fileCode }: { fileCode: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!fileCode) return <span className="text-zinc-600 text-xs">—</span>
  return (
    <button
      type="button"
      onClick={async e => { e.stopPropagation(); await navigator.clipboard.writeText(fileCode); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
      title="Скопировать File Code"
      className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 text-xs font-mono transition-colors"
    >
      {fileCode}
      {copied ? <Check className="w-3 h-3 text-[#00c26b] flex-shrink-0" /> : <Copy className="w-3 h-3 flex-shrink-0" />}
    </button>
  )
}

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

interface Props {
  items: SmmProductionRowDTO[]
  onOpen: (id: string) => void
  onQuickStatusChange: (id: string, status: SmmContentStatus) => void
}

export default function ProductionTable({ items, onOpen, onQuickStatusChange }: Props) {
  if (items.length === 0) return null

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400">File Code</TableHead>
            <TableHead className="text-zinc-400">Клиент</TableHead>
            <TableHead className="text-zinc-400">Контент</TableHead>
            <TableHead className="text-zinc-400">Формат</TableHead>
            <TableHead className="text-zinc-400">Статус</TableHead>
            <TableHead className="text-zinc-400">Публикация</TableHead>
            <TableHead className="text-zinc-400">Ответственный</TableHead>
            <TableHead className="text-zinc-400">Монтажёр</TableHead>
            <TableHead className="text-zinc-400">Монтаж</TableHead>
            <TableHead className="text-zinc-400">Дедлайн</TableHead>
            <TableHead className="text-zinc-400">Материалы</TableHead>
            <TableHead className="text-zinc-400">Просрочка</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(r => (
            <TableRow
              key={r.id}
              onClick={() => onOpen(r.id)}
              className={`cursor-pointer transition-colors ${r.isOverdue ? 'border-red-700/50 bg-red-500/[0.04] hover:bg-red-500/10' : 'border-zinc-800'}`}
            >
              <TableCell><FileCodeCell fileCode={r.fileCode} /></TableCell>
              <TableCell><span className="text-zinc-200 text-sm truncate max-w-[140px] inline-block">{r.clientName ?? '—'}</span></TableCell>
              <TableCell>
                <p className="text-zinc-200 text-sm truncate max-w-[220px]">{r.title || SMM_SERVICE_TYPE_LABELS[r.serviceType]}</p>
              </TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.serviceType === 'OTHER' ? (r.customServiceType || 'Другое') : SMM_SERVICE_TYPE_LABELS[r.serviceType]}</span></TableCell>
              <TableCell onClick={e => e.stopPropagation()}>
                <select className={SELECT} value={r.status} onChange={e => onQuickStatusChange(r.id, e.target.value as SmmContentStatus)}>
                  {(Object.keys(SMM_CONTENT_STATUS_LABELS) as SmmContentStatus[]).map(s => <option key={s} value={s}>{SMM_CONTENT_STATUS_LABELS[s]}</option>)}
                </select>
              </TableCell>
              <TableCell>
                {r.nearestPublicationDate ? (
                  <p className="text-zinc-300 text-xs">
                    {formatDate(r.nearestPublicationDate)}
                    {r.publicationPlatformCount > 1 && <span className="text-zinc-500"> · {r.publicationPlatformCount} площ.</span>}
                  </p>
                ) : <span className="text-zinc-600 text-xs">—</span>}
              </TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.responsibleUserName ?? '—'}</span></TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.editorName ?? '—'}</span></TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{r.montageShortState}</span></TableCell>
              <TableCell><span className="text-zinc-400 text-xs">{formatDate(r.deadline)}</span></TableCell>
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
              <TableCell>
                {r.isOverdue && <AlertTriangle className="w-4 h-4 text-red-400" aria-label="Просрочено" />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
