'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { SmmContentItemDTO, SmmProjectSummaryDTO } from '@/lib/actions/smm'
import type { SmmContentStatus, SmmServiceType } from '@prisma/client'
import { SMM_CONTENT_STATUS_LABELS, SMM_SERVICE_TYPE_LABELS, isSmmContentOverdue } from '@/lib/smm-model'

const SELECT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

interface Props {
  content: SmmContentItemDTO[]
  projects: SmmProjectSummaryDTO[]
}

export default function SmmContentTab({ content, projects }: Props) {
  const [clientFilter, setClientFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | SmmContentStatus>('ALL')
  const [typeFilter, setTypeFilter] = useState<'ALL' | SmmServiceType>('ALL')

  const clientByProjectId = new Map(projects.map(p => [p.id, p.clientName ?? 'Без имени']))

  const filtered = useMemo(() => {
    return content.filter(c => {
      if (clientFilter !== 'ALL' && c.smmProjectId !== clientFilter) return false
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
      if (typeFilter !== 'ALL' && c.serviceType !== typeFilter) return false
      return true
    })
  }, [content, clientFilter, statusFilter, typeFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select className={SELECT} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="ALL">Все клиенты</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.clientName ?? 'Без имени'}</option>)}
        </select>
        <select className={SELECT} value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'ALL' | SmmServiceType)}>
          <option value="ALL">Все типы</option>
          {(Object.keys(SMM_SERVICE_TYPE_LABELS) as SmmServiceType[]).map(t => (
            <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select className={SELECT} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'ALL' | SmmContentStatus)}>
          <option value="ALL">Все статусы</option>
          {(Object.keys(SMM_CONTENT_STATUS_LABELS) as SmmContentStatus[]).map(s => (
            <option key={s} value={s}>{SMM_CONTENT_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
              <th className="text-left font-medium px-4 py-2.5">Клиент</th>
              <th className="text-left font-medium px-4 py-2.5">Тип</th>
              <th className="text-left font-medium px-4 py-2.5">Название</th>
              <th className="text-left font-medium px-4 py-2.5">Статус</th>
              <th className="text-left font-medium px-4 py-2.5">Ответственный</th>
              <th className="text-left font-medium px-4 py-2.5">Дедлайн</th>
              <th className="text-left font-medium px-4 py-2.5">Публикация</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const overdue = isSmmContentOverdue(c)
              return (
                <tr key={c.id} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/smm/${c.smmProjectId}`} className="text-zinc-100 hover:text-[#00c26b] transition-colors">
                      {clientByProjectId.get(c.smmProjectId) ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{c.serviceType === 'OTHER' ? (c.customServiceType || 'Другое') : SMM_SERVICE_TYPE_LABELS[c.serviceType]}</td>
                  <td className="px-4 py-3 text-zinc-200 max-w-xs truncate">{c.title ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{SMM_CONTENT_STATUS_LABELS[c.status]}</td>
                  <td className="px-4 py-3 text-zinc-400">{c.responsibleUserName ?? c.editorName ?? '—'}</td>
                  <td className={`px-4 py-3 ${overdue ? 'text-amber-400' : 'text-zinc-400'}`}>{formatDate(c.deadline)}</td>
                  <td className="px-4 py-3 text-zinc-400">{formatDate(c.plannedPublishDate)}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center text-zinc-500 text-sm py-10">Контента не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
