'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, AlertTriangle } from 'lucide-react'
import type { SmmProjectSummaryDTO, SmmContentItemDTO } from '@/lib/actions/smm'
import type { SmmProjectStatus } from '@prisma/client'
import { SMM_PROJECT_STATUS_LABELS, formatSmmMoney } from '@/lib/smm-model'
import CreateSmmProjectModal from './CreateSmmProjectModal'

const SELECT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const INPUT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 text-sm outline-none focus:border-[#00c26b] transition-colors'

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'
}

interface ClientOption { id: string; name: string }

interface Props {
  projects: SmmProjectSummaryDTO[]
  setProjects: (updater: (prev: SmmProjectSummaryDTO[]) => SmmProjectSummaryDTO[]) => void
  clients: ClientOption[]
  content: SmmContentItemDTO[]
}

export default function SmmClientsTab({ projects, setProjects, clients }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | SmmProjectStatus>('ALL')
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    return projects.filter(p => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false
      if (search.trim() && !(p.clientName ?? '').toLowerCase().includes(search.trim().toLowerCase())) return false
      return true
    })
  }, [projects, search, statusFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className={INPUT} placeholder="Поиск по клиенту..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className={SELECT} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'ALL' | SmmProjectStatus)}>
            <option value="ALL">Все статусы</option>
            {(Object.keys(SMM_PROJECT_STATUS_LABELS) as SmmProjectStatus[]).map(s => (
              <option key={s} value={s}>{SMM_PROJECT_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Новый SMM-проект
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
              <th className="text-left font-medium px-4 py-2.5">Клиент</th>
              <th className="text-left font-medium px-4 py-2.5">Статус</th>
              <th className="text-left font-medium px-4 py-2.5">Стоимость ведения</th>
              <th className="text-left font-medium px-4 py-2.5">Ответственный</th>
              <th className="text-left font-medium px-4 py-2.5">След. платёж</th>
              <th className="text-left font-medium px-4 py-2.5">Прогресс пакета</th>
              <th className="text-left font-medium px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/admin/smm/${p.id}`} className="text-zinc-100 font-medium hover:text-[#00c26b] transition-colors">
                    {p.clientName ?? 'Без имени'}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-400">{SMM_PROJECT_STATUS_LABELS[p.status]}</td>
                <td className="px-4 py-3 text-zinc-200">{p.monthlyFee != null ? formatSmmMoney(p.monthlyFee) : '—'}</td>
                <td className="px-4 py-3 text-zinc-400">{p.primaryResponsibleName ?? '—'}</td>
                <td className="px-4 py-3 text-zinc-400">
                  {p.nextPaymentDate ? `${formatDate(p.nextPaymentDate)} · ${formatSmmMoney(p.nextPaymentAmount ?? 0)}` : '—'}
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  {p.packageTargetCount > 0 ? `${p.packageDoneCount} / ${p.packageTargetCount}` : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {p.hasOverdueContent && (
                    <span title="Есть просроченный контент">
                      <AlertTriangle className="w-4 h-4 text-amber-400 inline-block" />
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center text-zinc-500 text-sm py-10">Проектов не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateSmmProjectModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        clients={clients}
        existingProjects={projects}
        onCreated={project => setProjects(prev => [project, ...prev])}
      />
    </div>
  )
}
